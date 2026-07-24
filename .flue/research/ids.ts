/** Stable ID helpers using Web Crypto SHA-256 over normalized UTF-8 values. */

export async function sha256Hex(value: string): Promise<string> {
	const data = new TextEncoder().encode(value);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Normalize a URL to a canonical form for stable ID derivation. */
export function normalizeCanonicalUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hash = '';
	if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
		parsed.pathname = parsed.pathname.slice(0, -1);
	}
	parsed.hostname = parsed.hostname.toLowerCase();
	if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
		parsed.port = '';
	}
	return parsed.href;
}

export async function deriveSourceId(canonicalUrl: string): Promise<string> {
	const normalized = normalizeCanonicalUrl(canonicalUrl);
	return `src_${(await sha256Hex(normalized)).slice(0, 16)}`;
}

export async function deriveBriefId(runKey: string, workingTitle: string): Promise<string> {
	return `brief_${(await sha256Hex(`${runKey}:${workingTitle.toLowerCase().trim()}`)).slice(0, 16)}`;
}

export async function deriveEvidenceId(sourceId: string, text: string, offset = 0): Promise<string> {
	return `ev_${(await sha256Hex(`${sourceId}:${offset}:${text.slice(0, 200)}`)).slice(0, 16)}`;
}

export async function deriveClaimId(statement: string): Promise<string> {
	return `claim_${(await sha256Hex(statement.toLowerCase().trim())).slice(0, 16)}`;
}

export async function deriveReceiptId(
	callKey: string,
	attempt: number,
	provider = '',
	mode = '',
): Promise<string> {
	return `rcpt_${(await sha256Hex(`${callKey}:${provider}:${mode}:${attempt}`)).slice(0, 16)}`;
}

export async function deriveProviderAttemptCallKey(
	baseCallKey: string,
	provider: string,
	mode: string,
	attempt: number,
): Promise<string> {
	return `call_${(await sha256Hex(`${baseCallKey}:${provider}:${mode}:${attempt}`)).slice(0, 24)}`;
}

export async function deriveCallKey(parts: {
	runKey: string;
	briefId: string | null;
	market: string;
	phase: string;
	operation: string;
	queryOrUrl: string;
	provider: string;
	mode: string;
	attempt: number;
}): Promise<string> {
	const payload = [
		parts.runKey,
		parts.briefId ?? '',
		parts.market,
		parts.phase,
		parts.operation,
		parts.queryOrUrl,
		parts.provider,
		parts.mode,
		String(parts.attempt),
	].join('|');
	return `call_${(await sha256Hex(payload)).slice(0, 24)}`;
}

export async function deriveContentHash(content: string): Promise<string> {
	return await sha256Hex(content);
}
