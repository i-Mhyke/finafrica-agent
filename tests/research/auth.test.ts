import { describe, expect, it } from 'vitest';
import {
	createResearchAdminMiddleware,
	researchAdminFromEnv,
} from '../../.flue/auth/research-admin';

const VALID_TOKEN = 'a'.repeat(32);

function mockContext(options: {
	authHeader?: string;
	url?: string;
	token?: string;
}) {
	const url = options.url ?? 'https://example.com/workflows/market-intelligence-scan';
	let nextCalled = false;
	return {
		c: {
			req: {
				url,
				header: (name: string) => (name === 'Authorization' ? options.authHeader : undefined),
			},
		},
		next: async () => {
			nextCalled = true;
			return new Response('ok');
		},
		get nextCalled() {
			return nextCalled;
		},
	};
}

describe('research admin auth', () => {
	it('rejects query-string credentials', async () => {
		const middleware = createResearchAdminMiddleware(() => VALID_TOKEN);
		const ctx = mockContext({ url: 'https://example.com/workflows/market-intelligence-scan?token=secret' });
		const response = await middleware(ctx.c as never, ctx.next);
		expect(response?.status).toBe(401);
		expect(ctx.nextCalled).toBe(false);
	});

	it('rejects malformed and invalid bearer credentials with the same 401 body', async () => {
		const middleware = createResearchAdminMiddleware(() => VALID_TOKEN);
		const missing = mockContext({});
		const missingResponse = await middleware(missing.c as never, missing.next);
		expect(missingResponse?.status).toBe(401);

		const invalid = mockContext({ authHeader: 'Bearer wrong-token-value-32chars-long!!' });
		const invalidResponse = await middleware(invalid.c as never, invalid.next);
		expect(invalidResponse?.status).toBe(401);
		expect(await missingResponse?.text()).toBe(await invalidResponse?.text());
	});

	it('fails closed when RESEARCH_ADMIN_TOKEN is missing or shorter than 32 bytes', async () => {
		const missing = createResearchAdminMiddleware(() => undefined);
		const ctx = mockContext({ authHeader: `Bearer ${VALID_TOKEN}` });
		const response = await missing(ctx.c as never, ctx.next);
		expect(response?.status).toBe(503);

		const short = createResearchAdminMiddleware(() => 'short');
		const shortResponse = await short(ctx.c as never, ctx.next);
		expect(shortResponse?.status).toBe(503);
	});

	it('authenticates before parsing the request body or looking up a run', async () => {
		const middleware = createResearchAdminMiddleware(() => VALID_TOKEN);
		const ctx = mockContext({ authHeader: `Bearer ${VALID_TOKEN}` });
		await middleware(ctx.c as never, ctx.next);
		expect(ctx.nextCalled).toBe(true);
	});

	it('reads the admin token from the Cloudflare request environment', async () => {
		const ctx = mockContext({ authHeader: `Bearer ${VALID_TOKEN}` });
		(ctx.c as typeof ctx.c & { env: { RESEARCH_ADMIN_TOKEN: string } }).env = {
			RESEARCH_ADMIN_TOKEN: VALID_TOKEN,
		};

		const response = await researchAdminFromEnv(ctx.c as never, ctx.next);

		expect(response?.status).toBe(200);
		expect(ctx.nextCalled).toBe(true);
	});
});
