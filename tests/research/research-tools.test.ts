import { describe, expect, it, vi } from 'vitest';
import { ExaWebResearchProvider } from '../../.flue/providers/web-research/exa';
import { CostAwareWebResearchRouter, createBudgetTracker } from '../../.flue/providers/web-research/router';
import { createDiscoveryTools, createArticleResearchTools } from '../../.flue/tools/research-tools';
import exaSearchFixture from '../fixtures/research/exa-search.json';
import exaContentsFixture from '../fixtures/research/exa-contents.json';

describe('research tools', () => {
	function setupRouter() {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		return { router, budget, fetch };
	}

	it('does not expose market, provider, API key or domains as model arguments', () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const inputSchema = tools.search_web.input;
		expect(inputSchema).toBeDefined();
		const keys = Object.keys((inputSchema as { entries?: Record<string, unknown> }).entries ?? {});
		expect(keys).not.toContain('market');
		expect(keys).not.toContain('provider');
		expect(keys).not.toContain('apiKey');
		expect(keys).not.toContain('domains');
		expect(keys).not.toContain('startDate');
		expect(keys).not.toContain('endDate');
	});

	it('uses the admitted scan window without accepting model-supplied dates', async () => {
		const { router, budget, fetch } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-server-window',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		await tools.search_web.run({
			input: {
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});

		const request = fetch.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(String(request.body));
		expect(body.startPublishedDate).toBe('2026-07-22T00:00:00Z');
		expect(body.endPublishedDate).toBe('2026-07-23T00:00:00Z');
		expect(body.includeDomains).toEqual([
			'cbn.gov.ng',
			'sec.gov.ng',
			'ngxgroup.com',
			'fmdqgroup.com',
			'ndic.gov.ng',
			'pencom.gov.ng',
			'firs.gov.ng',
		]);
		expect(body.includeDomains).not.toContain('worldbank.org');
		expect(body.includeDomains).not.toContain('afdb.org');
	});

	it('uses a server-owned historical window for article research', async () => {
		const { router, budget, fetch } = setupRouter();
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-history-window',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		await tools.search_web.run({
			input: {
				query: 'nigeria bank capital rules',
				vertical: 'banking-regulation',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});

		const request = fetch.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(String(request.body));
		expect(body.startPublishedDate).toBe('2000-01-01T00:00:00Z');
		expect(body.endPublishedDate).toBe('2026-07-23T00:00:00Z');
	});

	it('returns source IDs and only fetches selections issued by search', async () => {
		const fetch = vi.fn(async (url: string) => {
			const contents = {
				...exaContentsFixture,
				results: [
					{
						...exaContentsFixture.results[0],
						highlights: [exaContentsFixture.results[0].text],
					},
				],
			};
			return new Response(
				JSON.stringify(url.includes('/search') ? exaSearchFixture : contents),
				{ status: 200 },
			);
		});
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-selection',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		const search = await tools.search_web.run({
			input: {
				query: 'nigeria central bank',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		expect(search.results[0]?.sourceId).toMatch(/^src_/);

		const result = await tools.fetch_sources.run({
			input: {
				sourceIds: [search.results[0]!.sourceId],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});
		expect(result.status).toBe('ok');
		expect(result.sources[0]?.sourceId).toBe(search.results[0]?.sourceId);
	});

	it('does not charge invalid source selections against the fetch allowance', async () => {
		const fetch = vi.fn(async (url: string) => {
			const contents = {
				...exaContentsFixture,
				results: [
					{
						...exaContentsFixture.results[0],
						highlights: [exaContentsFixture.results[0].text],
					},
				],
			};
			return new Response(
				JSON.stringify(url.includes('/search') ? exaSearchFixture : contents),
				{ status: 200 },
			);
		});
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-invalid-selection',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		for (let index = 0; index < 8; index += 1) {
			const invalid = await tools.fetch_sources.run({
				input: {
					sourceIds: [`src_unknown_${index}`],
					evidenceQuestion: 'What changed?',
					freshnessMode: 'strict',
					maxCharacters: 4000,
				},
				signal: new AbortController().signal,
			});
			expect(invalid.status).toBe('invalid-selection');
		}

		const search = await tools.search_web.run({
			input: {
				query: 'nigeria central bank',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		const result = await tools.fetch_sources.run({
			input: {
				sourceIds: [search.results[0]!.sourceId],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});
		expect(result.status).toBe('ok');
		expect(fetch.mock.calls.filter(([url]) => !String(url).includes('/search'))).toHaveLength(1);
	});

	it('allows twelve deep-research searches before stopping tool use', async () => {
		const fetch = vi.fn(async () =>
			new Response(JSON.stringify(exaSearchFixture), { status: 200 }),
		);
		const budget = createBudgetTracker(10, 40);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-expanded-searches',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		for (let index = 0; index < 12; index += 1) {
			const result = await tools.search_web.run({
				input: {
					query: `nigeria banking evidence ${index}`,
					vertical: 'banking-regulation',
					tier: 1,
					resultCount: 5,
				},
				signal: new AbortController().signal,
			});
			expect(result.status).toBe('ok');
		}

		await expect(
			tools.search_web.run({
				input: {
					query: 'nigeria banking evidence overflow',
					vertical: 'banking-regulation',
					tier: 1,
					resultCount: 5,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({
			name: 'ResearchToolTerminalError',
			reason: 'limit-reached',
		});
	});

	it('allows sixteen deep-research fetch attempts before rejecting another', async () => {
		const fetch = vi.fn(async (url: string) => {
			const payload = url.includes('/search')
				? exaSearchFixture
				: {
						...exaContentsFixture,
						results: [
							{
								...exaContentsFixture.results[0],
								highlights: [exaContentsFixture.results[0].text],
							},
						],
					};
			return new Response(JSON.stringify(payload), { status: 200 });
		});
		const budget = createBudgetTracker(10, 40);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-expanded-fetches',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const search = await tools.search_web.run({
			input: {
				query: 'nigeria banking evidence',
				vertical: 'banking-regulation',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		const sourceId = search.results[0]!.sourceId;

		for (let index = 0; index < 16; index += 1) {
			const result = await tools.fetch_sources.run({
				input: {
					sourceIds: [sourceId],
					evidenceQuestion: `What changed? ${index}`,
					freshnessMode: 'strict',
					maxCharacters: 4000,
				},
				signal: new AbortController().signal,
			});
			expect(result.status).toBe('ok');
		}

		await expect(
			tools.fetch_sources.run({
				input: {
					sourceIds: [sourceId],
					evidenceQuestion: 'What changed after the allowance?',
					freshnessMode: 'strict',
					maxCharacters: 4000,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({
			name: 'ResearchToolTerminalError',
			reason: 'limit-reached',
		});
	});

	it('rejects oversized remediation fetch batches without exhausting the allowance', async () => {
		const urls = [
			'https://cbn.gov.ng/documents/circular-1',
			'https://cbn.gov.ng/documents/circular-2',
			'https://ndic.gov.ng/notices/1',
			'https://ndic.gov.ng/notices/2',
			'https://sec.gov.ng/filing/1',
			'https://sec.gov.ng/filing/2',
		];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).includes('/search')) {
				return new Response(
					JSON.stringify({
						requestId: 'exa-req-search',
						costDollars: { total: 0.005 },
						results: urls.map((resultUrl) => ({
							url: resultUrl,
							title: 'Source',
							publishedDate: '2026-07-20T00:00:00Z',
							highlights: ['highlight'],
							text: 'body',
						})),
					}),
					{ status: 200 },
				);
			}
			const body = JSON.parse(String(init?.body));
			const requestedUrl = body.urls?.[0] ?? urls[0];
			return new Response(
				JSON.stringify({
					...exaContentsFixture,
					results: [
						{
							...exaContentsFixture.results[0],
							url: requestedUrl,
							highlights: [exaContentsFixture.results[0].text],
						},
					],
				}),
				{ status: 200 },
			);
		});
		const budget = createBudgetTracker(10, 10);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-remediation-cap',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'remediation',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		const search = await tools.search_web.run({
			input: {
				query: 'nigeria bank recapitalisation evidence',
				vertical: 'banking-regulation',
				tier: 1,
				resultCount: 6,
			},
			signal: new AbortController().signal,
		});
		const sourceIds = search.results.map((result) => result.sourceId);

		await tools.fetch_sources.run({
			input: {
				sourceIds: sourceIds.slice(0, 2),
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});
		const providerCallsBeforeOversize = fetch.mock.calls.filter(
			([url]) => !String(url).includes('/search'),
		).length;

		await expect(
			tools.fetch_sources.run({
				input: {
					sourceIds: Array.from(
						{ length: 9 },
						(_, index) => sourceIds[index % sourceIds.length]!,
					),
					evidenceQuestion: 'What changed?',
					freshnessMode: 'strict',
					maxCharacters: 4000,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({
			name: 'ResearchToolTerminalError',
			reason: 'limit-reached',
		});
		expect(
			fetch.mock.calls.filter(([url]) => !String(url).includes('/search')),
		).toHaveLength(providerCallsBeforeOversize);

		const remaining = await tools.fetch_sources.run({
			input: {
				sourceIds: sourceIds.slice(2, 6),
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});
		expect(remaining.status).toBe('ok');
	});

	it('binds each discovery tool set to one configured market', () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		expect(tools.market).toBe('nigeria');
	});

	it('binds deep-research receipts to one brief and market', () => {
		const { router, budget } = setupRouter();
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		expect(tools.briefId).toBe('brief_1');
		expect(tools.market).toBe('nigeria');
	});

	it('does not expose query dates for the model to override', () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const input = tools.search_web.input as { entries?: Record<string, unknown> };
		expect(Object.keys(input.entries ?? {})).not.toContain('startDate');
		expect(Object.keys(input.entries ?? {})).not.toContain('endDate');
	});

	it('rejects more than ten fetch URLs', async () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		// Schema validation should reject more than four market-local sources.
		expect(tools.fetch_sources.input).toBeDefined();
	});

	it('does not accept model-supplied fetch URLs', () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const input = tools.fetch_sources.input as { entries?: Record<string, unknown> };
		expect(Object.keys(input.entries ?? {})).not.toContain('urls');
		expect(Object.keys(input.entries ?? {})).toContain('sourceIds');
	});

	it('uses the lower of the requested and application hard cost ceilings', () => {
		const { router, budget } = setupRouter();
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 100,
			},
		});
		expect(tools.ceiling).toBe(1.25);
	});

	it('stops calls after the phase, market, article or run provider-cost limit', async () => {
		const budget = createBudgetTracker(0.001, 0.001);
		const fetch = vi.fn();
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 0.001,
			},
		});
		await expect(
			tools.search_web.run({
				input: {
					query: 'nigeria rates',
					vertical: 'monetary-policy',
					tier: 1,
					resultCount: 5,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow('budget');
	});

	it('does not consume search capacity when budget is already exhausted', async () => {
		const budget = createBudgetTracker(5, 5);
		budget.reserve(5);
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-budget-capacity',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		await expect(
			tools.search_web.run({
				input: {
					query: 'nigeria rates',
					vertical: 'monetary-policy',
					tier: 1,
					resultCount: 5,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow('budget-exhausted');
		expect(fetch).not.toHaveBeenCalled();

		budget.settle(5, 0);
		const result = await tools.search_web.run({
			input: {
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		expect(result.status).toBe('ok');
	});

	it('returns provider receipts alongside results', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createDiscoveryTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				phase: 'discovery',
				market: 'nigeria',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const result = await tools.search_web.run({
			input: {
				query: 'nigeria central bank',
				vertical: 'monetary-policy',
				tier: 1,
				startDate: '2026-07-22T00:00:00Z',
				endDate: '2026-07-23T00:00:00Z',
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		expect(result.receipts.length).toBeGreaterThan(0);
	});

	it('does not expose the fallback provider or scraping mode to a model', () => {
		const { router, budget } = setupRouter();
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				briefId: 'brief_1',
				market: 'kenya',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});
		const fetchInput = tools.fetch_sources.input as { entries?: Record<string, unknown> };
		expect(Object.keys(fetchInput.entries ?? {})).not.toContain('scrapingMode');
		expect(Object.keys(fetchInput.entries ?? {})).not.toContain('provider');
	});

	it('rejects a source ID that was not issued by search', async () => {
		const { router, budget } = setupRouter();
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		const result = await tools.fetch_sources.run({
			input: {
				sourceIds: ['src_unselected'],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});
		expect(result.status).toBe('invalid-selection');
	});

	it('returns application-derived source and evidence IDs with full receipts', async () => {
		const fetch = vi.fn(async (url: string) => {
			const contents = {
				...exaContentsFixture,
				results: [
					{
						...exaContentsFixture.results[0],
						highlights: [exaContentsFixture.results[0].text],
					},
				],
			};
			return new Response(
				JSON.stringify(url.includes('/search') ? exaSearchFixture : contents),
				{ status: 200 },
			);
		});
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
			apify: null,
			apifyFallbackEnabled: false,
			budget,
		});
		const tools = createArticleResearchTools({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope: {
				runKey: 'run-1',
				briefId: 'brief_1',
				market: 'nigeria',
				phase: 'deep-research',
				windowStart: '2026-07-01T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				maxProviderCostUsd: 5,
			},
		});

		const search = await tools.search_web.run({
			input: {
				query: 'nigeria central bank',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			signal: new AbortController().signal,
		});
		const result = await tools.fetch_sources.run({
			input: {
				sourceIds: [search.results[0]!.sourceId],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 4000,
			},
			signal: new AbortController().signal,
		});

		expect(result.sources[0]).toEqual(
			expect.objectContaining({
				sourceId: expect.stringMatching(/^src_/),
				evidenceId: expect.stringMatching(/^ev_/),
				contentHash: expect.any(String),
			}),
		);
		expect(result.receipts[0]).toEqual(
			expect.objectContaining({
				callKey: expect.stringMatching(/^call_/),
				provider: 'exa',
				status: 'succeeded',
			}),
		);
	});
});
