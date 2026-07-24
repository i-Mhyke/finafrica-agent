import type { WorkflowRouteHandler, WorkflowRunsHandler } from '@flue/runtime';

const UNAUTHORIZED_BODY = JSON.stringify({ error: 'Unauthorized' });
const SERVICE_UNAVAILABLE_BODY = JSON.stringify({ error: 'Service unavailable' });
const MIN_TOKEN_BYTES = 32;

async function sha256Hex(value: string): Promise<string> {
	const data = new TextEncoder().encode(value);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader) return null;
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
}

/** Shared bearer-token gate for Flue routes and the control-plane Worker. */
export async function authorizeResearchAdminRequest(
	request: Request,
	configuredToken: string | undefined,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.searchParams.has('token') || url.searchParams.has('api_key')) {
		return new Response(UNAUTHORIZED_BODY, {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (!configuredToken || new TextEncoder().encode(configuredToken).length < MIN_TOKEN_BYTES) {
		return new Response(SERVICE_UNAVAILABLE_BODY, {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const callerToken = extractBearerToken(request.headers.get('Authorization') ?? undefined);
	if (!callerToken) {
		return new Response(UNAUTHORIZED_BODY, {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const [callerDigest, configuredDigest] = await Promise.all([
		sha256Hex(callerToken),
		sha256Hex(configuredToken),
	]);

	if (!timingSafeEqual(callerDigest, configuredDigest)) {
		return new Response(UNAUTHORIZED_BODY, {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return null;
}

export function createResearchAdminMiddleware(
	getToken: (context: { env?: Record<string, unknown> }) => string | undefined,
): WorkflowRouteHandler & WorkflowRunsHandler {
	return async (c, next) => {
		const authHeader = c.req.header('Authorization');
		const request = new Request(c.req.url, {
			headers: authHeader ? { Authorization: authHeader } : undefined,
		});
		const failure = await authorizeResearchAdminRequest(request, getToken(c));
		if (failure) {
			return failure;
		}
		return next();
	};
}

export const researchAdminFromEnv = createResearchAdminMiddleware(
	(context) => {
		const token = context.env?.RESEARCH_ADMIN_TOKEN;
		return typeof token === 'string' ? token : undefined;
	},
);
