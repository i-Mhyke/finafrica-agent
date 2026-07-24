import { UrlPolicyError } from './provider-errors';

const PRIVATE_IPV4_RANGES = [
	/^10\./,
	/^127\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^0\./,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
	/^198\.(1[89])\./,
];

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0']);
export type HostnameResolver = (hostname: string) => Promise<string[]>;

export function createDohHostnameResolver(
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): HostnameResolver {
	return async (hostname) => {
		const query = async (type: 'A' | 'AAAA') => {
			const url = new URL('https://cloudflare-dns.com/dns-query');
			url.searchParams.set('name', hostname);
			url.searchParams.set('type', type);
			const response = await fetchImpl(url, {
				headers: { Accept: 'application/dns-json' },
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) throw new UrlPolicyError(`DNS resolution failed: ${response.status}`);
			const data = (await response.json()) as {
				Answer?: Array<{ type?: number; data?: string }>;
			};
			return (data.Answer ?? [])
				.filter((answer) => answer.type === (type === 'A' ? 1 : 28))
				.map((answer) => answer.data)
				.filter((address): address is string => typeof address === 'string');
		};
		const [ipv4, ipv6] = await Promise.all([query('A'), query('AAAA')]);
		return [...ipv4, ...ipv6];
	};
}

function isIPv4(hostname: string): boolean {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isIPv6(hostname: string): boolean {
	return hostname.includes(':');
}

function assertPublicIp(address: string): void {
	const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
	if (isIPv4(normalized)) {
		if (PRIVATE_IPV4_RANGES.some((range) => range.test(normalized))) {
			throw new UrlPolicyError('Private IPv4 address is not permitted');
		}
		return;
	}
	if (isIPv6(normalized)) {
		if (
			normalized === '::1' ||
			normalized === '::' ||
			normalized.startsWith('fe80:') ||
			normalized.startsWith('fc') ||
			normalized.startsWith('fd')
		) {
			throw new UrlPolicyError('Private IPv6 address is not permitted');
		}
	}
}

export async function assertPublicHttpsUrl(
	url: string,
	resolveHostname?: HostnameResolver,
): Promise<string> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new UrlPolicyError('Invalid URL');
	}

	if (parsed.protocol !== 'https:') {
		throw new UrlPolicyError('Only HTTPS URLs are permitted');
	}

	if (parsed.username || parsed.password) {
		throw new UrlPolicyError('Credential-bearing URLs are not permitted');
	}

	const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (BLOCKED_HOSTNAMES.has(hostname)) {
		throw new UrlPolicyError('Loopback hostname is not permitted');
	}

	if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
		throw new UrlPolicyError('Private hostname is not permitted');
	}

	const isLiteralIp = isIPv4(hostname) || isIPv6(hostname);
	if (isLiteralIp) {
		assertPublicIp(hostname);
	} else if (resolveHostname) {
		const addresses = await resolveHostname(hostname);
		if (addresses.length === 0) {
			throw new UrlPolicyError('Hostname did not resolve');
		}
		for (const address of addresses) assertPublicIp(address);
	}

	return parsed.href;
}

export function assertResponseSize(bytes: number, limit: number): void {
	if (bytes > limit) {
		throw new UrlPolicyError(`Response exceeds ${limit} byte limit`);
	}
}
