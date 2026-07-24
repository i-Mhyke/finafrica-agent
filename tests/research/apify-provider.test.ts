import { describe, expect, it, vi } from 'vitest';
import { ApifyWebExtractionProvider } from '../../.flue/providers/web-research/apify';
import apifyRunFixture from '../fixtures/research/apify-fetch.json';

const API_TOKEN = 'test-apify-token-secret';

const datasetItem = {
	url: 'https://cbn.gov.ng/documents/circular-2026',
	title: 'CBN Circular',
	markdown:
		'The Central Bank of Nigeria announced new capital requirements for deposit money banks. The minimum capital adequacy ratio has been raised to 15 percent effective fourth quarter 2026. Banks must submit compliance plans within 90 days. Tier 1 capital definitions remain unchanged. Foreign currency exposures must be reported monthly. Penalties for non-compliance include restrictions on dividend payments and new branch openings. Additional supervisory guidance will follow in August.',
};

function baseFetchInput() {
	return {
		url: 'https://cbn.gov.ng/documents/circular-2026',
		market: 'nigeria' as const,
		tier: 1 as const,
		mode: 'raw-http' as const,
		evidenceQuestion: 'What changed?',
		maxCharacters: 4000,
		phase: 'deep-research' as const,
		briefId: 'brief_1',
		callKey: 'call_apify_1',
		attempt: 1,
	};
}

describe('ApifyWebExtractionProvider', () => {
	it('does not implement runtime search through Apify', () => {
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN });
		expect('search' in provider).toBe(false);
	});

	it('calls fetch with the global receiver required by Cloudflare Workers', async () => {
		const fetch = vi.fn(function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
			if (this !== globalThis) {
				throw new TypeError('Illegal invocation');
			}
			const url = String(input);
			if (url.includes('/runs') && init?.method === 'POST') {
				return Promise.resolve(
					new Response(JSON.stringify(apifyRunFixture), { status: 201 }),
				);
			}
			if (url.includes('/actor-runs/')) {
				return Promise.resolve(
					new Response(JSON.stringify(apifyRunFixture), { status: 200 }),
				);
			}
			if (url.includes('/datasets/')) {
				return Promise.resolve(
					new Response(JSON.stringify([datasetItem]), { status: 200 }),
				);
			}
			return Promise.resolve(new Response('{}', { status: 404 }));
		}) as unknown as typeof globalThis.fetch;
		const provider = new ApifyWebExtractionProvider({
			apiToken: API_TOKEN,
			fetch,
			sleep: async () => {},
		});

		await expect(
			provider.fetch(baseFetchInput(), new AbortController().signal),
		).resolves.toMatchObject({ finalUrl: datasetItem.url });
	});

	it('starts one normal Actor run for one selected URL', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs') && init?.method === 'POST') {
				return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			}
			if (url.includes('/actor-runs/')) {
				return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			}
			if (url.includes('/datasets/')) {
				return new Response(JSON.stringify([datasetItem]), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({
			apiToken: API_TOKEN,
			fetch,
			sleep: async () => {},
		});
		await provider.fetch(baseFetchInput(), new AbortController().signal);
		const startCall = fetch.mock.calls.find((c) => String(c[0]).includes('/runs'));
		const body = JSON.parse((startCall?.[1] as RequestInit).body as string);
		expect(body.query).toBe('https://cbn.gov.ng/documents/circular-2026');
		expect(body.scrapingTool).toBe('raw-http');
	});

	it('uses raw-http unless the router explicitly selects Playwright', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs')) return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			if (url.includes('/actor-runs/')) return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			if (url.includes('/datasets/')) return new Response(JSON.stringify([datasetItem]), { status: 200 });
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN, fetch });
		await provider.fetch(baseFetchInput(), new AbortController().signal);
		const startCall = fetch.mock.calls.find((c) => String(c[0]).includes('/runs'));
		const body = JSON.parse((startCall?.[1] as RequestInit).body as string);
		expect(body.scrapingTool).toBe('raw-http');
	});

	it('reads markdown, final URL, HTTP status and usageTotalUsd', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs')) return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			if (url.includes('/actor-runs/')) return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			if (url.includes('/datasets/')) return new Response(JSON.stringify([datasetItem]), { status: 200 });
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN, fetch });
		const result = await provider.fetch(baseFetchInput(), new AbortController().signal);
		expect(result.finalUrl).toContain('cbn.gov.ng');
		expect(result.content.length).toBeGreaterThan(100);
		expect(result.receipt.costUsd).toBe(0.025);
	});

	it('reads URL and title from the Actor metadata payload', async () => {
		const fetch = vi.fn(async (url: string) => {
			if (url.includes('/runs')) return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			if (url.includes('/actor-runs/')) return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			if (url.includes('/datasets/')) {
				return new Response(
					JSON.stringify([
						{
							metadata: {
								url: 'https://cbn.gov.ng/documents/final-circular',
								title: 'Final CBN Circular',
							},
							markdown: datasetItem.markdown,
						},
					]),
					{ status: 200 },
				);
			}
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN, fetch });

		const result = await provider.fetch(baseFetchInput(), new AbortController().signal);

		expect(result.finalUrl).toContain('final-circular');
		expect(result.title).toBe('Final CBN Circular');
	});

	it('retries status GET failures without starting a second Actor', async () => {
		let statusCalls = 0;
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs') && init?.method === 'POST') {
				return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			}
			if (url.includes('/actor-runs/')) {
				statusCalls++;
				if (statusCalls === 1) return new Response('temporary', { status: 500 });
				return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			}
			if (url.includes('/datasets/')) {
				return new Response(JSON.stringify([datasetItem]), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({
			apiToken: API_TOKEN,
			fetch,
			sleep: async () => {},
		});

		await provider.fetch(baseFetchInput(), new AbortController().signal);

		const startCalls = fetch.mock.calls.filter(
			(call) => String(call[0]).includes('/runs') && (call[1] as RequestInit)?.method === 'POST',
		);
		expect(startCalls).toHaveLength(1);
		expect(statusCalls).toBe(2);
	});

	it('does not mark a terminal start rejection as an ambiguous Actor run', async () => {
		let startCalls = 0;
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs') && init?.method === 'POST') {
				startCalls++;
				if (startCalls === 1) return new Response('unauthorized', { status: 401 });
				return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			}
			if (url.includes('/actor-runs/')) {
				return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			}
			if (url.includes('/datasets/')) {
				return new Response(JSON.stringify([datasetItem]), { status: 200 });
			}
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN, fetch });

		await expect(
			provider.fetch(baseFetchInput(), new AbortController().signal),
		).rejects.toMatchObject({ statusCode: 401 });
		await expect(
			provider.fetch(baseFetchInput(), new AbortController().signal),
		).resolves.toMatchObject({ finalUrl: datasetItem.url });
	});

	it('aborts the Actor run when the caller signal is cancelled', async () => {
		const controller = new AbortController();
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs') && init?.method === 'POST') {
				return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			}
			if (url.endsWith('/abort')) {
				return new Response(JSON.stringify({ data: { status: 'ABORTED' } }), { status: 200 });
			}
			controller.abort();
			return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: API_TOKEN, fetch });
		await expect(provider.fetch(baseFetchInput(), controller.signal)).rejects.toBeDefined();
		expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/abort'))).toBe(true);
	});
});
