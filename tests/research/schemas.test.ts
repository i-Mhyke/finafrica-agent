import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { deriveSourceId, normalizeCanonicalUrl } from '../../.flue/research/ids';
import {
	ArticleResearchBriefSchema,
	ArticleResearchOutcomeSchema,
	ClaimCandidateSchema,
	DiscoveryPortfolioSchema,
	DiscoveryRunRequestSchema,
	EvidenceRequirementSchema,
	MarketDiscoveryAgentResultSchema,
	MarketDiscoveryResultSchema,
	ReviewReportSchema,
} from '../../.flue/research/schemas';
import {
	createInitialDiscoveryCheckpoint,
	DiscoveryActionSchema,
	DiscoveryMarketCheckpointSchema,
} from '../../.flue/research/discovery-lifecycle-schemas';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';

describe('research schemas', () => {
	it('does not accept caller-controlled foundation market scope', () => {
		const result = v.safeParse(DiscoveryRunRequestSchema, {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 30,
			maxAcceptedBriefs: 10,
			maxProviderCostUsd: 5,
			markets: ['nigeria'],
		} as Record<string, unknown>);
		expect(result.success).toBe(true);
		if (result.success) {
			expect('markets' in (result.output as object)).toBe(false);
		}
	});

	it('rejects an inverted or invalid ISO time window', () => {
		const inverted = v.safeParse(DiscoveryRunRequestSchema, {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: '2026-07-23T00:00:00Z', end: '2026-07-22T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 30,
			maxAcceptedBriefs: 10,
			maxProviderCostUsd: 5,
		});
		expect(inverted.success).toBe(false);

		const invalid = v.safeParse(DiscoveryRunRequestSchema, {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: 'not-a-date', end: '2026-07-23T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 30,
			maxAcceptedBriefs: 10,
			maxProviderCostUsd: 5,
		});
		expect(invalid.success).toBe(false);
	});

	it('defaults and bounds the run-wide provider request limit', () => {
		const base = {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 3,
			maxAcceptedBriefs: 2,
			maxProviderCostUsd: 1,
		};
		const parsed = v.safeParse(DiscoveryRunRequestSchema, base);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.output.maxProviderRequests).toBe(40);
		}

		expect(
			v.safeParse(DiscoveryRunRequestSchema, {
				...base,
				maxProviderRequests: 101,
			}).success,
		).toBe(false);
	});

	it('rejects a portfolio brief without discovery evidence', () => {
		const result = v.safeParse(DiscoveryPortfolioSchema, {
			runKey: 'scan-1',
			coverage: foundationCoverage(),
			receipts: [],
			sources: [],
			evidence: [],
			briefs: [
				{
					briefId: 'brief_1',
					workingTitle: 'Test',
					thesis: 'Thesis',
					signalSummary: 'Summary',
					markets: ['nigeria'],
					verticals: ['banking-regulation'],
					discoverySourceIds: ['src_1'],
					discoveryEvidenceIds: [],
					decisionRelevance: 'High',
					initialQuestions: [],
					primarySourceTargets: [],
					secondarySourceTargets: [],
					exclusions: [],
					evidenceRequirements: [
						{
							requirementId: 'req_1',
							market: 'nigeria',
							question: 'What changed?',
							materiality: 'high',
							sourceRule: 'primary',
							targetDomains: ['cbn.gov.ng'],
							anchors: ['capital'],
							recencyRule: 'none',
						},
					],
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('rejects a portfolio missing a foundation market coverage record', () => {
		const result = v.safeParse(DiscoveryPortfolioSchema, {
			runKey: 'scan-1',
			coverage: [
				{
					market: 'nigeria',
					searchesPerformed: 1,
					signalsFound: 0,
					sourceIds: [],
					status: 'no-signals',
				},
			],
			receipts: [],
			sources: [],
			evidence: [],
			briefs: [],
		});
		expect(result.success).toBe(false);
	});

	it('rejects a no-signals market result that still proposes an article brief', () => {
		const result = v.safeParse(MarketDiscoveryAgentResultSchema, {
			runKey: 'scan-1',
			market: 'nigeria',
			coverage: {
				market: 'nigeria',
				searchesPerformed: 2,
				signalsFound: 0,
				sourceIds: [],
				status: 'no-signals',
			},
			briefs: [discoveryPortfolioFixture.briefs[0]],
		});

		expect(result.success).toBe(false);
	});

	it('rejects provider receipt IDs used as discovery evidence IDs', () => {
		const brief = discoveryPortfolioFixture.briefs[0];
		const result = v.safeParse(ArticleResearchBriefSchema, {
			...brief,
			discoveryEvidenceIds: ['rcpt_not_evidence'],
		});

		expect(result.success).toBe(false);
	});

	it('rejects market discovery artifacts from another market', () => {
		const result = v.safeParse(MarketDiscoveryResultSchema, {
			runKey: 'scan-1',
			market: 'nigeria',
			coverage: {
				market: 'nigeria',
				searchesPerformed: 1,
				signalsFound: 0,
				sourceIds: ['src_ghana'],
				status: 'covered',
			},
			receipts: [],
			sources: [
				{
					sourceId: 'src_ghana',
					canonicalUrl: 'https://bog.gov.gh/update',
					title: 'Update',
					publisher: null,
					author: null,
					publishedAt: '2026-07-22T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'ghana',
					tier: 1,
					sourceType: 'primary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
			],
			evidence: [],
			briefs: [],
		});

		expect(result.success).toBe(false);
	});

	it('rejects a factual claim without supporting evidence', () => {
		const result = v.safeParse(ClaimCandidateSchema, {
			claimId: 'claim_1',
			statement: 'CBN raised rates',
			kind: 'fact',
			materiality: 'high',
			supportingEvidenceIds: [],
			contradictingEvidenceIds: [],
			status: 'supported',
		});
		expect(result.success).toBe(false);
	});

	it('rejects PASS when required reviewer dimensions are below two', () => {
		const result = v.safeParse(ReviewReportSchema, {
			briefId: 'brief_1',
			packetVersion: 'v1',
			decision: 'PASS',
			scores: {
				sourceQuality: 1,
				decisionRelevance: 3,
				factualSupport: 3,
				signalStrength: 3,
				financialMaterialImpact: 3,
				nonPromotionalFilter: 3,
				libelAndAllegationRisk: 3,
				whyHowDepth: 3,
				actionability: 3,
				structuralAnalysis: 3,
				reporterVsAnalystTest: 3,
			},
			reasons: [],
			missingItems: [],
			requestedSourceTargets: [],
			approvedOutputType: 'policy explainer',
		});
		expect(result.success).toBe(false);
	});

	it('derives the same source ID from equivalent canonical URLs', async () => {
		const a = await deriveSourceId('https://Example.com/path/');
		const b = await deriveSourceId('https://example.com/path');
		expect(a).toBe(b);
		expect(normalizeCanonicalUrl('https://Example.com/path/')).toBe('https://example.com/path');
	});

	it('rejects unbounded budgets and result counts', () => {
		const overBudget = v.safeParse(DiscoveryRunRequestSchema, {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 100,
			maxAcceptedBriefs: 10,
			maxProviderCostUsd: 5,
		});
		expect(overBudget.success).toBe(false);

		const overCost = v.safeParse(DiscoveryRunRequestSchema, {
			runKey: 'scan-1',
			trigger: 'manual',
			window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
			focus: null,
			maxDiscoveredBriefs: 30,
			maxAcceptedBriefs: 10,
			maxProviderCostUsd: 50,
		});
		expect(overCost.success).toBe(false);

		const briefOverMarkets = v.safeParse(ArticleResearchBriefSchema, {
			briefId: 'brief_1',
			workingTitle: 'Test',
			thesis: 'Thesis',
			signalSummary: 'Summary',
			markets: ['nigeria', 'brazil' as 'nigeria'],
			verticals: [],
			discoverySourceIds: ['src_1'],
			discoveryEvidenceIds: ['ev_1'],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: [],
			secondarySourceTargets: [],
			exclusions: [],
		});
		expect(briefOverMarkets.success).toBe(false);
	});

	it('requires a high-materiality evidence requirement on every article brief', () => {
		const result = v.safeParse(ArticleResearchBriefSchema, {
			briefId: 'brief_1',
			workingTitle: 'Test',
			thesis: 'Thesis',
			signalSummary: 'Summary',
			markets: ['nigeria'],
			verticals: [],
			discoverySourceIds: ['src_1'],
			discoveryEvidenceIds: ['ev_1'],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: ['cbn.gov.ng'],
			secondarySourceTargets: [],
			exclusions: [],
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What changed?',
					materiality: 'medium',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'none',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('rejects an evidence requirement assigned outside the brief markets', () => {
		const result = v.safeParse(ArticleResearchBriefSchema, {
			briefId: 'brief_1',
			workingTitle: 'Test',
			thesis: 'Thesis',
			signalSummary: 'Summary',
			markets: ['nigeria'],
			verticals: [],
			discoverySourceIds: ['src_1'],
			discoveryEvidenceIds: ['ev_1'],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: ['cbn.gov.ng'],
			secondarySourceTargets: [],
			exclusions: [],
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'ghana',
					question: 'What changed?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['bog.gov.gh'],
					anchors: ['15%'],
					recencyRule: 'none',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('rejects duplicate evidence requirement IDs inside one brief', () => {
		const result = v.safeParse(ArticleResearchBriefSchema, {
			briefId: 'brief_1',
			workingTitle: 'Test',
			thesis: 'Thesis',
			signalSummary: 'Summary',
			markets: ['nigeria'],
			verticals: [],
			discoverySourceIds: ['src_1'],
			discoveryEvidenceIds: ['ev_1'],
			decisionRelevance: 'High',
			initialQuestions: [],
			primarySourceTargets: ['cbn.gov.ng'],
			secondarySourceTargets: [],
			exclusions: [],
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What changed?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What else changed?',
					materiality: 'medium',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['20%'],
					recencyRule: 'none',
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('requires target domains for a source rule that permits primary evidence', () => {
		const result = v.safeParse(EvidenceRequirementSchema, {
			requirementId: 'req_1',
			market: 'nigeria',
			question: 'What changed?',
			materiality: 'high',
			sourceRule: 'primary',
			targetDomains: [],
			anchors: ['15%'],
			recencyRule: 'none',
		});
		expect(result.success).toBe(false);
	});

	it('requires at least one anchor on high-materiality requirements', () => {
		const result = v.safeParse(EvidenceRequirementSchema, {
			requirementId: 'req_1',
			market: 'nigeria',
			question: 'What changed?',
			materiality: 'high',
			sourceRule: 'primary',
			targetDomains: ['cbn.gov.ng'],
			anchors: [],
			recencyRule: 'none',
		});
		expect(result.success).toBe(false);
	});

	it('requires material factual claims to name their evidence requirements', () => {
		const result = v.safeParse(ClaimCandidateSchema, {
			claimId: 'claim_1',
			statement: 'CBN raised rates',
			kind: 'fact',
			materiality: 'high',
			requirementIds: [],
			supportingEvidenceIds: ['ev_1'],
			contradictingEvidenceIds: [],
			status: 'supported',
		});
		expect(result.success).toBe(false);
	});

	it('accepts null readiness on an article that failed before evidence audit', () => {
		const result = v.safeParse(ArticleResearchOutcomeSchema, {
			brief: {
				briefId: 'brief_1',
				workingTitle: 'Test',
				thesis: 'Thesis',
				signalSummary: 'Summary',
				markets: ['nigeria'],
				verticals: [],
				discoverySourceIds: ['src_1'],
				discoveryEvidenceIds: ['ev_1'],
				decisionRelevance: 'High',
				initialQuestions: [],
				primarySourceTargets: ['cbn.gov.ng'],
				secondarySourceTargets: [],
				exclusions: [],
				evidenceRequirements: [
					{
						requirementId: 'req_1',
						market: 'nigeria',
						question: 'What changed?',
						materiality: 'high',
						sourceRule: 'primary',
						targetDomains: ['cbn.gov.ng'],
						anchors: ['15%'],
						recencyRule: 'none',
					},
				],
			},
			validation: {
				briefId: 'brief_1',
				briefVersion: '1',
				decision: 'ACCEPT',
				reasons: [],
				duplicateOfBriefId: null,
				requiredChanges: [],
				requestedSourceTargets: [],
			},
			status: 'failed',
			regionResults: [],
			sourceAudit: {
				briefId: 'brief_1',
				sources: [],
				evidence: [],
				claims: [],
				gaps: [],
				duplicateSourceIds: [],
				staleSourceIds: [],
			},
			readiness: null,
			structuralPacket: null,
			review: null,
			execution: [],
		});
		expect(result.success).toBe(true);
	});

	it('accepts durable discovery lifecycle checkpoints and actions', () => {
		const checkpoint = createInitialDiscoveryCheckpoint({
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market: 'nigeria',
			maxRequests: 20,
			maxCostUsd: 5,
		});
		expect(v.safeParse(DiscoveryMarketCheckpointSchema, checkpoint).success).toBe(true);

		const action = v.safeParse(DiscoveryActionSchema, {
			type: 'search',
			query: 'nigeria rates',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(action.success).toBe(true);
	});
});

function foundationCoverage() {
	return (['nigeria', 'ghana'] as const).map((market) => ({
		market,
		searchesPerformed: 0,
		signalsFound: 0,
		sourceIds: [],
		status: 'no-signals' as const,
	}));
}
