import { describe, expect, it, vi } from 'vitest';
import { deriveCallKey } from '../../.flue/research/ids';
import { ExaWebResearchProvider } from '../../.flue/providers/web-research/exa';
import { ProviderError } from '../../.flue/providers/web-research/provider-errors';
import exaSearchFixture from '../fixtures/research/exa-search.json';
import exaContentsFixture from '../fixtures/research/exa-contents.json';

const API_KEY = 'test-exa-key-secret';

function baseSearchInput() {
	return {
		query: 'Nigeria central bank capital requirements',
		market: 'nigeria' as const,
		tier: 1 as const,
		domains: ['cbn.gov.ng'],
		startDate: '2026-07-01T00:00:00Z',
		endDate: '2026-07-23T00:00:00Z',
		maxResults: 10,
		phase: 'discovery' as const,
		briefId: null,
		callKey: 'call_test_search',
		attempt: 1,
	};
}

describe('ExaWebResearchProvider', () => {
	it('calls fetch with the global receiver required by Cloudflare Workers', async () => {
		const fetch = vi.fn(function (this: unknown) {
			if (this !== globalThis) {
				throw new TypeError('Illegal invocation');
			}
			return Promise.resolve(
				new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
			);
		}) as unknown as typeof globalThis.fetch;
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });

		await expect(
			provider.search(baseSearchInput(), new AbortController().signal),
		).resolves.toMatchObject({
			receipt: { providerRequestId: 'exa-req-001' },
		});
	});

	it('sends API credentials only as a header', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		await provider.search(baseSearchInput(), new AbortController().signal);
		const [, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(init.headers).toMatchObject({ 'x-api-key': API_KEY });
		expect(fetch.mock.calls[0][0]).not.toContain(API_KEY);
	});

	it('requests highlights and bounded result counts by default', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		await provider.search({ ...baseSearchInput(), maxResults: 25 }, new AbortController().signal);
		const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
		expect(body.numResults).toBe(10);
		expect(body.contents.highlights).toBeDefined();
	});

	it('passes application-owned domain and date filters', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		await provider.search(baseSearchInput(), new AbortController().signal);
		const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
		expect(body.includeDomains).toEqual(['cbn.gov.ng']);
		expect(body.startPublishedDate).toBe('2026-07-01T00:00:00Z');
	});

	it('parses request ID, cost, URLs, dates and excerpts', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		const result = await provider.search(baseSearchInput(), new AbortController().signal);
		expect(result.receipt.providerRequestId).toBe('exa-req-001');
		expect(result.receipt.costUsd).toBe(0.005);
		expect(result.results[0].url).toContain('cbn.gov.ng');
		expect(result.results[0].highlights.length).toBeGreaterThan(0);
	});

	it('classifies 429 and 5xx as retryable', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		await expect(provider.search(baseSearchInput(), new AbortController().signal)).rejects.toMatchObject({
			retryable: true,
		});
	});

	it('classifies 400 and 401 as terminal', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 401 }));
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		await expect(provider.search(baseSearchInput(), new AbortController().signal)).rejects.toMatchObject({
			retryable: false,
		});
	});

	it('redacts the API key from thrown errors', async () => {
		const fetch = vi.fn().mockRejectedValue(new Error(`failed with key ${API_KEY}`));
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		try {
			await provider.search(baseSearchInput(), new AbortController().signal);
		} catch (error) {
			expect((error as ProviderError).message).not.toContain(API_KEY);
			expect((error as ProviderError).message).toContain('[REDACTED]');
		}
	});

	it('aborts when the caller signal is cancelled', async () => {
		const controller = new AbortController();
		const fetch = vi.fn(() => new Promise<Response>(() => {}));
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		controller.abort();
		await expect(
			provider.fetch(
				{
					url: 'https://cbn.gov.ng/documents/circular-2026',
					market: 'nigeria',
					tier: 1,
					mode: 'highlights',
					evidenceQuestion: 'What changed?',
					maxCharacters: 4000,
					phase: 'deep-research',
					briefId: 'brief_1',
					callKey: 'call_fetch_abort',
					attempt: 1,
				},
				controller.signal,
			),
			).rejects.toBeDefined();
	});

	it('rejects a public-looking hostname that resolves to a private address', async () => {
		const fetch = vi.fn();
		const provider = new ExaWebResearchProvider({
			apiKey: API_KEY,
			fetch,
			...({
				resolveHostname: async () => ['127.0.0.1'],
			} as object),
		});

		await expect(
			provider.fetch(
				{
					url: 'https://public.example/document',
					market: 'nigeria',
					tier: 1,
					mode: 'highlights',
					evidenceQuestion: 'What changed?',
					maxCharacters: 4000,
					phase: 'deep-research',
					briefId: 'brief_1',
					callKey: 'call_private_dns',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow('Private');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects unsafe URLs returned by search', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					...exaSearchFixture,
					results: [
						{
							url: 'https://127.0.0.1/admin',
							title: 'Unsafe result',
							highlights: ['Internal content'],
						},
					],
				}),
				{ status: 200 },
			),
		);
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });

		await expect(
			provider.search(baseSearchInput(), new AbortController().signal),
		).rejects.toThrow('Private');
	});
});

describe('callKey derivation', () => {
	it('produces stable call keys', async () => {
		const a = await deriveCallKey({
			runKey: 'run-1',
			briefId: null,
			market: 'nigeria',
			phase: 'discovery',
			operation: 'search',
			queryOrUrl: 'test query',
			provider: 'exa',
			mode: 'search',
			attempt: 1,
		});
		const b = await deriveCallKey({
			runKey: 'run-1',
			briefId: null,
			market: 'nigeria',
			phase: 'discovery',
			operation: 'search',
			queryOrUrl: 'test query',
			provider: 'exa',
			mode: 'search',
			attempt: 1,
		});
		expect(a).toBe(b);
	});
});
