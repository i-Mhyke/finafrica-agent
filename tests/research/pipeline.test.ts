import { describe, expect, it, vi } from 'vitest';
import { executeResearchPipeline, continueResearchPipeline, type ResearchDelegator } from '../../.flue/research/pipeline';
import { mergeMarketDiscoveryResults } from '../../.flue/research/delegation';
import { createBudgetTracker } from '../../.flue/providers/web-research/router';
import {
	createResearchAuditEmitter,
	RESEARCH_AUDIT_LOG_MESSAGE,
} from '../../.flue/research/run-audit';
import type {
	ArticleRegionResearchResult,
	DiscoveryPortfolio,
	DiscoveryRunRequest,
	StructuralPacket,
} from '../../.flue/research/schemas';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';
import briefValidationsFixture from '../fixtures/research/brief-validations.json';
import reviewerPassFixture from '../fixtures/research/reviewer-pass.json';
import reviewerNeedsMoreFixture from '../fixtures/research/reviewer-needs-more.json';
import regionResultsFixture from '../fixtures/research/region-results.json';

const baseRequest: DiscoveryRunRequest = {
	runKey: 'scan-fixture',
	trigger: 'manual',
	window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
	focus: null,
	maxDiscoveredBriefs: 30,
	maxAcceptedBriefs: 10,
	maxProviderCostUsd: 5,
};

function makeStructuralPacket(briefId: string): StructuralPacket {
	return {
		briefId,
		packetVersion: 'v1',
		facts: ['CBN raised CAR to 15%'],
		editorsQuestions: Array.from({ length: 10 }, (_, i) => ({
			question: `Question ${i + 1}?`,
			answer: 'Answer',
			gap: null,
		})),
		dependencyGraph: {
			primaryActors: ['CBN'],
			adjacentActors: ['Banks'],
			infrastructure: [],
			regulators: ['CBN'],
			customers: [],
			capitalMarkets: [],
		},
		analysisLayers: {
			layer1WhatChanged: 'CAR raised',
			layer2IsNew: 'Yes',
			layer3WhoLoses: 'Undercapitalized banks',
			layer4PricingPower: 'Large banks',
			layer5StackCollapse: 'None',
			layer6InstitutionalPower: 'CBN',
			layer7WhatBecomesPossible: 'Consolidation',
		},
		storyOptions: [
			{ title: 'A', angle: 'Regulation', audience: 'Analysts' },
			{ title: 'B', angle: 'Impact', audience: 'Bankers' },
			{ title: 'C', angle: 'Timeline', audience: 'Compliance' },
		],
		recommendedLede: 'CBN raises CAR',
		whyItMatters: 'Capital pressure',
		howItChangesThings: 'Higher buffers required',
		actorActionability: [{ actor: 'Banks', action: 'Submit compliance plan' }],
		missingFacts: [],
		supportingSourceIds: ['src_1'],
		supportingEvidenceIds: ['ev_1'],
	};
}

function createFakeDelegator(overrides: Partial<ResearchDelegator> = {}): ResearchDelegator {
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
			...(regionResultsFixture[0] as ArticleRegionResearchResult),
			briefId: brief.briefId,
			market,
		})),
		analyze: vi.fn(async ({ brief, sourceAudit }) => ({
			...makeStructuralPacket(brief.briefId),
			supportingSourceIds: sourceAudit.sources.map((source) => source.sourceId),
			supportingEvidenceIds: sourceAudit.evidence.map((evidence) => evidence.evidenceId),
		})),
		review: vi.fn(async () => reviewerPassFixture),
		...overrides,
	};
}

describe('executeResearchPipeline', () => {
	it('rejects discovery output missing a foundation market coverage record', async () => {
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				coverage: discoveryPortfolioFixture.coverage.slice(0, 1),
			})),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.status).toBe('failed');
	});

	it('continues valid market work and marks the run partial when one market failed', async () => {
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				coverage: discoveryPortfolioFixture.coverage.map((coverage) => ({
					...coverage,
					status: coverage.market === 'ghana' ? 'failed' as const : coverage.status,
				})),
			})),
		});

		const result = await executeResearchPipeline({ delegator }, baseRequest);

		expect(result.status).toBe('partial');
		expect(result.discovery.briefs).toEqual(discoveryPortfolioFixture.briefs);
		expect(delegator.validateBrief).toHaveBeenCalled();
	});

	it('fails the run when every foundation market failed', async () => {
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				coverage: discoveryPortfolioFixture.coverage.map((coverage) => ({
					...coverage,
					status: 'failed' as const,
				})),
				briefs: [],
			})),
		});

		const result = await executeResearchPipeline({ delegator }, baseRequest);

		expect(result.status).toBe('failed');
		expect(delegator.validateBrief).not.toHaveBeenCalled();
	});

	it('preserves completed discovery searches when the discovery model task fails', async () => {
		const runBudget = createBudgetTracker(1, 1);
		const receipt = {
			...(regionResultsFixture[0] as ArticleRegionResearchResult).receipts[0],
			receiptId: 'receipt_discovery_nigeria',
			callKey: 'discovery:nigeria:search:1',
			phase: 'discovery' as const,
			briefId: null,
			market: 'nigeria' as const,
			operation: 'search' as const,
			status: 'succeeded' as const,
		};
		runBudget.receipts.push(receipt);
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => {
				throw new Error('prompt failed: Stream ended without finish_reason');
			}),
		});

		const result = await executeResearchPipeline(
			{ delegator, runBudget },
			baseRequest,
		);

		expect(result.discovery.receipts).toEqual([receipt]);
		expect(
			result.discovery.coverage.find((coverage) => coverage.market === 'nigeria'),
		).toEqual(
			expect.objectContaining({
				searchesPerformed: 1,
				status: 'failed',
			}),
		);
	});

	it('creates one independent work item per accepted brief', async () => {
		const delegator = createFakeDelegator();
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.articles).toHaveLength(1);
		expect(result.articles[0].brief.briefId).toBe('brief_accept');
	});

	it('does not deep-research rejected or duplicate briefs', async () => {
		const delegator = createFakeDelegator({
			review: vi.fn(async () => reviewerPassFixture),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(delegator.research).toHaveBeenCalledTimes(1);
		expect(result.rejectedBriefs.some((r) => r.brief.briefId === 'brief_reject')).toBe(true);
	});

	it('selects only the markets attached to each accepted brief', async () => {
		const delegator = createFakeDelegator();
		await executeResearchPipeline({ delegator }, baseRequest);
		expect(delegator.research).toHaveBeenCalledWith(
			expect.objectContaining({ briefId: 'brief_accept' }),
			'nigeria',
		);
	});

	it('continues other article work when one article or region fails', async () => {
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market) => {
				if (market === 'nigeria') throw new Error('region failed');
				return {
					...(regionResultsFixture[0] as ArticleRegionResearchResult),
					briefId: brief.briefId,
					market,
					status: 'complete',
				};
			}),
		});
		const portfolio = {
			...discoveryPortfolioFixture,
			briefs: [
				{
					...discoveryPortfolioFixture.briefs[0],
					markets: ['nigeria', 'kenya'],
				},
			],
		};
		const d = createFakeDelegator({
			discover: vi.fn(async () => portfolio as DiscoveryPortfolio),
			research: delegator.research,
		});
		const result = await executeResearchPipeline({ delegator: d }, baseRequest);
		expect(result.articles).toHaveLength(1);
	});

	it('calls research, analyze, and review once when ready on first pass', async () => {
		const calls: string[] = [];
		const delegator = createFakeDelegator({
			research: vi.fn(async (...args) => {
				calls.push('research');
				return {
					...(regionResultsFixture[0] as ArticleRegionResearchResult),
					briefId: args[0].briefId,
					market: args[1],
				};
			}),
			analyze: vi.fn(async ({ brief, sourceAudit }) => {
				calls.push('analyze');
				return {
					...makeStructuralPacket(brief.briefId),
					supportingSourceIds: sourceAudit.sources.map((source) => source.sourceId),
					supportingEvidenceIds: sourceAudit.evidence.map((evidence) => evidence.evidenceId),
				};
			}),
			review: vi.fn(async () => {
				calls.push('review');
				return reviewerPassFixture;
			}),
		});
		await executeResearchPipeline({ delegator }, baseRequest);
		expect(calls).toEqual(['research', 'analyze', 'review']);
	});

	it('calls remediation before analysis when evidence is not ready on first pass', async () => {
		const calls: string[] = [];
		let remediationCalls = 0;
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market, options) => {
				if (options?.phase === 'remediation') {
					calls.push('remediation');
					remediationCalls++;
					return regionResultsFixture[0] as ArticleRegionResearchResult;
				}
				calls.push('research');
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
				return weak;
			}),
			analyze: vi.fn(async ({ brief, sourceAudit }) => {
				calls.push('analyze');
				return {
					...makeStructuralPacket(brief.briefId),
					supportingSourceIds: sourceAudit.sources.map((source) => source.sourceId),
					supportingEvidenceIds: sourceAudit.evidence.map((evidence) => evidence.evidenceId),
				};
			}),
			review: vi.fn(async () => {
				calls.push('review');
				return reviewerPassFixture;
			}),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(calls).toEqual(['research', 'remediation', 'analyze', 'review']);
		expect(remediationCalls).toBe(1);
		expect(result.articles[0]?.status).toBe('passed');
	});

	it('skips analysis and review when still blocked after remediation', async () => {
		const calls: string[] = [];
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market, options) => {
				calls.push(options?.phase === 'remediation' ? 'remediation' : 'research');
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
				return weak;
			}),
			analyze: vi.fn(async ({ brief, sourceAudit }) => {
				calls.push('analyze');
				return {
					...makeStructuralPacket(brief.briefId),
					supportingSourceIds: sourceAudit.sources.map((source) => source.sourceId),
					supportingEvidenceIds: sourceAudit.evidence.map((evidence) => evidence.evidenceId),
				};
			}),
			review: vi.fn(async () => {
				calls.push('review');
				return reviewerPassFixture;
			}),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(calls).toEqual(['research', 'remediation']);
		expect(delegator.analyze).not.toHaveBeenCalled();
		expect(delegator.review).not.toHaveBeenCalled();
		expect(result.articles[0]?.status).toBe('needs-more-research');
		expect(result.articles[0]?.structuralPacket).toBeNull();
		expect(result.articles[0]?.review).toBeNull();
		expect(result.articles[0]?.readiness?.ready).toBe(false);
	});

	it('skips remediation when readiness is blocked only by missing claim linkage', async () => {
		const calls: string[] = [];
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market, options) => {
				calls.push(options?.phase === 'remediation' ? 'remediation' : 'research');
				return {
					...(regionResultsFixture[0] as ArticleRegionResearchResult),
					briefId: brief.briefId,
					market,
					claims: [],
				};
			}),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(calls).toEqual(['research']);
		expect(result.articles[0]?.status).toBe('needs-more-research');
		expect(result.articles[0]?.readiness?.ready).toBe(false);
	});

	it('allows one brief-refinement and one research-remediation pass per article', async () => {
		const refineBrief = vi.fn(async (brief: typeof discoveryPortfolioFixture.briefs[0]) => ({
			...brief,
			briefId: `${brief.briefId}_refined`,
			thesis: `${brief.thesis} with primary-source scope`,
		}));
		const delegator = createFakeDelegator({
			validateBrief: vi.fn(async (input) => {
				const brief = input.brief;
				if (brief.briefId.includes('refined')) {
					return briefValidationsFixture.brief_accept;
				}
				if (brief.briefId === 'brief_accept') {
					return {
						...briefValidationsFixture.brief_accept,
						decision: 'REFINE' as const,
						requiredChanges: ['Add primary source'],
					};
				}
				return briefValidationsFixture[brief.briefId as keyof typeof briefValidationsFixture];
			}),
			review: vi.fn(async () => reviewerPassFixture),
			...({ refineBrief } as never),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(delegator.validateBrief).toHaveBeenCalledTimes(3); // brief_accept + refine + brief_reject
		expect(refineBrief).toHaveBeenCalledTimes(1);
		const revalidationPayload = (delegator.validateBrief as ReturnType<typeof vi.fn>).mock.calls
			.map(([payload]) => payload)
			.find((payload) => payload.brief.briefId.includes('refined'));
		expect(revalidationPayload?.sources.length).toBeGreaterThan(0);
		expect(revalidationPayload?.evidence.length).toBeGreaterThan(0);
		expect(revalidationPayload?.brief.briefId).toContain('refined');
		expect(result.articles[0]?.brief.thesis).toContain('primary-source scope');
		expect(result.articles.length).toBeGreaterThanOrEqual(1);
	});

	it('returns PASS only from a packet-version-matched article review', async () => {
		const delegator = createFakeDelegator();
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		const article = result.articles[0];
		expect(article.review?.decision).toBe('PASS');
		expect(article.review?.packetVersion).toBe(article.structuralPacket?.packetVersion);
	});

	it('downgrades PASS when review packet version is stale', async () => {
		const delegator = createFakeDelegator({
			review: vi.fn(async () => ({ ...reviewerPassFixture, packetVersion: 'v0' })),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.articles[0].status).toBe('needs-more-research');
	});

	it('preserves the real brief validation on article outcomes', async () => {
		const delegator = createFakeDelegator({ review: vi.fn(async () => reviewerPassFixture) });
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.articles[0].validation.decision).toBe('ACCEPT');
		expect(result.articles[0].validation.briefId).toBe('brief_accept');
	});

	it('marks run partial when any accepted article needs more research', async () => {
		const delegator = createFakeDelegator({
			review: vi.fn(async () => ({ ...reviewerPassFixture, packetVersion: 'v0' })),
		});
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.status).toBe('partial');
	});

	it('returns a portfolio containing every accepted and rejected brief', async () => {
		const delegator = createFakeDelegator();
		const result = await executeResearchPipeline({ delegator }, baseRequest);
		expect(result.articles.length + result.rejectedBriefs.length).toBeGreaterThanOrEqual(2);
	});

	it('retains candidates excluded by the discovery and acceptance limits', async () => {
		const briefs = [
			{
				...discoveryPortfolioFixture.briefs[0],
				briefId: 'brief_first',
				workingTitle: 'First article',
			},
			{
				...discoveryPortfolioFixture.briefs[0],
				briefId: 'brief_second',
				workingTitle: 'Second article',
			},
		];
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...discoveryPortfolioFixture,
				briefs,
			} as DiscoveryPortfolio)),
			validateBrief: vi.fn(async (input) => ({
				...briefValidationsFixture.brief_accept,
				briefId: input.brief.briefId,
			})),
			review: vi.fn(async () => reviewerPassFixture),
		});

		const result = await executeResearchPipeline(
			{ delegator },
			{ ...baseRequest, maxDiscoveredBriefs: 1, maxAcceptedBriefs: 1 },
		);

		expect(result.articles).toHaveLength(1);
		expect(result.rejectedBriefs).toHaveLength(1);
		expect(result.rejectedBriefs[0]?.brief.briefId).toBe('brief_second');
	});

	it('reports failed when validator times out without researching briefs', async () => {
		const briefs = [
			{
				...discoveryPortfolioFixture.briefs[0],
				briefId: 'brief_timeout',
			},
		];
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				briefs,
			})),
			validateBrief: vi.fn(async () => {
				throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
			}),
		});

		const result = await executeResearchPipeline(
			{ delegator },
			{ ...baseRequest, maxDiscoveredBriefs: 1, maxAcceptedBriefs: 1 },
		);

		expect(result.status).toBe('failed');
		expect(result.articles).toHaveLength(0);
		expect(result.blockedBriefs).toHaveLength(1);
		expect(result.blockedBriefs[0]?.brief.briefId).toBe('brief_timeout');
		expect(result.blockedBriefs[0]?.phase).toBe('brief-validation');
		expect(result.blockedBriefs[0]?.errorClass).toBe('provider_timeout');
		expect(result.rejectedBriefs).toHaveLength(0);
		expect(result.totals.blocked).toBe(1);
		expect(result.totals.rejected).toBe(0);
	});

	it('emits pipeline_failed audit when validator timeout blocks the run', async () => {
		const auditEvents: Array<Record<string, unknown>> = [];
		const audit = createResearchAuditEmitter(
			{
				info: (message, attributes) => {
					if (message === RESEARCH_AUDIT_LOG_MESSAGE) {
						auditEvents.push(attributes ?? {});
					}
				},
				warn: () => undefined,
				error: (message, attributes) => {
					if (message === RESEARCH_AUDIT_LOG_MESSAGE) {
						auditEvents.push(attributes ?? {});
					}
				},
			},
			baseRequest.runKey,
		);
		const briefs = [
			{
				...discoveryPortfolioFixture.briefs[0],
				briefId: 'brief_timeout',
			},
		];
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...(discoveryPortfolioFixture as DiscoveryPortfolio),
				briefs,
			})),
			validateBrief: vi.fn(async () => {
				throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
			}),
		});

		const result = await executeResearchPipeline({ delegator, audit }, baseRequest);

		expect(result.status).toBe('failed');
		expect(
			auditEvents.some((event) => event.auditEvent === 'pipeline_failed'),
		).toBe(true);
		expect(
			auditEvents.some((event) => event.auditEvent === 'pipeline_completed'),
		).toBe(false);
	});

	it('merges remediation evidence with the original region result', async () => {
		const delegator = createFakeDelegator({
			research: vi.fn(async (brief, market, options) => {
				const original = {
					...(regionResultsFixture[0] as ArticleRegionResearchResult),
					briefId: brief.briefId,
					market,
				};
				if (options?.phase !== 'remediation') {
					return {
						...original,
						evidence: [
							{
								...original.evidence[0],
								text: 'Minimum capital adequacy ratio raised',
							},
						],
					};
				}
				return {
					...original,
					sources: [
						{
							...original.sources[0],
							sourceId: 'src_remediation',
							canonicalUrl: 'https://sec.gov.ng/remediation',
						},
					],
					evidence: [
						{
							...original.evidence[0],
							evidenceId: 'ev_remediation',
							sourceId: 'src_remediation',
							text: 'Minimum capital adequacy ratio raised to 15%',
						},
					],
				};
			}),
		});

		const result = await executeResearchPipeline({ delegator }, baseRequest);

		expect(delegator.research).toHaveBeenCalledTimes(2);
		expect(result.articles[0]?.regionResults[0]?.sources.length).toBeGreaterThan(1);
	});

	it('does not pass a structural packet that references absent evidence', async () => {
		const delegator = createFakeDelegator({
			review: vi.fn(async () => reviewerPassFixture),
			analyze: vi.fn(async ({ brief }) => ({
				...makeStructuralPacket(brief.briefId),
				supportingEvidenceIds: ['ev_missing'],
			})),
		});

		const result = await executeResearchPipeline({ delegator }, baseRequest);

		expect(result.articles[0]?.status).toBe('needs-more-research');
	});

	it('does not duplicate discovery receipts in run provider usage', async () => {
		const runBudget = createBudgetTracker(1, 1);
		const receipt = {
			...(regionResultsFixture[0] as ArticleRegionResearchResult).receipts[0],
			phase: 'discovery' as const,
			briefId: null,
		};
		runBudget.receipts.push(receipt);
		const delegator = createFakeDelegator({
			discover: vi.fn(async () => ({
				...discoveryPortfolioFixture,
				receipts: [receipt],
			} as DiscoveryPortfolio)),
			review: vi.fn(async () => reviewerPassFixture),
		});

		const result = await executeResearchPipeline(
			{ delegator, runBudget },
			baseRequest,
		);
		const receiptIds = result.providerUsage.receipts.map((receipt) => receipt.receiptId);

		expect(new Set(receiptIds).size).toBe(receiptIds.length);
	});

	it('retains run-level execution records for discovery and rejected briefs', async () => {
		const executionRecords = [
			{
				recordId: 'exec_discovery',
				runKey: baseRequest.runKey,
				briefId: null,
				agent: 'discovery_orchestrator',
				sessionName: 'discovery',
				phase: 'discovery',
				modelRole: 'reasoning',
				modelId: 'opencode-go/kimi-k3',
				promptVersion: '1',
				skillVersions: { 'african-financial-intelligence-pipeline': '1' },
				schemaVersion: '1',
				startedAt: '2026-07-23T00:00:00Z',
				completedAt: '2026-07-23T00:00:01Z',
				status: 'succeeded' as const,
				tokenUsage: { input: 10, output: 5 },
				costUsd: 0.001,
				error: null,
			},
		];
		const toolBindings = {
			input: baseRequest,
			articleBudgets: new Map(),
			executionRecords,
		} as never;

		const result = await executeResearchPipeline(
			{
				delegator: createFakeDelegator({
					review: vi.fn(async () => reviewerPassFixture),
				}),
				toolBindings,
			},
			baseRequest,
		);

		expect(
			(result as typeof result & { execution?: typeof executionRecords }).execution,
		).toEqual(executionRecords);
	});

	it('continues from precomputed durable discovery without re-running discovery', async () => {
		const discover = vi.fn();
		const delegator = createFakeDelegator({ discover });
		const discovery = discoveryPortfolioFixture as DiscoveryPortfolio;
		const result = await continueResearchPipeline({ delegator }, baseRequest, discovery);
		expect(discover).not.toHaveBeenCalled();
		expect(result.discovery.briefs.length).toBeGreaterThan(0);
	});

	it('rejects malformed durable discovery handoff inputs', () => {
		expect(() =>
			mergeMarketDiscoveryResults('scan-fixture', [
				{
					runKey: 'scan-fixture',
					market: 'nigeria',
					coverage: {
						market: 'nigeria',
						searchesPerformed: 0,
						signalsFound: 0,
						sourceIds: [],
						status: 'no-signals',
					},
					receipts: [],
					sources: [],
					evidence: [],
					briefs: [],
				},
			]),
		).toThrow(/Invalid discovery result/);
	});
});
