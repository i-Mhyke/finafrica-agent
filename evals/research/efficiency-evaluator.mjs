function countCallsByArticle(stages, phase) {
	const counts = new Map();
	for (const stage of stages) {
		if (stage.phase !== phase || stage.briefId === null) continue;
		counts.set(stage.briefId, (counts.get(stage.briefId) ?? 0) + 1);
	}
	return counts;
}

function maxCount(counts) {
	return counts.size === 0 ? 0 : Math.max(...counts.values());
}

export function evaluateEfficiencyCase(evalCase) {
	const { auditReport } = evalCase.input;
	const failures = [];
	const observations = [];

	const efficiency = auditReport.efficiency;
	if (!efficiency?.provider || !efficiency?.model) {
		return {
			passed: false,
			failures: ['audit_metric_missing'],
			observations,
			metrics: {},
		};
	}
	if (!Array.isArray(auditReport.stages) || !Array.isArray(auditReport.timeline)) {
		return {
			passed: false,
			failures: ['audit_metric_missing'],
			observations,
			metrics: {},
		};
	}

	const providerAttemptCount = efficiency.provider.attemptCount;
	const providerCostUsd = efficiency.provider.reportedCostUsd;
	const llmInputTokens = efficiency.model.inputTokens;
	const llmOutputTokens = efficiency.model.outputTokens;
	const llmCostUsd = efficiency.model.costUsd;

	const providerFailureCount = auditReport.timeline.filter(
		(entry) => entry.auditEvent === 'provider_attempt_failed',
	).length;

	const structuralAnalysisCallsByArticle = countCallsByArticle(
		auditReport.stages,
		'structural-analysis',
	);
	const researchReviewCallsByArticle = countCallsByArticle(auditReport.stages, 'review');

	const maxStructuralAnalysisCalls = maxCount(structuralAnalysisCallsByArticle);
	const maxResearchReviewCalls = maxCount(researchReviewCallsByArticle);

	const discoverySearchesByMarket = { nigeria: 0, ghana: 0 };
	for (const entry of auditReport.timeline) {
		if (
			entry.auditEvent === 'provider_attempt_completed' &&
			entry.phase === 'discovery' &&
			entry.operation === 'search' &&
			entry.briefId === null &&
			entry.market
		) {
			discoverySearchesByMarket[entry.market] =
				(discoverySearchesByMarket[entry.market] ?? 0) + 1;
		}
	}

	if (providerAttemptCount > evalCase.expected.maxProviderAttempts) {
		failures.push('provider_attempt_limit_exceeded');
	}
	if (providerFailureCount > evalCase.expected.maxProviderFailures) {
		failures.push('provider_failure_limit_exceeded');
	}
	if (maxStructuralAnalysisCalls > evalCase.expected.maxStructuralAnalysisCallsPerArticle) {
		failures.push('structural_analysis_call_limit_exceeded');
	}
	if (maxResearchReviewCalls > evalCase.expected.maxResearchReviewCallsPerArticle) {
		failures.push('research_review_call_limit_exceeded');
	}
	if (discoverySearchesByMarket.nigeria !== discoverySearchesByMarket.ghana) {
		failures.push('unequal_discovery_allocation');
		observations.push('unequal_discovery_allocation');
	}

	return {
		passed: failures.length === 0,
		failures,
		observations,
		metrics: {
			providerAttemptCount,
			providerFailureCount,
			providerCostUsd,
			llmInputTokens,
			llmOutputTokens,
			llmCostUsd,
			maxStructuralAnalysisCallsPerArticle: maxStructuralAnalysisCalls,
			maxResearchReviewCallsPerArticle: maxResearchReviewCalls,
			discoverySearchesNigeria: discoverySearchesByMarket.nigeria,
			discoverySearchesGhana: discoverySearchesByMarket.ghana,
		},
	};
}
