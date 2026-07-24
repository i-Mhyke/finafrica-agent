import * as v from 'valibot';

const MARKETS = ['nigeria', 'ghana'];
const CASE_KINDS = ['discovery', 'evidence', 'review', 'efficiency'];
const SOURCE_OF_TRUTH = ['editor-reviewed', 'deterministic-invariant'];

const EvalSourceSchema = v.looseObject({
	sourceId: v.string(),
	canonicalUrl: v.string(),
	publisher: v.nullable(v.string()),
	market: v.picklist(MARKETS),
	tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
	sourceType: v.picklist(['primary', 'secondary', 'social']),
});

const EvalEvidenceSchema = v.looseObject({
	evidenceId: v.string(),
	sourceId: v.string(),
	text: v.string(),
});

const EvalClaimSchema = v.looseObject({
	claimId: v.string(),
	kind: v.picklist(['fact', 'reported-claim', 'inference']),
	materiality: v.picklist(['low', 'medium', 'high']),
	requirementIds: v.array(v.string()),
	supportingEvidenceIds: v.array(v.string()),
	status: v.picklist(['supported', 'disputed', 'unsupported']),
});

const EvalRequirementSchema = v.looseObject({
	requirementId: v.string(),
	sourceRule: v.picklist([
		'primary',
		'independent-secondary',
		'primary-or-two-independent-secondary',
	]),
	targetDomains: v.array(v.string()),
	anchors: v.array(v.string()),
});

const EvalBriefSchema = v.looseObject({
	briefId: v.string(),
	markets: v.array(v.picklist(MARKETS)),
	discoverySourceIds: v.array(v.string()),
	evidenceRequirements: v.array(EvalRequirementSchema),
});

const EvalReadinessSchema = v.looseObject({
	ready: v.boolean(),
	unsupportedMaterialClaimIds: v.array(v.string()),
	unsubstantiatedMaterialClaimIds: v.array(v.string()),
});

const EvalStructuralPacketSchema = v.looseObject({
	packetVersion: v.string(),
	editorsQuestions: v.array(v.unknown()),
	storyOptions: v.array(v.unknown()),
	analysisLayers: v.object({
		layer1WhatChanged: v.string(),
		layer2IsNew: v.string(),
		layer3WhoLoses: v.string(),
		layer4PricingPower: v.string(),
		layer5StackCollapse: v.string(),
		layer6InstitutionalPower: v.string(),
		layer7WhatBecomesPossible: v.string(),
	}),
});

const EvalReviewSchema = v.looseObject({
	packetVersion: v.string(),
	decision: v.picklist(['PASS', 'NEEDS_MORE_RESEARCH', 'REJECT']),
	scores: v.looseObject({
		sourceQuality: v.number(),
		factualSupport: v.number(),
		structuralAnalysis: v.number(),
		reporterVsAnalystTest: v.number(),
		libelAndAllegationRisk: v.number(),
	}),
});

const EvalAuditSchema = v.looseObject({
	efficiency: v.looseObject({
		provider: v.looseObject({
			attemptCount: v.number(),
			reportedCostUsd: v.number(),
		}),
		model: v.looseObject({
			inputTokens: v.number(),
			outputTokens: v.number(),
			costUsd: v.number(),
		}),
	}),
	stages: v.array(
		v.looseObject({
			phase: v.string(),
			briefId: v.nullable(v.string()),
		}),
	),
	timeline: v.array(
		v.looseObject({
			auditEvent: v.optional(v.nullable(v.string())),
			phase: v.optional(v.nullable(v.string())),
			operation: v.optional(v.nullable(v.string())),
			briefId: v.optional(v.nullable(v.string())),
			market: v.optional(v.nullable(v.picklist(MARKETS))),
			kind: v.optional(v.string()),
		}),
	),
});

const DiscoveryInputSchema = v.object({
	portfolio: v.looseObject({
		briefs: v.array(EvalBriefSchema),
		sources: v.array(EvalSourceSchema),
		evidence: v.array(EvalEvidenceSchema),
	}),
});

const DiscoveryExpectedSchema = v.object({
	relevantBriefIds: v.array(v.string()),
	irrelevantBriefIds: v.array(v.string()),
	expectedMarketSourceIds: v.array(v.string()),
	crossMarketContaminationCount: v.number(),
});

const EvidenceInputSchema = v.object({
	brief: EvalBriefSchema,
	sourceAudit: v.looseObject({
		sources: v.array(EvalSourceSchema),
		evidence: v.array(EvalEvidenceSchema),
		claims: v.array(EvalClaimSchema),
	}),
	readiness: EvalReadinessSchema,
	finalDecision: v.string(),
});

const EvidenceExpectedSchema = v.object({
	unsupportedMaterialClaimIds: v.array(v.string()),
	unsubstantiatedMaterialClaimIds: v.array(v.string()),
	readinessReady: v.boolean(),
	materialAnchorCoverage: v.number(),
	primaryRequirementSatisfactionRate: v.number(),
	socialOnlyMaterialSupportCount: v.number(),
	danglingEvidenceReferenceCount: v.number(),
	danglingSourceReferenceCount: v.number(),
	unsupportedMaterialClaimEscapeCount: v.number(),
	requirementStates: v.optional(
		v.record(
			v.string(),
			v.picklist(['satisfied', 'weak', 'missing', 'contradicted']),
		),
	),
});

const ReviewInputSchema = v.object({
	readiness: EvalReadinessSchema,
	structuralPacket: EvalStructuralPacketSchema,
	review: EvalReviewSchema,
});

const ReviewExpectedSchema = v.object({
	publicationEligible: v.boolean(),
});

const EfficiencyInputSchema = v.object({
	auditReport: EvalAuditSchema,
});

const EfficiencyExpectedSchema = v.object({
	maxProviderAttempts: v.number(),
	maxProviderFailures: v.number(),
	maxStructuralAnalysisCallsPerArticle: v.number(),
	maxResearchReviewCallsPerArticle: v.number(),
});

const BaseCaseSchema = v.object({
	caseId: v.string(),
	caseVersion: v.literal(1),
	market: v.picklist([...MARKETS, 'portfolio']),
	rationale: v.string(),
	sourceOfTruth: v.picklist(SOURCE_OF_TRUTH),
	enforceHardGates: v.boolean(),
});

const DiscoveryCaseSchema = v.object({
	...BaseCaseSchema.entries,
	kind: v.literal('discovery'),
	input: DiscoveryInputSchema,
	expected: DiscoveryExpectedSchema,
});

const EvidenceCaseSchema = v.object({
	...BaseCaseSchema.entries,
	kind: v.literal('evidence'),
	input: EvidenceInputSchema,
	expected: EvidenceExpectedSchema,
});

const ReviewCaseSchema = v.object({
	...BaseCaseSchema.entries,
	kind: v.literal('review'),
	input: ReviewInputSchema,
	expected: ReviewExpectedSchema,
});

const EfficiencyCaseSchema = v.object({
	...BaseCaseSchema.entries,
	kind: v.literal('efficiency'),
	input: EfficiencyInputSchema,
	expected: EfficiencyExpectedSchema,
});

const EvalCaseSchema = v.variant('kind', [
	DiscoveryCaseSchema,
	EvidenceCaseSchema,
	ReviewCaseSchema,
	EfficiencyCaseSchema,
]);

const EvalSuiteSchema = v.pipe(
	v.object({
		suiteVersion: v.literal(1),
		cases: v.array(v.string()),
	}),
	v.check((suite) => {
		const ids = new Set();
		for (const caseFile of suite.cases) {
			if (caseFile.startsWith('/') || caseFile.includes('..')) {
				return false;
			}
			const caseId = caseFile.replace(/\.json$/, '');
			if (ids.has(caseId)) {
				return false;
			}
			ids.add(caseId);
		}
		return true;
	}, 'duplicate case IDs in one suite or absolute input artifact paths'),
);

const EvalReportCaseSchema = v.object({
	caseId: v.string(),
	kind: v.string(),
	passed: v.boolean(),
	failures: v.array(v.string()),
	observations: v.array(v.string()),
	metrics: v.record(v.string(), v.number()),
});

const EvalReportSchema = v.pipe(
	v.object({
		evaluatorVersion: v.literal(1),
		generatedAt: v.string(),
		suitePath: v.string(),
		cases: v.array(EvalReportCaseSchema),
		metrics: v.record(v.string(), v.number()),
		hardGateFailures: v.array(v.string()),
		passed: v.boolean(),
	}),
	v.check(
		(report) =>
			report.passed ===
			(report.hardGateFailures.length === 0 && report.cases.every((item) => item.passed)),
		'passed must equal hardGateFailures.length === 0 && cases.every(item => item.passed)',
	),
);

function parse(schema, value, label) {
	const result = v.safeParse(schema, value);
	if (!result.success) {
		const message = result.issues.map((issue) => issue.message).join('; ');
		throw new Error(`${label}: ${message}`);
	}
	return result.output;
}

export function parseEvalCase(value) {
	const parsed = parse(EvalCaseSchema, value, 'eval case');
	if (!CASE_KINDS.includes(parsed.kind)) {
		throw new Error(`eval case: unsupported case kind`);
	}
	return parsed;
}

export function parseEvalSuite(value) {
	return parse(EvalSuiteSchema, value, 'eval suite');
}

export function parseEvalReport(value) {
	return parse(EvalReportSchema, value, 'eval report');
}
