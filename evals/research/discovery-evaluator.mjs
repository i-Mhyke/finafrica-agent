function setsEqual(left, right) {
	if (left.length !== right.length) return false;
	const leftSet = new Set(left);
	return right.every((item) => leftSet.has(item));
}

function countCrossMarketContamination(portfolio, caseMarket) {
	let count = 0;

	for (const source of portfolio.sources) {
		if (source.market !== caseMarket) count += 1;
	}

	for (const brief of portfolio.briefs) {
		if (!brief.markets.includes(caseMarket)) count += 1;
	}

	return count;
}

function computeRelevantBriefIds(portfolio, caseMarket) {
	const sourcesById = new Map(portfolio.sources.map((source) => [source.sourceId, source]));
	return portfolio.briefs
		.filter((brief) => {
			if (!brief.markets.includes(caseMarket)) return false;
			return brief.discoverySourceIds.every((sourceId) => {
				const source = sourcesById.get(sourceId);
				return source && source.market === caseMarket;
			});
		})
		.map((brief) => brief.briefId);
}

function computeIrrelevantBriefIds(portfolio, relevantBriefIds) {
	const relevant = new Set(relevantBriefIds);
	return portfolio.briefs
		.filter((brief) => !relevant.has(brief.briefId))
		.map((brief) => brief.briefId);
}

function computeMarketSourceIds(portfolio, caseMarket) {
	return portfolio.sources
		.filter((source) => source.market === caseMarket)
		.map((source) => source.sourceId);
}

export function evaluateDiscoveryCase(evalCase) {
	const { portfolio } = evalCase.input;
	const caseMarket = evalCase.market;
	const failures = [];
	const observations = [];

	const discoveredBriefCount = portfolio.briefs.length;
	const relevantBriefIds = computeRelevantBriefIds(portfolio, caseMarket);
	const irrelevantBriefIds = computeIrrelevantBriefIds(portfolio, relevantBriefIds);
	const relevantBriefCount = relevantBriefIds.length;
	const retainedSourceCount = portfolio.sources.length;
	const marketSourceIds = computeMarketSourceIds(portfolio, caseMarket);
	const sourcesWhoseMarketMatches = marketSourceIds.length;
	const crossMarketContaminationCount = countCrossMarketContamination(portfolio, caseMarket);

	const sourcesById = new Map(portfolio.sources.map((source) => [source.sourceId, source]));
	const relevantBriefsWithPrimary = relevantBriefIds.filter((briefId) => {
		const brief = portfolio.briefs.find((item) => item.briefId === briefId);
		if (!brief) return false;
		return brief.discoverySourceIds.some((sourceId) => {
			const source = sourcesById.get(sourceId);
			return source?.sourceType === 'primary';
		});
	}).length;

	const candidatePrecision =
		discoveredBriefCount === 0 ? 0 : relevantBriefCount / discoveredBriefCount;
	const marketSpecificSourceRate =
		retainedSourceCount === 0 ? 0 : sourcesWhoseMarketMatches / retainedSourceCount;
	const primarySourceHitRate =
		relevantBriefCount === 0 ? 0 : relevantBriefsWithPrimary / relevantBriefCount;

	if (crossMarketContaminationCount > 0) {
		observations.push('cross_market_contamination');
	}

	if (!setsEqual(relevantBriefIds, evalCase.expected.relevantBriefIds)) {
		failures.push('relevant_brief_set_mismatch');
	}
	if (!setsEqual(irrelevantBriefIds, evalCase.expected.irrelevantBriefIds)) {
		failures.push('irrelevant_brief_set_mismatch');
	}
	if (!setsEqual(marketSourceIds, evalCase.expected.expectedMarketSourceIds)) {
		failures.push('market_source_set_mismatch');
	}
	if (crossMarketContaminationCount !== evalCase.expected.crossMarketContaminationCount) {
		failures.push('cross_market_contamination_count_mismatch');
	}

	return {
		passed: failures.length === 0,
		failures,
		observations,
		metrics: {
			candidatePrecision,
			marketSpecificSourceRate,
			primarySourceHitRate,
			crossMarketContaminationCount,
			discoveredBriefCount,
			relevantBriefCount,
			retainedSourceCount,
		},
	};
}
