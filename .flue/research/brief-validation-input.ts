import type {
	ArticleResearchBrief,
	BriefValidationInput,
	DiscoveryPortfolio,
} from './schemas';

export function buildBriefValidationInput(
	brief: ArticleResearchBrief,
	portfolio: DiscoveryPortfolio,
): BriefValidationInput {
	const sourceIds = new Set(brief.discoverySourceIds);
	const evidenceIds = new Set(brief.discoveryEvidenceIds);
	return {
		brief,
		sources: portfolio.sources.filter((source) => sourceIds.has(source.sourceId)),
		evidence: portfolio.evidence.filter((item) => evidenceIds.has(item.evidenceId)),
	};
}
