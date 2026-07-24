import * as v from 'valibot';

// ── Constants ────────────────────────────────────────────────────────────────

export const SUPPORTED_MARKETS = [
	'nigeria',
	'kenya',
	'ghana',
	'south-africa',
	'egypt',
] as const;

/** Markets enabled for the foundation rollout. Expand only after quality gates pass. */
export const FOUNDATION_MARKETS = ['nigeria', 'ghana'] as const;
/** Compatibility alias for source-policy code. Use FOUNDATION_MARKETS for active scope. */
export const MANDATORY_MARKETS = SUPPORTED_MARKETS;
export const DISCOVERY_SEARCHES_PER_MARKET = 2;
export const DISCOVERY_FETCHES_PER_MARKET = 4;
export const DISCOVERY_LIFECYCLE_SCHEMA_VERSION = '1' as const;
export const DISCOVERY_MAX_SEMANTIC_DECISIONS = 16;
export const DISCOVERY_MAX_NO_PROGRESS_DECISIONS = 2;
export const DISCOVERY_MAX_FINALIZATION_REPAIRS = 3;
export const DISCOVERY_TASK_TIMEOUT_MS = 90_000;
export const BRIEF_VALIDATION_TASK_TIMEOUT_MS = 90_000;
export const BRIEF_REFINEMENT_TASK_TIMEOUT_MS = 45_000;
export const REGION_RESEARCH_TASK_TIMEOUT_MS = 600_000;
export const STRUCTURAL_ANALYSIS_TASK_TIMEOUT_MS = 120_000;
export const RESEARCH_REVIEW_TASK_TIMEOUT_MS = 120_000;
export const DISCOVERY_MARKET_BUDGET_SHARE = 0.8;
export const DEEP_RESEARCH_SEARCHES_PER_MARKET = 12;
export const DEEP_RESEARCH_FETCHES_PER_MARKET = 16;
export const REMEDIATION_SEARCHES_PER_MARKET = 6;
export const REMEDIATION_FETCHES_PER_MARKET = 10;

export const MAX_DISCOVERED_BRIEFS = 30;
export const MAX_ACCEPTED_BRIEFS = 10;
export const RESEARCH_PROVIDER_DEFAULT_RUN_USD = 1.0;
export const RESEARCH_PROVIDER_HARD_RUN_USD = 1.25;
export const RESEARCH_PROVIDER_MAX_REQUEST_USD = 10.0;
export const RESEARCH_PROVIDER_DEFAULT_REQUEST_LIMIT = 40;
export const RESEARCH_PROVIDER_HARD_REQUEST_LIMIT = 100;

export const MAX_CONCURRENT_BRIEF_VALIDATIONS = 4;
export const MAX_CONCURRENT_ARTICLES = 3;
export const MAX_CONCURRENT_REGIONS_PER_ARTICLE = 2;
export const MAX_CONCURRENT_PROVIDER_CALLS = 4;
export const MAX_CONCURRENT_APIFY_RUNS = 1;

// ── Primitives ───────────────────────────────────────────────────────────────

export const MarketSchema = v.picklist(SUPPORTED_MARKETS);
export type Market = v.InferOutput<typeof MarketSchema>;

export const SourceTierSchema = v.union([v.literal(1), v.literal(2), v.literal(3)]);
export type SourceTier = v.InferOutput<typeof SourceTierSchema>;

export const ReviewDecisionSchema = v.picklist(['PASS', 'NEEDS_MORE_RESEARCH', 'REJECT']);
export type ReviewDecision = v.InferOutput<typeof ReviewDecisionSchema>;

export const RunStatusSchema = v.picklist(['complete', 'partial', 'failed']);
export type RunStatus = v.InferOutput<typeof RunStatusSchema>;

export const ResearchProviderSchema = v.picklist(['exa', 'apify']);
export type ResearchProvider = v.InferOutput<typeof ResearchProviderSchema>;

export const ProviderOperationSchema = v.picklist(['search', 'fetch']);
export type ProviderOperation = v.InferOutput<typeof ProviderOperationSchema>;

const IsoDateTimeSchema = v.pipe(
	v.string(),
	v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'Must be ISO 8601 UTC'),
);

// ── DiscoveryRunRequest ──────────────────────────────────────────────────────

export const DiscoveryRunRequestSchema = v.pipe(
	v.object({
		runKey: v.pipe(v.string(), v.minLength(1)),
		trigger: v.picklist(['manual', 'scheduled']),
		window: v.object({
			start: IsoDateTimeSchema,
			end: IsoDateTimeSchema,
		}),
		focus: v.nullable(v.string()),
		maxDiscoveredBriefs: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_DISCOVERED_BRIEFS)),
		maxAcceptedBriefs: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_ACCEPTED_BRIEFS)),
		maxProviderCostUsd: v.nullable(
			v.pipe(v.number(), v.minValue(0), v.maxValue(RESEARCH_PROVIDER_MAX_REQUEST_USD)),
		),
		maxProviderRequests: v.optional(
			v.pipe(
				v.number(),
				v.integer(),
				v.minValue(1),
				v.maxValue(RESEARCH_PROVIDER_HARD_REQUEST_LIMIT),
			),
			RESEARCH_PROVIDER_DEFAULT_REQUEST_LIMIT,
		),
	}),
	v.check((input) => new Date(input.window.start) < new Date(input.window.end), 'Window start must precede end'),
	v.check(
		(input) => input.maxAcceptedBriefs <= input.maxDiscoveredBriefs,
		'maxAcceptedBriefs cannot exceed maxDiscoveredBriefs',
	),
	v.check(
		(input) => input.maxDiscoveredBriefs >= FOUNDATION_MARKETS.length,
		'maxDiscoveredBriefs must allow at least one candidate per foundation market',
	),
);
export type DiscoveryRunRequest = v.InferOutput<typeof DiscoveryRunRequestSchema>;

// ── ProviderCallReceipt ──────────────────────────────────────────────────────

export const ProviderCallReceiptSchema = v.object({
	receiptId: v.string(),
	callKey: v.string(),
	provider: ResearchProviderSchema,
	providerRequestId: v.nullable(v.string()),
	operation: ProviderOperationSchema,
	mode: v.picklist(['search', 'highlights', 'full-text', 'raw-http', 'browser-playwright']),
	phase: v.picklist(['discovery', 'deep-research', 'remediation']),
	briefId: v.nullable(v.string()),
	market: MarketSchema,
	query: v.nullable(v.string()),
	requestedUrls: v.array(v.string()),
	sourceTier: SourceTierSchema,
	requestedAt: IsoDateTimeSchema,
	completedAt: IsoDateTimeSchema,
	resultUrls: v.array(v.string()),
	costUsd: v.nullable(v.number()),
	latencyMs: v.number(),
	status: v.picklist(['succeeded', 'failed', 'cancelled']),
	fallbackReason: v.nullable(
		v.picklist(['exa-unusable', 'exa-retry-exhausted', 'raw-http-unusable']),
	),
	usage: v.object({
		computeUnits: v.nullable(v.number()),
		externalTransferGbytes: v.nullable(v.number()),
		proxySerps: v.nullable(v.number()),
	}),
});
export type ProviderCallReceipt = v.InferOutput<typeof ProviderCallReceiptSchema>;

// ── SourceRecord ─────────────────────────────────────────────────────────────

export const SourceRecordSchema = v.object({
	sourceId: v.string(),
	canonicalUrl: v.string(),
	title: v.string(),
	publisher: v.nullable(v.string()),
	author: v.nullable(v.string()),
	publishedAt: v.nullable(IsoDateTimeSchema),
	retrievedAt: IsoDateTimeSchema,
	market: MarketSchema,
	tier: SourceTierSchema,
	sourceType: v.picklist(['primary', 'secondary', 'social']),
	receiptIds: v.array(v.string()),
	contentHash: v.nullable(v.string()),
	rightsNote: v.nullable(v.string()),
});
export type SourceRecord = v.InferOutput<typeof SourceRecordSchema>;

// ── EvidenceExcerpt ──────────────────────────────────────────────────────────

export const EvidenceExcerptSchema = v.object({
	evidenceId: v.string(),
	sourceId: v.string(),
	text: v.pipe(v.string(), v.maxLength(4000)),
	supports: v.array(v.string()),
	capturedAt: IsoDateTimeSchema,
});
export type EvidenceExcerpt = v.InferOutput<typeof EvidenceExcerptSchema>;

// ── Evidence contracts ───────────────────────────────────────────────────────

export const EvidenceSourceRuleSchema = v.picklist([
	'primary',
	'independent-secondary',
	'primary-or-two-independent-secondary',
]);
export type EvidenceSourceRule = v.InferOutput<typeof EvidenceSourceRuleSchema>;

export const EvidenceRequirementSchema = v.pipe(
	v.object({
		requirementId: v.pipe(v.string(), v.minLength(1)),
		market: MarketSchema,
		question: v.pipe(v.string(), v.minLength(1)),
		materiality: v.picklist(['low', 'medium', 'high']),
		sourceRule: EvidenceSourceRuleSchema,
		targetDomains: v.array(v.pipe(v.string(), v.minLength(1))),
		anchors: v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
		recencyRule: v.picklist([
			'none',
			'source-published-in-window',
			'event-occurred-in-window',
		]),
	}),
	v.check(
		(value) =>
			value.sourceRule === 'independent-secondary' ||
			value.targetDomains.length > 0,
		'Primary-capable source rules require a target domain',
	),
	v.check(
		(value) => value.materiality !== 'high' || value.anchors.length > 0,
		'High-materiality requirements require at least one anchor',
	),
);
export type EvidenceRequirement = v.InferOutput<typeof EvidenceRequirementSchema>;

// ── ClaimCandidate ───────────────────────────────────────────────────────────

export const ClaimCandidateSchema = v.pipe(
	v.object({
		claimId: v.string(),
		statement: v.string(),
		kind: v.picklist(['fact', 'reported-claim', 'inference']),
		materiality: v.picklist(['low', 'medium', 'high']),
		requirementIds: v.array(v.string()),
		supportingEvidenceIds: v.array(v.string()),
		contradictingEvidenceIds: v.array(v.string()),
		status: v.picklist(['supported', 'disputed', 'unsupported']),
	}),
	v.check(
		(claim) =>
			claim.kind !== 'fact' ||
			claim.materiality === 'low' ||
			claim.supportingEvidenceIds.length > 0 ||
			claim.status === 'unsupported',
		'Factual claims require supporting evidence or unsupported status',
	),
	v.check(
		(claim) =>
			claim.kind !== 'fact' ||
			claim.materiality === 'low' ||
			claim.requirementIds.length > 0,
		'Material factual claims must name their evidence requirements',
	),
);
export type ClaimCandidate = v.InferOutput<typeof ClaimCandidateSchema>;

// ── ArticleResearchBrief ─────────────────────────────────────────────────────

export const ArticleResearchBriefSchema = v.pipe(
	v.object({
		briefId: v.string(),
		workingTitle: v.string(),
		thesis: v.string(),
		signalSummary: v.string(),
		markets: v.pipe(v.array(MarketSchema), v.minLength(1)),
		verticals: v.array(v.string()),
			discoverySourceIds: v.pipe(
				v.array(v.pipe(v.string(), v.regex(/^src_/))),
				v.minLength(1),
			),
			discoveryEvidenceIds: v.pipe(
				v.array(v.pipe(v.string(), v.regex(/^ev_/))),
				v.minLength(1),
			),
		decisionRelevance: v.string(),
		initialQuestions: v.array(v.string()),
		primarySourceTargets: v.array(v.string()),
		secondarySourceTargets: v.array(v.string()),
		exclusions: v.array(v.string()),
		evidenceRequirements: v.pipe(v.array(EvidenceRequirementSchema), v.minLength(1)),
	}),
	v.check(
		(brief) => brief.markets.every((m) => (SUPPORTED_MARKETS as readonly string[]).includes(m)),
		'Brief markets must be from the supported market set',
	),
	v.check(
		(brief) => brief.evidenceRequirements.some((item) => item.materiality === 'high'),
		'Every article brief requires a high-materiality evidence requirement',
	),
	v.check(
		(brief) =>
			brief.evidenceRequirements.every((item) => brief.markets.includes(item.market)),
		'Evidence requirements must be assigned to brief markets',
	),
	v.check(
		(brief) =>
			new Set(brief.evidenceRequirements.map((item) => item.requirementId)).size ===
			brief.evidenceRequirements.length,
		'Evidence requirement IDs must be unique within a brief',
	),
);
export type ArticleResearchBrief = v.InferOutput<typeof ArticleResearchBriefSchema>;

export const BriefValidationInputSchema = v.object({
	brief: ArticleResearchBriefSchema,
	sources: v.array(SourceRecordSchema),
	evidence: v.array(EvidenceExcerptSchema),
});
export type BriefValidationInput = v.InferOutput<typeof BriefValidationInputSchema>;

// ── BriefValidation ──────────────────────────────────────────────────────────

export const BriefValidationSchema = v.object({
	briefId: v.string(),
	briefVersion: v.string(),
	decision: v.picklist(['ACCEPT', 'REFINE', 'REJECT']),
	reasons: v.array(v.string()),
	duplicateOfBriefId: v.nullable(v.string()),
	requiredChanges: v.array(v.string()),
	requestedSourceTargets: v.array(v.string()),
});
export type BriefValidation = v.InferOutput<typeof BriefValidationSchema>;

// ── MarketCoverage ───────────────────────────────────────────────────────────

export const MarketCoverageSchema = v.object({
	market: MarketSchema,
	searchesPerformed: v.number(),
	signalsFound: v.number(),
	sourceIds: v.array(v.string()),
	status: v.picklist(['covered', 'no-signals', 'failed']),
});
export type MarketCoverage = v.InferOutput<typeof MarketCoverageSchema>;

// ── DiscoveryPortfolio ───────────────────────────────────────────────────────

export const DiscoveryPortfolioSchema = v.pipe(
	v.object({
		runKey: v.string(),
		coverage: v.array(MarketCoverageSchema),
		receipts: v.array(ProviderCallReceiptSchema),
		sources: v.array(SourceRecordSchema),
		evidence: v.array(EvidenceExcerptSchema),
		briefs: v.array(ArticleResearchBriefSchema),
	}),
	v.check(
		(portfolio) =>
			FOUNDATION_MARKETS.every((market) =>
				portfolio.coverage.some((coverage) => coverage.market === market),
			),
		'Portfolio must contain a coverage record for every foundation market',
	),
	v.check(
		(portfolio) => portfolio.briefs.every((b) => b.discoveryEvidenceIds.length > 0),
		'Every brief must reference discovery evidence',
	),
	v.check((portfolio) => {
		const sourceIds = new Set(portfolio.sources.map((source) => source.sourceId));
		const evidenceIds = new Set(portfolio.evidence.map((evidence) => evidence.evidenceId));
		return portfolio.briefs.every(
			(brief) =>
				brief.discoverySourceIds.every((id) => sourceIds.has(id)) &&
				brief.discoveryEvidenceIds.every((id) => evidenceIds.has(id)),
		);
	}, 'Every discovery brief reference must exist in the portfolio ledger'),
);
export type DiscoveryPortfolio = v.InferOutput<typeof DiscoveryPortfolioSchema>;

// ── MarketDiscoveryResult ───────────────────────────────────────────────────

export const MarketDiscoveryAgentResultSchema = v.pipe(
	v.object({
		runKey: v.string(),
		market: MarketSchema,
		coverage: MarketCoverageSchema,
		briefs: v.array(ArticleResearchBriefSchema),
	}),
	v.check(
		(result) =>
			result.coverage.market === result.market &&
			result.briefs.every(
				(brief) => brief.markets.length === 1 && brief.markets[0] === result.market,
			),
		'Market discovery output must contain only its assigned market',
	),
	v.check(
		(result) => result.briefs.every((brief) => brief.discoveryEvidenceIds.length > 0),
		'Every market discovery brief must reference discovery evidence',
	),
	v.check(
		(result) =>
			result.coverage.status === 'covered' ||
			(result.coverage.signalsFound === 0 && result.briefs.length === 0),
		'Markets without covered signals must not propose article briefs',
	),
);
export type MarketDiscoveryAgentResult = v.InferOutput<
	typeof MarketDiscoveryAgentResultSchema
>;

export const MarketDiscoveryResultSchema = v.pipe(
	v.object({
		runKey: v.string(),
		market: MarketSchema,
		coverage: MarketCoverageSchema,
		receipts: v.array(ProviderCallReceiptSchema),
		sources: v.array(SourceRecordSchema),
		evidence: v.array(EvidenceExcerptSchema),
		briefs: v.array(ArticleResearchBriefSchema),
	}),
	v.check(
		(result) =>
			result.coverage.market === result.market &&
			result.receipts.every((receipt) => receipt.market === result.market) &&
			result.sources.every((source) => source.market === result.market) &&
			result.briefs.every(
				(brief) => brief.markets.length === 1 && brief.markets[0] === result.market,
			),
		'Market discovery output must contain only its assigned market',
	),
	v.check(
		(result) => result.briefs.every((brief) => brief.discoveryEvidenceIds.length > 0),
		'Every market discovery brief must reference discovery evidence',
	),
	v.check((result) => {
		const sourceIds = new Set(result.sources.map((source) => source.sourceId));
		const evidenceIds = new Set(result.evidence.map((evidence) => evidence.evidenceId));
		return (
			result.coverage.sourceIds.every((id) => sourceIds.has(id)) &&
			result.evidence.every((evidence) => sourceIds.has(evidence.sourceId)) &&
			result.briefs.every(
				(brief) =>
					brief.discoverySourceIds.every((id) => sourceIds.has(id)) &&
					brief.discoveryEvidenceIds.every((id) => evidenceIds.has(id)),
			)
		);
	}, 'Every market discovery reference must exist in its result'),
);
export type MarketDiscoveryResult = v.InferOutput<typeof MarketDiscoveryResultSchema>;

// ── ArticleRegionResearchResult ──────────────────────────────────────────────

export const ArticleRegionResearchResultSchema = v.pipe(
	v.object({
		briefId: v.string(),
		market: MarketSchema,
		status: v.picklist(['complete', 'partial', 'failed']),
		receipts: v.array(ProviderCallReceiptSchema),
		sources: v.array(SourceRecordSchema),
		evidence: v.array(EvidenceExcerptSchema),
		claims: v.array(ClaimCandidateSchema),
		gaps: v.array(v.string()),
		error: v.nullable(v.string()),
	}),
	v.check((result) => {
		const sourceIds = new Set(result.sources.map((source) => source.sourceId));
		const evidenceIds = new Set(result.evidence.map((evidence) => evidence.evidenceId));
		return (
			result.evidence.every((evidence) => sourceIds.has(evidence.sourceId)) &&
			result.claims.every(
				(claim) =>
					claim.supportingEvidenceIds.every((id) => evidenceIds.has(id)) &&
					claim.contradictingEvidenceIds.every((id) => evidenceIds.has(id)),
			)
		);
	}, 'Region provenance references must exist in the result ledger'),
);
export type ArticleRegionResearchResult = v.InferOutput<typeof ArticleRegionResearchResultSchema>;

// ── SourceAudit ────────────────────────────────────────────────────────────────

export const SourceAuditSchema = v.object({
	briefId: v.string(),
	sources: v.array(SourceRecordSchema),
	evidence: v.array(EvidenceExcerptSchema),
	claims: v.array(ClaimCandidateSchema),
	gaps: v.array(v.string()),
	duplicateSourceIds: v.array(v.string()),
	staleSourceIds: v.array(v.string()),
});
export type SourceAudit = v.InferOutput<typeof SourceAuditSchema>;

export const RequirementReadinessSchema = v.object({
	requirementId: v.string(),
	market: MarketSchema,
	status: v.picklist(['satisfied', 'missing', 'weak', 'contradicted']),
	sourceIds: v.array(v.string()),
	evidenceIds: v.array(v.string()),
	missingAnchors: v.array(v.string()),
	reasonCodes: v.array(v.string()),
});

export const EvidenceReadinessReportSchema = v.object({
	briefId: v.string(),
	ready: v.boolean(),
	requirements: v.array(RequirementReadinessSchema),
	unsupportedMaterialClaimIds: v.array(v.string()),
	unsubstantiatedMaterialClaimIds: v.array(v.string()),
	blockingReasonCodes: v.array(v.string()),
});
export type EvidenceReadinessReport = v.InferOutput<typeof EvidenceReadinessReportSchema>;

export const RemediationRequirementSchema = v.object({
	requirementId: v.string(),
	question: v.string(),
	sourceRule: EvidenceSourceRuleSchema,
	targetDomains: v.array(v.string()),
	missingAnchors: v.array(v.string()),
	reasonCodes: v.array(v.string()),
	currentSourceIds: v.array(v.string()),
	currentEvidenceIds: v.array(v.string()),
	refetchUrls: v.array(v.string()),
});
export type RemediationRequirement = v.InferOutput<typeof RemediationRequirementSchema>;

export const ResearchRemediationBriefSchema = v.object({
	briefId: v.string(),
	market: MarketSchema,
	requirements: v.pipe(v.array(RemediationRequirementSchema), v.minLength(1)),
	excludedUrls: v.array(v.string()),
	maxSearches: v.literal(REMEDIATION_SEARCHES_PER_MARKET),
	maxFetches: v.literal(REMEDIATION_FETCHES_PER_MARKET),
});
export type ResearchRemediationBrief = v.InferOutput<typeof ResearchRemediationBriefSchema>;

// ── StructuralPacket ─────────────────────────────────────────────────────────

export const EditorQuestionSchema = v.object({
	question: v.string(),
	answer: v.nullable(v.string()),
	gap: v.nullable(v.string()),
});

export const StoryOptionSchema = v.object({
	title: v.string(),
	angle: v.string(),
	audience: v.string(),
});

export const StructuralPacketSchema = v.pipe(
	v.object({
		briefId: v.string(),
		packetVersion: v.string(),
		facts: v.array(v.string()),
		editorsQuestions: v.pipe(v.array(EditorQuestionSchema), v.minLength(10)),
		dependencyGraph: v.object({
			primaryActors: v.array(v.string()),
			adjacentActors: v.array(v.string()),
			infrastructure: v.array(v.string()),
			regulators: v.array(v.string()),
			customers: v.array(v.string()),
			capitalMarkets: v.array(v.string()),
		}),
		analysisLayers: v.object({
			layer1WhatChanged: v.string(),
			layer2IsNew: v.string(),
			layer3WhoLoses: v.string(),
			layer4PricingPower: v.string(),
			layer5StackCollapse: v.string(),
			layer6InstitutionalPower: v.string(),
			layer7WhatBecomesPossible: v.string(),
		}),
		storyOptions: v.pipe(v.array(StoryOptionSchema), v.minLength(3), v.maxLength(5)),
		recommendedLede: v.string(),
		whyItMatters: v.string(),
		howItChangesThings: v.string(),
		actorActionability: v.array(
			v.object({
				actor: v.string(),
				action: v.string(),
			}),
		),
		missingFacts: v.array(v.string()),
		supportingSourceIds: v.array(v.string()),
		supportingEvidenceIds: v.array(v.string()),
	}),
	v.check(
		(packet) => packet.supportingEvidenceIds.length > 0 || packet.facts.length === 0,
		'Facts must be traceable to evidence IDs',
	),
);
export type StructuralPacket = v.InferOutput<typeof StructuralPacketSchema>;

// ── ReviewReport ─────────────────────────────────────────────────────────────

const ReviewDimensionScoreSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3));

const PASS_REQUIRED_DIMENSIONS = [
	'sourceQuality',
	'factualSupport',
	'structuralAnalysis',
	'reporterVsAnalystTest',
	'libelAndAllegationRisk',
] as const;

export const ReviewReportSchema = v.pipe(
	v.object({
		briefId: v.string(),
		packetVersion: v.string(),
		decision: ReviewDecisionSchema,
		scores: v.object({
			sourceQuality: ReviewDimensionScoreSchema,
			decisionRelevance: ReviewDimensionScoreSchema,
			factualSupport: ReviewDimensionScoreSchema,
			signalStrength: ReviewDimensionScoreSchema,
			financialMaterialImpact: ReviewDimensionScoreSchema,
			nonPromotionalFilter: ReviewDimensionScoreSchema,
			libelAndAllegationRisk: ReviewDimensionScoreSchema,
			whyHowDepth: ReviewDimensionScoreSchema,
			actionability: ReviewDimensionScoreSchema,
			structuralAnalysis: ReviewDimensionScoreSchema,
			reporterVsAnalystTest: ReviewDimensionScoreSchema,
		}),
		reasons: v.array(v.string()),
		missingItems: v.array(v.string()),
		requestedSourceTargets: v.array(v.string()),
		approvedOutputType: v.nullable(v.string()),
	}),
	v.check((report) => {
		if (report.decision !== 'PASS') return true;
		const scores = Object.values(report.scores);
		if (scores.some((s) => s === 0)) return false;
		for (const dim of PASS_REQUIRED_DIMENSIONS) {
			if (report.scores[dim] < 2) return false;
		}
		return true;
	}, 'PASS requires no zero scores and required dimensions at least 2'),
);
export type ReviewReport = v.InferOutput<typeof ReviewReportSchema>;

// ── AgentExecutionRecord ─────────────────────────────────────────────────────

export const AgentExecutionRecordSchema = v.object({
	recordId: v.string(),
	runKey: v.string(),
	briefId: v.nullable(v.string()),
	agent: v.string(),
	sessionName: v.string(),
	phase: v.string(),
	modelRole: v.string(),
	modelId: v.string(),
	promptVersion: v.string(),
	skillVersions: v.record(v.string(), v.string()),
	schemaVersion: v.string(),
	startedAt: IsoDateTimeSchema,
	completedAt: IsoDateTimeSchema,
	status: v.picklist(['succeeded', 'failed', 'cancelled']),
	tokenUsage: v.nullable(
		v.object({
			input: v.number(),
			output: v.number(),
		}),
	),
	costUsd: v.nullable(v.number()),
	error: v.nullable(v.string()),
});
export type AgentExecutionRecord = v.InferOutput<typeof AgentExecutionRecordSchema>;

// ── ArticleResearchOutcome ───────────────────────────────────────────────────

export const ArticleResearchOutcomeSchema = v.object({
	brief: ArticleResearchBriefSchema,
	validation: BriefValidationSchema,
	status: v.picklist(['passed', 'needs-more-research', 'rejected', 'failed']),
	regionResults: v.array(ArticleRegionResearchResultSchema),
	sourceAudit: SourceAuditSchema,
	readiness: v.nullable(EvidenceReadinessReportSchema),
	structuralPacket: v.nullable(StructuralPacketSchema),
	review: v.nullable(ReviewReportSchema),
	execution: v.array(AgentExecutionRecordSchema),
});
export type ArticleResearchOutcome = v.InferOutput<typeof ArticleResearchOutcomeSchema>;

// ── BlockedBrief ─────────────────────────────────────────────────────────────

export const BlockedBriefPhaseSchema = v.picklist(['brief-validation', 'brief-refinement']);
export type BlockedBriefPhase = v.InferOutput<typeof BlockedBriefPhaseSchema>;

export const BlockedBriefSchema = v.object({
	brief: ArticleResearchBriefSchema,
	phase: BlockedBriefPhaseSchema,
	errorClass: v.string(),
	errorMessage: v.string(),
});
export type BlockedBrief = v.InferOutput<typeof BlockedBriefSchema>;

// ── ResearchPortfolioRun ─────────────────────────────────────────────────────

export const ResearchPortfolioRunSchema = v.object({
	runKey: v.string(),
	status: RunStatusSchema,
	discovery: DiscoveryPortfolioSchema,
	articles: v.array(ArticleResearchOutcomeSchema),
	execution: v.array(AgentExecutionRecordSchema),
	rejectedBriefs: v.array(
		v.object({
			brief: ArticleResearchBriefSchema,
			validation: BriefValidationSchema,
		}),
	),
	blockedBriefs: v.array(BlockedBriefSchema),
		providerUsage: v.object({
			requestedBudgetUsd: v.nullable(v.number()),
			effectiveBudgetUsd: v.number(),
			requestedRequestLimit: v.number(),
			effectiveRequestLimit: v.number(),
			admittedRequestCount: v.number(),
			requestRejectionCount: v.number(),
			admittedEstimateUsd: v.number(),
		actualCostUsd: v.number(),
		unpricedCallCount: v.number(),
		overrunUsd: v.number(),
		receipts: v.array(ProviderCallReceiptSchema),
	}),
	totals: v.object({
		discovered: v.number(),
		accepted: v.number(),
		passed: v.number(),
		incomplete: v.number(),
		rejected: v.number(),
		blocked: v.number(),
	}),
});
export type ResearchPortfolioRun = v.InferOutput<typeof ResearchPortfolioRunSchema>;

// ── NormalizedArticleResearchPacket (pipeline internal) ──────────────────────

export const NormalizedArticleResearchPacketSchema = v.object({
	brief: ArticleResearchBriefSchema,
	sourceAudit: SourceAuditSchema,
	regionResults: v.array(ArticleRegionResearchResultSchema),
	readiness: EvidenceReadinessReportSchema,
});
export type NormalizedArticleResearchPacket = v.InferOutput<typeof NormalizedArticleResearchPacketSchema>;

export const ReviewInputSchema = v.object({
	brief: ArticleResearchBriefSchema,
	sourceAudit: SourceAuditSchema,
	readiness: EvidenceReadinessReportSchema,
	structuralPacket: StructuralPacketSchema,
	proposedOutputType: v.string(),
});
export type ReviewInput = v.InferOutput<typeof ReviewInputSchema>;

// ── Budget helpers ───────────────────────────────────────────────────────────

export function effectiveProviderBudgetUsd(requested: number | null): number {
	const ceiling = requested ?? RESEARCH_PROVIDER_DEFAULT_RUN_USD;
	return Math.min(ceiling, RESEARCH_PROVIDER_HARD_RUN_USD);
}

export function effectiveProviderRequestLimit(requested?: number): number {
	return Math.min(
		requested ?? RESEARCH_PROVIDER_DEFAULT_REQUEST_LIMIT,
		RESEARCH_PROVIDER_HARD_REQUEST_LIMIT,
	);
}

export function allocateProviderBudget(effectiveUsd: number): {
	discovery: number;
	deepResearch: number;
	remediation: number;
} {
	return {
		discovery: effectiveUsd * 0.25,
		deepResearch: effectiveUsd * 0.65,
		remediation: effectiveUsd * 0.1,
	};
}
