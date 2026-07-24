import { describe, expect, it, vi } from 'vitest';
import { createResearchAdminMiddleware } from '../../.flue/auth/research-admin';
import { discoveryResearcherProfiles } from '../../.flue/agents/profiles/discovery-orchestrator';
import { briefValidator } from '../../.flue/agents/profiles/brief-validator';
import { regionResearcherProfiles } from '../../.flue/agents/profiles/region-researcher';
import { runFoundationalResearch } from '../../.flue/actions/run-foundational-research';
import { ApifyWebExtractionProvider } from '../../.flue/providers/web-research/apify';
import { ExaWebResearchProvider } from '../../.flue/providers/web-research/exa';
import { isUsableExtraction, truncateContent } from '../../.flue/providers/web-research/extraction-quality';
import { CostAwareWebResearchRouter, createBudgetTracker } from '../../.flue/providers/web-research/router';
import { MAX_NORMALIZED_CONTENT_CHARS } from '../../.flue/providers/web-research/provider';
import { ProviderError } from '../../.flue/providers/web-research/provider-errors';
import { assertPublicHttpsUrl } from '../../.flue/providers/web-research/url-policy';
import { auditArticleResearch } from '../../.flue/research/audit';
import { allocateArticleBudgets } from '../../.flue/research/budget';
import {
	executeResearchPipeline,
	resolveArticleStatus,
	resolveRunStatus,
	type ResearchDelegator,
} from '../../.flue/research/pipeline';
import { reconcileReviewWithPacket } from '../../.flue/research/review';
import { createResearchRuntime } from '../../.flue/research/runtime';
import type { ArticleResearchBrief, DiscoveryPortfolio, DiscoveryRunRequest } from '../../.flue/research/schemas';
import {
	createArticleResearchTools,
	createDiscoveryTools,
	inferMarketFromUrl,
	resolveDiscoveryMarket,
} from '../../.flue/tools/research-tools';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';
import briefValidationsFixture from '../fixtures/research/brief-validations.json';
import reviewerPassFixture from '../fixtures/research/reviewer-pass.json';
import reviewerNeedsMoreFixture from '../fixtures/research/reviewer-needs-more.json';
import regionResultsFixture from '../fixtures/research/region-results.json';
import apifyRunFixture from '../fixtures/research/apify-fetch.json';
import exaSearchFixture from '../fixtures/research/exa-search.json';

const usableContent =
	'The Central Bank of Nigeria announced new capital requirements for deposit money banks. The minimum capital adequacy ratio has been raised to 15 percent effective fourth quarter 2026. Banks must submit compliance plans within 90 days. Tier 1 capital definitions remain unchanged. Foreign currency exposures must be reported monthly. Penalties for non-compliance include restrictions on dividend payments and new branch openings. Additional supervisory guidance will follow in August.';

const VALID_TOKEN = 'a'.repeat(32);
const baseRequest: DiscoveryRunRequest = {
	runKey: 'scan-invariants',
	trigger: 'manual',
	window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
	focus: null,
	maxDiscoveredBriefs: 30,
	maxAcceptedBriefs: 10,
	maxProviderCostUsd: 5,
};

function createFakeDelegator(overrides: Partial<ResearchDelegator> = {}): ResearchDelegator {
	let reviewCallCount = 0;
		return {
			discover: vi.fn(async () => discoveryPortfolioFixture as DiscoveryPortfolio),
		validateBrief: vi.fn(async (input) => {
			const brief = input.brief;
			const key = brief.briefId as keyof typeof briefValidationsFixture;
				return briefValidationsFixture[key] ?? briefValidationsFixture.brief_accept;
			}),
			refineBrief: vi.fn(async (brief) => ({
				...brief,
				briefId: `${brief.briefId}_refined`,
			})),
		research: vi.fn(async (brief, market) => ({
			...regionResultsFixture[0],
			briefId: brief.briefId,
			market,
		})),
			analyze: vi.fn(async ({ brief, sourceAudit }) => ({
			briefId: brief.briefId,
			packetVersion: 'v1',
			facts: ['fact'],
			editorsQuestions: Array.from({ length: 10 }, (_, i) => ({
				question: `Q${i}?`,
				answer: 'A',
				gap: null,
			})),
			dependencyGraph: {
				primaryActors: [],
				adjacentActors: [],
				infrastructure: [],
				regulators: [],
				customers: [],
				capitalMarkets: [],
			},
			analysisLayers: {
				layer1WhatChanged: 'x',
				layer2IsNew: 'x',
				layer3WhoLoses: 'x',
				layer4PricingPower: 'x',
				layer5StackCollapse: 'x',
				layer6InstitutionalPower: 'x',
				layer7WhatBecomesPossible: 'x',
			},
			storyOptions: [
				{ title: 'A', angle: 'a', audience: 'a' },
				{ title: 'B', angle: 'b', audience: 'b' },
				{ title: 'C', angle: 'c', audience: 'c' },
			],
			recommendedLede: 'lede',
			whyItMatters: 'why',
			howItChangesThings: 'how',
			actorActionability: [],
			missingFacts: [],
				supportingSourceIds: sourceAudit.sources.map((source) => source.sourceId),
				supportingEvidenceIds: sourceAudit.evidence.map((evidence) => evidence.evidenceId),
		})),
		review: vi.fn(async ({ brief }) => {
			reviewCallCount++;
			if (reviewCallCount === 1 && brief.briefId === 'brief_accept') {
				return reviewerNeedsMoreFixture;
			}
			return reviewerPassFixture;
		}),
		...overrides,
	};
}

describe('plan invariants', () => {
	it('shouldNotAllowDiscoveryToDropMandatoryMarketCoverage', async () => {
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				coverage: discoveryPortfolioFixture.coverage.slice(0, 1),
			})),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.status).toBe('failed');
	});

	it('shouldNotParseBodyBeforeResearchAdminAuthentication', async () => {
		const middleware = createResearchAdminMiddleware(() => VALID_TOKEN);
		let bodyRead = false;
		const ctx = {
			c: {
				req: {
					url: 'https://example.com/workflows/market-intelligence-scan',
					header: (name: string) => (name === 'Authorization' ? undefined : undefined),
					json: async () => {
						bodyRead = true;
						return {};
					},
				},
			},
			next: async () => new Response('ok'),
		};
		const response = await middleware(ctx.c as never, ctx.next);
		expect(response?.status).toBe(401);
		expect(bodyRead).toBe(false);
	});

	it('shouldNotAcceptResearchAdminTokenFromUrl', async () => {
		const middleware = createResearchAdminMiddleware(() => VALID_TOKEN);
		const ctx = {
			c: {
				req: {
					url: 'https://example.com/workflows/market-intelligence-scan?token=secret',
					header: () => undefined,
				},
			},
			next: async () => new Response('ok'),
		};
		const response = await middleware(ctx.c as never, ctx.next);
		expect(response?.status).toBe(401);
	});

	it('shouldNotLetDiscoveryValidateItsOwnBrief', () => {
		for (const profile of discoveryResearcherProfiles) {
			expect(profile.name).not.toBe(briefValidator.name);
		}
	});

	it('shouldNotCollapseMultipleAcceptedBriefsIntoOneOutcome', async () => {
		const portfolio = {
			...discoveryPortfolioFixture,
			briefs: [
				discoveryPortfolioFixture.briefs[0],
				{ ...discoveryPortfolioFixture.briefs[0], briefId: 'brief_accept_2', workingTitle: 'Second brief' },
			],
		};
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => portfolio as DiscoveryPortfolio),
			validateBrief: vi.fn(async (input) => ({
				...briefValidationsFixture.brief_accept,
				briefId: input.brief.briefId,
			})),
			review: vi.fn(async () => reviewerPassFixture),
		});
		const result = await executeResearchPipeline(
			{ delegator },
			{ ...baseRequest, maxAcceptedBriefs: 2 },
		);
		expect(result.articles).toHaveLength(2);
	});

	it('shouldNotDeepResearchRejectedOrDuplicateBrief', async () => {
		const delegator = createFakeDelegator({ review: vi.fn(async () => reviewerPassFixture) });
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(delegator.research).toHaveBeenCalledTimes(1);
		expect(result.rejectedBriefs.some((r) => r.brief.briefId === 'brief_reject')).toBe(true);
	});

	it('shouldNotExposeProviderCredentialToModel', async () => {
		const API_KEY = 'super-secret-exa-key-value';
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 }));
		const provider = new ExaWebResearchProvider({ apiKey: API_KEY, fetch });
		const tools = createDiscoveryTools({
			router: new CostAwareWebResearchRouter({
				exa: provider,
				apify: null,
				apifyFallbackEnabled: false,
				budget: createBudgetTracker(5, 5),
			}),
			budget: createBudgetTracker(5, 5),
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
		const schema = tools.search_web.input as { entries?: Record<string, unknown> };
		expect(Object.keys(schema.entries ?? {})).not.toContain('apiKey');
		expect(JSON.stringify(tools.search_web)).not.toContain(API_KEY);
	});

	it('shouldNotUseApifySearchInRuntimeDiscovery', () => {
		expect(typeof ApifyWebExtractionProvider.prototype.fetch).toBe('function');
		expect((ApifyWebExtractionProvider.prototype as { search?: unknown }).search).toBeUndefined();
	});

	it('shouldNotEnableUnbenchmarkedApifyFallback', () => {
		expect(() =>
			createResearchRuntime(baseRequest, {
				EXA_API_KEY: 'test-key',
				APIFY_FALLBACK_ENABLED: 'false',
			}),
		).not.toThrow();
		const runtime = createResearchRuntime(baseRequest, {
			EXA_API_KEY: 'test-key',
			APIFY_FALLBACK_ENABLED: 'false',
		});
		expect(runtime.router).toBeDefined();
	});

	it('shouldNotLetModelSelectProviderOrScrapingMode', () => {
		const { router, budget } = {
			router: new CostAwareWebResearchRouter({
				exa: new ExaWebResearchProvider({
					apiKey: 'key',
					fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(exaSearchFixture))),
				}),
				apify: null,
				apifyFallbackEnabled: false,
				budget: createBudgetTracker(5, 5),
			}),
			budget: createBudgetTracker(5, 5),
		};
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
		const keys = Object.keys((tools.fetch_sources.input as { entries?: Record<string, unknown> }).entries ?? {});
		expect(keys).not.toContain('provider');
		expect(keys).not.toContain('scrapingMode');
	});

	it('shouldNotSendUnselectedUrlToApify', async () => {
		const apifyFetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.includes('/runs') && init?.method === 'POST') {
				return new Response(JSON.stringify(apifyRunFixture), { status: 201 });
			}
			if (url.includes('/actor-runs/')) {
				return new Response(JSON.stringify(apifyRunFixture), { status: 200 });
			}
			if (url.includes('/datasets/')) {
				return new Response(
					JSON.stringify([
						{
							url: 'https://cbn.gov.ng/documents/circular-2026',
							title: 'CBN Circular',
							markdown: usableContent,
						},
					]),
					{ status: 200 },
				);
			}
			return new Response('{}', { status: 404 });
		});
		const exaFetch = vi.fn(async (url: string) => {
			if (url.includes('/search')) {
				return new Response(JSON.stringify(exaSearchFixture), { status: 200 });
			}
			return new Response(
				JSON.stringify({
					results: [{ text: 'short', highlights: ['short'], title: 'Short', url: 'https://cbn.gov.ng/documents/circular-2026' }],
				}),
				{ status: 200 },
			);
		});
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: 'key', fetch: exaFetch }),
			apify: new ApifyWebExtractionProvider({ apiToken: 'token', fetch: apifyFetch }),
			apifyFallbackEnabled: true,
			budget,
		});
		const targetUrl = 'https://cbn.gov.ng/documents/circular-2026';
		await router.fetch(
			{
				url: targetUrl,
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'deep-research',
				briefId: 'brief_1',
				callKey: 'call_selected_url',
				attempt: 1,
			},
			new AbortController().signal,
		);
		const apifyBodies = apifyFetch.mock.calls
			.filter((c) => String(c[0]).includes('/runs') && (c[1] as RequestInit | undefined)?.method === 'POST')
			.map((c) => JSON.parse((c[1] as RequestInit).body as string));
		expect(apifyBodies.every((body) => body.query === targetUrl)).toBe(true);
	});

	it('shouldNotAdmitPrivateInputOrAcceptPrivateFinalUrl', async () => {
		await expect(assertPublicHttpsUrl('https://127.0.0.1/doc')).rejects.toThrow();
		const quality = isUsableExtraction({
			content: 'x'.repeat(500),
			title: 'Test',
			finalUrl: 'http://insecure.example.com',
			hasError: false,
		});
		expect(quality.usable).toBe(false);
	});

	it('shouldNotTreatMissingProviderCostAsZero', async () => {
		const fixture = { ...exaSearchFixture, costDollars: undefined };
		const budget = createBudgetTracker(5, 5);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'key',
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
				callKey: 'call_unpriced_invariant',
				attempt: 1,
			},
			new AbortController().signal,
		);
		expect(budget.unpricedCallCount).toBe(1);
		expect(budget.actualCostUsd).toBeGreaterThan(0);
	});

	it('shouldNotStartProviderCallBeyondItsBudgetAllocation', async () => {
		const budget = createBudgetTracker(0.001, 0.001);
		const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({
				apiKey: 'key',
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
					callKey: 'call_over_budget',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toThrow('budget');
	});

	it('shouldNotChangeArticleAllocationFromConcurrentCompletionOrder', () => {
		const briefs = [
			{ briefId: 'a', markets: ['nigeria'] },
			{ briefId: 'b', markets: ['kenya'] },
		] as ArticleResearchBrief[];
		const first = allocateArticleBudgets(briefs, 5);
		const second = allocateArticleBudgets(briefs, 5);
		expect(first.get('a')?.totalUsd).toBe(second.get('a')?.totalUsd);
		expect(first.get('b')?.totalUsd).toBe(second.get('b')?.totalUsd);
	});

	it('allocates independent deep-research and remediation trackers per market', () => {
		const brief = {
			briefId: 'multi-market',
			markets: ['nigeria', 'kenya'],
		} as ArticleResearchBrief;
		const allocation = allocateArticleBudgets([brief], 5).get(brief.briefId);

		expect(allocation).toBeDefined();
		expect(allocation).toHaveProperty('marketTrackers.nigeria');
		expect(allocation).toHaveProperty('marketTrackers.kenya');
		expect(allocation).toHaveProperty('remediationTrackers.nigeria');
		expect(allocation).toHaveProperty('remediationTrackers.kenya');
	});

	it('shouldNotExecuteDuplicateProviderCallKeyWithinRun', async () => {
		const { router } = {
			router: new CostAwareWebResearchRouter({
				exa: new ExaWebResearchProvider({
					apiKey: 'key',
					fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(exaSearchFixture), { status: 200 })),
				}),
				apify: null,
				apifyFallbackEnabled: false,
				budget: createBudgetTracker(5, 5),
			}),
		};
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
			callKey: 'dup_key',
			attempt: 1,
		};
		await router.search(input, new AbortController().signal);
		await expect(router.search(input, new AbortController().signal)).rejects.toThrow('Duplicate');
	});

	it('shouldNotRestartApifyActorAfterAmbiguousStartResponse', async () => {
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
			callKey: 'call_ambiguous_invariant',
			attempt: 1,
		};
		await expect(provider.fetch(input, new AbortController().signal)).rejects.toThrow();
		await expect(provider.fetch(input, new AbortController().signal)).rejects.toThrow('Ambiguous');
	});

	it('shouldNotPersistCompleteThirdPartyPageBody', () => {
		const huge = 'word '.repeat(20_000);
		expect(truncateContent(huge, MAX_NORMALIZED_CONTENT_CHARS).length).toBeLessThanOrEqual(
			MAX_NORMALIZED_CONTENT_CHARS,
		);
	});

	it('shouldNotLetNigeriaToolAdmitKenyaScope', () => {
		const tools = createArticleResearchTools({
			router: new CostAwareWebResearchRouter({
				exa: new ExaWebResearchProvider({
					apiKey: 'key',
					fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(exaSearchFixture))),
				}),
				apify: null,
				apifyFallbackEnabled: false,
				budget: createBudgetTracker(5, 5),
			}),
			budget: createBudgetTracker(5, 5),
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
		expect(tools.market).toBe('nigeria');
		expect(inferMarketFromUrl('https://cbk.or.ke/policy')).toBe('kenya');
		expect(resolveDiscoveryMarket('generic query', 1)).toBe('kenya');
	});

	it('shouldNotTreatSearchSnippetAsPassingEvidence', () => {
		const snippet = 'CBN raised CAR to 15%';
		const quality = isUsableExtraction({
			content: snippet,
			title: 'Search hit',
			finalUrl: 'https://cbn.gov.ng/doc',
			hasError: false,
		});
		expect(quality.usable).toBe(false);
	});

	it('shouldNotAcceptSocialOnlyMaterialClaim', async () => {
		const brief = {
			briefId: 'brief_1',
			workingTitle: 'Social claim',
			thesis: 'x',
			signalSummary: 'x',
			markets: ['nigeria' as const],
			verticals: ['banking-regulation'],
			discoverySourceIds: [],
			discoveryEvidenceIds: [],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: [],
			secondarySourceTargets: [],
			exclusions: [],
			evidenceRequirements: [
				{
					requirementId: 'req_social',
					market: 'nigeria',
					question: 'Are banks insolvent?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['insolvent'],
					recencyRule: 'none',
				},
			],
		};
		const audit = await auditArticleResearch(brief, [
			{
				briefId: 'brief_1',
				market: 'nigeria',
				status: 'complete',
				receipts: [],
				sources: [
					{
						sourceId: 'src_social',
						canonicalUrl: 'https://twitter.com/user/status/1',
						title: 'Tweet',
						publisher: null,
						author: null,
						publishedAt: null,
						retrievedAt: '2026-07-23T00:00:00Z',
						market: 'nigeria',
						tier: 3,
						sourceType: 'social',
						receiptIds: [],
						contentHash: null,
						rightsNote: null,
					},
				],
				evidence: [
					{
						evidenceId: 'ev_social',
						sourceId: 'src_social',
						text: 'Banks are struggling',
						supports: [],
						capturedAt: '2026-07-23T00:00:00Z',
					},
				],
				claims: [
					{
						claimId: 'claim_social',
						statement: 'Banks are insolvent',
						kind: 'fact',
						materiality: 'high',
						requirementIds: ['req_social'],
						supportingEvidenceIds: ['ev_social'],
						contradictingEvidenceIds: [],
						status: 'supported',
					},
				],
				gaps: [],
			},
		]);
		expect(audit.claims[0]?.status).toBe('unsupported');
	});

	it('shouldNotLoseContradictingEvidenceDuringDeduplication', async () => {
		const brief = {
			briefId: 'brief_1',
			workingTitle: 'Contradiction',
			thesis: 'x',
			signalSummary: 'x',
			markets: ['nigeria' as const],
			verticals: ['banking-regulation'],
			discoverySourceIds: [],
			discoveryEvidenceIds: [],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: [],
			secondarySourceTargets: [],
			exclusions: [],
			evidenceRequirements: [
				{
					requirementId: 'req_social',
					market: 'nigeria',
					question: 'Are banks insolvent?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['insolvent'],
					recencyRule: 'none',
				},
			],
		};
		const audit = await auditArticleResearch(brief, [
			{
				...regionResultsFixture[0],
				evidence: [
					{
						evidenceId: 'ev_a',
						sourceId: 'src_1',
						text: 'Rate is 15%',
						supports: ['claim_1'],
						capturedAt: '2026-07-23T00:00:00Z',
					},
					{
						evidenceId: 'ev_b',
						sourceId: 'src_2',
						text: 'Rate is 12%',
						supports: ['claim_1'],
						capturedAt: '2026-07-23T00:00:00Z',
					},
				],
			},
		]);
		expect(audit.evidence).toHaveLength(2);
	});

	it('shouldNotPassChangedPacketUsingOldReview', () => {
		const structuralPacket = {
			briefId: 'brief_1',
			packetVersion: 'v2',
		} as Parameters<typeof reconcileReviewWithPacket>[1];
		const review = {
			...reviewerPassFixture,
			packetVersion: 'v1',
		};
		const reconciled = reconcileReviewWithPacket(review, structuralPacket);
		expect(reconciled.decision).toBe('NEEDS_MORE_RESEARCH');
		expect(resolveArticleStatus(review, structuralPacket, false)).toBe('needs-more-research');
	});

	it('shouldNotRunMoreThanOneRemediationPass', async () => {
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market, options) => {
				const weak = {
					...(regionResultsFixture[0] as ArticleRegionResearchResult),
					briefId: brief.briefId,
					market,
					evidence: [
						{
							...(regionResultsFixture[0] as ArticleRegionResearchResult).evidence[0],
							text: 'Minimum capital adequacy ratio raised',
						},
					],
				};
				if (options?.phase === 'remediation') return weak;
				return weak;
			}),
			review: vi.fn(async () => reviewerPassFixture),
		});
		await executeResearchPipeline({ delegator }, baseRequest);
		expect(delegator.research).toHaveBeenCalledTimes(2);
		expect(delegator.review).not.toHaveBeenCalled();
	});

	it('shouldNotContinueSearchAfterCostBudgetExhaustion', async () => {
		const budget = createBudgetTracker(0.001, 0.001);
		const fetch = vi.fn();
		const tools = createDiscoveryTools({
			router: new CostAwareWebResearchRouter({
				exa: new ExaWebResearchProvider({ apiKey: 'key', fetch }),
				apify: null,
				apifyFallbackEnabled: false,
				budget,
			}),
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
					startDate: '2026-07-22T00:00:00Z',
					endDate: '2026-07-23T00:00:00Z',
					resultCount: 5,
				},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow('budget');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shouldNotExposePublishOrEmdashCapability', () => {
		expect(runFoundationalResearch.name).not.toBe('publish');
		const names = [
			...discoveryResearcherProfiles.map((profile) => profile.name),
			briefValidator.name,
			...regionResearcherProfiles.map((p) => p.name),
		];
		expect(names).not.toContain('article_writer');
		expect(names).not.toContain('publisher');
	});

	it('shouldNotRetryAuthorizationOrSchemaFailure', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 401 }));
		const provider = new ExaWebResearchProvider({ apiKey: 'key', fetch });
		await expect(
			provider.search(
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
					callKey: 'call_401',
					attempt: 1,
				},
				new AbortController().signal,
			),
		).rejects.toBeInstanceOf(ProviderError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('shouldNotReportCompleteWhenAnyAcceptedBriefHasNoTerminalOutcome', () => {
		expect(
			resolveRunStatus(2, [{ status: 'passed' } as never, { status: 'needs-more-research' } as never], false),
		).toBe('partial');
		expect(resolveRunStatus(2, [{ status: 'passed' } as never], false)).toBe('partial');
		expect(
			resolveRunStatus(
				1,
				[
					{
						status: 'passed',
						validation: briefValidationsFixture.brief_accept,
					} as never,
				],
				false,
			),
		).toBe('complete');
	});

	it('reports failed when validation is operationally blocked and nothing is accepted', () => {
		expect(resolveRunStatus(0, [], false, 1)).toBe('failed');
	});

	it('reports partial when validation is blocked but another brief is accepted', () => {
		expect(
			resolveRunStatus(
				1,
				[{ status: 'passed' } as never],
				false,
				1,
			),
		).toBe('partial');
	});
});
