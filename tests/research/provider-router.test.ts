import { describe, expect, it, vi } from 'vitest';
import { ApifyWebExtractionProvider } from '../../.flue/providers/web-research/apify';
import { ExaWebResearchProvider } from '../../.flue/providers/web-research/exa';
import { isUsableExtraction } from '../../.flue/providers/web-research/extraction-quality';
import { CostAwareWebResearchRouter, createBudgetTracker } from '../../.flue/providers/web-research/router';
import { assertPublicHttpsUrl } from '../../.flue/providers/web-research/url-policy';
import {
	createResearchAuditEmitter,
	RESEARCH_AUDIT_LOG_MESSAGE,
} from '../../.flue/research/run-audit';
import exaContentsFixture from '../fixtures/research/exa-contents.json';
import exaSearchFixture from '../fixtures/research/exa-search.json';
import apifyRunFixture from '../fixtures/research/apify-fetch.json';

const usableContent =
	'The Central Bank of Nigeria announced new capital requirements for deposit money banks. The minimum capital adequacy ratio has been raised to 15 percent effective fourth quarter 2026. Banks must submit compliance plans within 90 days. Tier 1 capital definitions remain unchanged. Foreign currency exposures must be reported monthly. Penalties for non-compliance include restrictions on dividend payments and new branch openings. Additional supervisory guidance will follow in August.';

const datasetItem = {
	url: 'https://cbn.gov.ng/documents/circular-2026',
	title: 'CBN Circular',
	markdown: usableContent,
};

describe('url policy and extraction quality', () => {
	it('rejects credential-bearing, loopback, private and link-local URLs', async () => {
		await expect(assertPublicHttpsUrl('http://cbn.gov.ng/doc')).rejects.toThrow();
		await expect(assertPublicHttpsUrl('https://user:pass@cbn.gov.ng/doc')).rejects.toThrow();
		await expect(assertPublicHttpsUrl('https://localhost/doc')).rejects.toThrow();
		await expect(assertPublicHttpsUrl('https://127.0.0.1/doc')).rejects.toThrow();
		await expect(assertPublicHttpsUrl('https://192.168.1.1/doc')).rejects.toThrow();
		await expect(assertPublicHttpsUrl('https://[::1]/doc')).rejects.toThrow();
		await expect(
			assertPublicHttpsUrl('https://public.example/doc', async () => ['127.0.0.1']),
		).rejects.toThrow();
	});

	it('rejects provider output with a non-public final URL', () => {
		const result = isUsableExtraction({
			content: usableContent,
			title: 'Test',
			finalUrl: 'http://insecure.example.com',
			hasError: false,
		});
		expect(result.usable).toBe(false);
	});

	it('rejects login, access-denied, cookie-only and navigation-only content', () => {
		const result = isUsableExtraction({
			content: 'Please sign in to continue',
			title: 'Login',
			finalUrl: 'https://example.com/login',
			hasError: false,
		});
		expect(result.usable).toBe(false);
	});
});

describe('CostAwareWebResearchRouter', () => {
	function createRouter(options: { apifyEnabled?: boolean; exaUsable?: boolean } = {}) {
		const exaFetch = vi.fn(async (url: string) => {
			if (url.includes('/search')) {
				return new Response(JSON.stringify(exaSearchFixture), { status: 200 });
			}
			const fixture = {
				...exaContentsFixture,
				results: [
					{
						...exaContentsFixture.results[0],
						text: options.exaUsable === false ? 'short' : usableContent,
						highlights:
							options.exaUsable === false
								? ['short']
								: [usableContent],
					},
				],
			};
			return new Response(JSON.stringify(fixture), { status: 200 });
		});

		const apifyFetch = vi.fn(async (url: string, init?: RequestInit) => {
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

		const budget = createBudgetTracker(5, 5);
		return {
			router: new CostAwareWebResearchRouter({
				exa: new ExaWebResearchProvider({ apiKey: 'exa-key', fetch: exaFetch }),
				apify: new ApifyWebExtractionProvider({ apiToken: 'apify-token', fetch: apifyFetch }),
				apifyFallbackEnabled: options.apifyEnabled ?? false,
				budget,
			}),
			budget,
			apifyFetch,
			exaFetch,
		};
	}

	it('does not call Apify when Exa extraction is usable', async () => {
		const { router, apifyFetch } = createRouter({ apifyEnabled: true, exaUsable: true });
		await router.fetch(
			{
				url: 'https://cbn.gov.ng/documents/circular-2026',
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'deep-research',
				briefId: 'brief_1',
				callKey: 'call_router_exa_ok',
				attempt: 1,
			},
			new AbortController().signal,
		);
		expect(apifyFetch).not.toHaveBeenCalled();
	});

	it('stops before the provider when the run-wide request limit is reached', async () => {
		const exaFetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'exa-key', fetch: exaFetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget: createBudgetTracker(5, 5),
			maxProviderRequests: 1,
		});
		const input = {
			query: 'test',
			market: 'nigeria' as const,
			tier: 1 as const,
			domains: [],
			startDate: '2026-07-01T00:00:00Z',
			endDate: '2026-07-23T00:00:00Z',
			maxResults: 10,
			phase: 'discovery' as const,
			briefId: null,
			attempt: 1,
		};

		await router.search(
			{ ...input, callKey: 'call_request_cap_1' },
			new AbortController().signal,
		);
		await expect(
			router.search(
				{ ...input, callKey: 'call_request_cap_2' },
				new AbortController().signal,
			),
		).rejects.toThrow('request limit');

		expect(exaFetch).toHaveBeenCalledTimes(1);
		expect(router.admittedRequestCount).toBe(1);
		expect(router.requestRejectionCount).toBe(1);
	});

	it('does not call Apify while APIFY_FALLBACK_ENABLED is false', async () => {
		const { router, apifyFetch } = createRouter({ apifyEnabled: false, exaUsable: false });
		await expect(
			router.fetch(
				{
					url: 'https://cbn.gov.ng/documents/circular-2026',
					market: 'nigeria',
					tier: 1,
					mode: 'highlights',
					evidenceQuestion: 'What changed?',
					maxCharacters: 4000,
					phase: 'deep-research',
					briefId: 'brief_1',
					callKey: 'call_router_no_apify',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow();
		expect(apifyFetch).not.toHaveBeenCalled();
	});

	it('falls back from Exa to raw-http and then Playwright at most once each', async () => {
		const { router, apifyFetch } = createRouter({ apifyEnabled: true, exaUsable: false });
		await router.fetch(
			{
				url: 'https://cbn.gov.ng/documents/circular-2026',
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'deep-research',
				briefId: 'brief_1',
				callKey: 'call_router_fallback',
				attempt: 1,
			},
			new AbortController().signal,
		);
		const startCalls = apifyFetch.mock.calls.filter((c) => String(c[0]).includes('/runs'));
		expect(startCalls.length).toBeGreaterThanOrEqual(1);
	});

	it('does not start a fallback whose admission estimate exceeds the remaining budget', async () => {
		const budget = createBudgetTracker(0.01, 0.01);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'exa-key',
				fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 })),
			}),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		await expect(
			router.search(
				{
					query: 'test',
					market: 'nigeria',
					tier: 1,
					domains: [],
					startDate: '2026-07-01T00:00:00Z',
					endDate: '2026-07-23T00:00:00Z',
					maxResults: 10,
					phase: 'discovery',
					briefId: null,
					callKey: 'call_budget_low',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow('budget exhausted');
	});

	it('reserves budget before concurrent provider work starts', async () => {
		let releaseFetch: (() => void) | undefined;
		const fetchGate = new Promise<void>((resolve) => {
			releaseFetch = resolve;
		});
		const exaFetch = vi.fn(async () => {
			await fetchGate;
			return new Response(JSON.stringify(exaSearchFixture), { status: 200 });
		});
		const budget = createBudgetTracker(0.02, 0.02);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'exa-key', fetch: exaFetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const input = {
			query: 'test',
			market: 'nigeria' as const,
			tier: 1 as const,
			domains: [],
			startDate: '2026-07-01T00:00:00Z',
			endDate: '2026-07-23T00:00:00Z',
			maxResults: 10,
			phase: 'discovery' as const,
			briefId: null,
			attempt: 1,
		};

		const first = router.search(
			{ ...input, callKey: 'call_concurrent_budget_1' },
			new AbortController().signal,
		);
		await vi.waitFor(() => expect(exaFetch).toHaveBeenCalledTimes(1));
		const second = router.search(
			{ ...input, callKey: 'call_concurrent_budget_2' },
			new AbortController().signal,
		);

		await expect(second).rejects.toThrow('budget exhausted');
		expect(exaFetch).toHaveBeenCalledTimes(1);
		releaseFetch?.();
		await first;
		expect(budget.admittedEstimateUsd).toBeCloseTo(0.02, 6);
	});

	it('charges the admission estimate when vendor cost is absent', async () => {
		const fixture = { ...exaSearchFixture, costDollars: undefined };
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'exa-key',
				fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 })),
			}),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		await router.search(
			{
				query: 'test',
				market: 'nigeria',
				tier: 1,
				domains: [],
				startDate: '2026-07-01T00:00:00Z',
				endDate: '2026-07-23T00:00:00Z',
				maxResults: 10,
				phase: 'discovery',
				briefId: null,
				callKey: 'call_unpriced',
				attempt: 1,
			},
			new AbortController().signal,
		);
		expect(budget.unpricedCallCount).toBe(1);
		expect(budget.actualCostUsd).toBeGreaterThan(0);
	});

	it('records one receipt for every success, failure and cancellation', async () => {
		const { router, budget } = createRouter();
		await router.search(
			{
				query: 'test',
				market: 'nigeria',
				tier: 1,
				domains: [],
				startDate: '2026-07-01T00:00:00Z',
				endDate: '2026-07-23T00:00:00Z',
				maxResults: 10,
				phase: 'discovery',
				briefId: null,
				callKey: 'call_receipt_1',
				attempt: 1,
			},
			new AbortController().signal,
		);
		expect(budget.receipts).toHaveLength(1);
	});

	it('records and charges a terminal failed provider attempt', async () => {
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'exa-key',
				fetch: vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })),
			}),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});

		await expect(
			router.search(
				{
					query: 'test',
					market: 'nigeria',
					tier: 1,
					domains: [],
					startDate: '2026-07-01T00:00:00Z',
					endDate: '2026-07-23T00:00:00Z',
					maxResults: 10,
					phase: 'discovery',
					briefId: null,
					callKey: 'call_failed_receipt',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow();

		expect(budget.receipts).toHaveLength(1);
		expect(budget.receipts[0]?.status).toBe('failed');
		expect(budget.actualCostUsd).toBeGreaterThan(0);
	});

	it('does not route terminal Exa authentication failures to Apify', async () => {
		const apifyFetch = vi.fn();
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'exa-key',
				fetch: vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })),
			}),
			apify: new ApifyWebExtractionProvider({ apiToken: 'apify-token', fetch: apifyFetch }),
			apifyFallbackEnabled: true,
			budget,
		});

		await expect(
			router.fetch(
				{
					url: 'https://cbn.gov.ng/documents/circular-2026',
					market: 'nigeria',
					tier: 1,
					mode: 'highlights',
					evidenceQuestion: 'What changed?',
					maxCharacters: 4000,
					phase: 'deep-research',
					briefId: 'brief_1',
					callKey: 'call_terminal_no_fallback',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow();

		expect(apifyFetch).not.toHaveBeenCalled();
	});

	it('uses distinct receipt IDs for Exa and Apify fallback attempts', async () => {
		const { router, budget } = createRouter({ apifyEnabled: true, exaUsable: false });
		await router.fetch(
			{
				url: 'https://cbn.gov.ng/documents/circular-2026',
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'deep-research',
				briefId: 'brief_1',
				callKey: 'call_unique_fallback_receipts',
				attempt: 1,
			},
			new AbortController().signal,
		);

		expect(new Set(budget.receipts.map((receipt) => receipt.receiptId)).size).toBe(
			budget.receipts.length,
		);
	});

	it('does not execute the same provider callKey twice within a run', async () => {
		const { router } = createRouter();
		const input = {
			query: 'test',
			market: 'nigeria' as const,
			tier: 1 as const,
			domains: [],
			startDate: '2026-07-01T00:00:00Z',
			endDate: '2026-07-23T00:00:00Z',
			maxResults: 10,
			phase: 'discovery' as const,
			briefId: null,
			callKey: 'call_dup',
			attempt: 1,
		};
		await router.search(input, new AbortController().signal);
		await expect(router.search(input, new AbortController().signal)).rejects.toThrow('Duplicate');
	});

	it('honors Retry-After before retrying a 429 response', async () => {
		const sleep = vi.fn().mockResolvedValue(undefined);
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('rate limited', {
					status: 429,
					headers: { 'Retry-After': '2' },
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget: createBudgetTracker(5, 5),
			sleep,
			random: () => 0,
			maxExaAttempts: 2,
		});

		await router.search(
			{
				query: 'test',
				market: 'nigeria',
				tier: 1,
				domains: [],
				startDate: '2026-07-01T00:00:00Z',
				endDate: '2026-07-23T00:00:00Z',
				maxResults: 10,
				phase: 'discovery',
				briefId: null,
				callKey: 'call_retry_after',
				attempt: 1,
			},
			new AbortController().signal,
		);

		expect(sleep).toHaveBeenCalledWith(2000);
	});

	it('does not retry a failed Exa request unless retries are explicitly enabled', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response('rate limited', {
				status: 429,
				headers: { 'Retry-After': '2' },
			}),
		);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget: createBudgetTracker(5, 5),
		});

		await expect(
			router.search(
				{
					query: 'test',
					market: 'nigeria',
					tier: 1,
					domains: [],
					startDate: '2026-07-01T00:00:00Z',
					endDate: '2026-07-23T00:00:00Z',
					maxResults: 10,
					phase: 'discovery',
					briefId: null,
					callKey: 'call_no_implicit_retry',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow();

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(router.admittedRequestCount).toBe(1);
	});

	it('does not start a second Apify Actor after an ambiguous start response', async () => {
		const apifyFetch = vi.fn(async (url: string) => {
			if (url.includes('/runs')) return new Response('{}', { status: 500 });
			return new Response('{}', { status: 404 });
		});
		const provider = new ApifyWebExtractionProvider({ apiToken: 'token', fetch: apifyFetch });
		const input = {
			url: 'https://cbn.gov.ng/documents/circular-2026',
			market: 'nigeria' as const,
			tier: 1 as const,
			mode: 'raw-http' as const,
			evidenceQuestion: 'What?',
			maxCharacters: 4000,
			phase: 'deep-research' as const,
			briefId: 'brief_1',
			callKey: 'call_ambiguous',
			attempt: 1,
		};
		await expect(provider.fetch(input, new AbortController().signal)).rejects.toThrow();
		await expect(provider.fetch(input, new AbortController().signal)).rejects.toThrow('Ambiguous');
		const startCalls = apifyFetch.mock.calls.filter((c) => String(c[0]).includes('/runs'));
		expect(startCalls).toHaveLength(1);
	});
});

describe('provider audit emission', () => {
	function auditEvents(log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }) {
		return [...log.info.mock.calls, ...log.warn.mock.calls]
			.filter(([message]) => message === RESEARCH_AUDIT_LOG_MESSAGE)
			.map(([, attrs]) => attrs as Record<string, unknown>);
	}

	it('records budget_admission_rejected without provider_attempt_started', async () => {
		const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
		const audit = createResearchAuditEmitter(log as never, 'audit-run', () => '2026-07-23T10:00:00.000Z');
		const budget = createBudgetTracker(0, 0);
		const exaFetch = vi.fn(async () => new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'exa-key', fetch: exaFetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
			audit,
		});

		await expect(
			router.search(
				{
					query: 'test',
					market: 'nigeria',
					tier: 1,
					domains: [],
					startDate: '2026-07-01T00:00:00Z',
					endDate: '2026-07-23T00:00:00Z',
					maxResults: 10,
					phase: 'discovery',
					briefId: null,
					callKey: 'call_budget',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow();

		const events = auditEvents(log);
		expect(events.some((event) => event.auditEvent === 'budget_admission_rejected')).toBe(true);
		expect(events.some((event) => event.auditEvent === 'provider_attempt_started')).toBe(false);
	});
});
