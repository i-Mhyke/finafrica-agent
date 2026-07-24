import * as v from 'valibot';
import type {
	ArticleRegionResearchResult,
	ArticleResearchBrief,
	EvidenceReadinessReport,
	Market,
	SourceAudit,
} from './schemas';
import { ArticleRegionResearchResultSchema } from './schemas';

export function materialRequirementsForMarket(
	brief: ArticleResearchBrief,
	market: Market,
): ArticleResearchBrief['evidenceRequirements'] {
	return brief.evidenceRequirements.filter(
		(requirement) => requirement.market === market && requirement.materiality !== 'low',
	);
}

export function regionHasClaimLinkage(
	brief: ArticleResearchBrief,
	result: ArticleRegionResearchResult,
	market: Market = result.market,
): boolean {
	if (result.status === 'failed') return true;

	const materialRequirements = materialRequirementsForMarket(brief, market);
	if (materialRequirements.length === 0) return true;
	if (result.evidence.length === 0) return true;
	if (result.claims.length === 0) return false;

	const linkedRequirementIds = new Set(
		result.claims.flatMap((claim) => claim.requirementIds),
	);
	return materialRequirements.some((requirement) =>
		linkedRequirementIds.has(requirement.requirementId),
	);
}

export function regionFinishSchemaForBrief(
	brief: ArticleResearchBrief,
	market: Market,
) {
	return v.pipe(
		ArticleRegionResearchResultSchema,
		v.check(
			(result) => regionHasClaimLinkage(brief, result, market),
			'Region evidence must include claim candidates linked to material requirements',
		),
	);
}

export function shouldSkipRemediation(
	readiness: EvidenceReadinessReport,
	sourceAudit: SourceAudit,
): boolean {
	if (readiness.ready) return true;
	if (sourceAudit.claims.length > 0) return false;
	if (readiness.requirements.length === 0) return false;

	return readiness.requirements.every(
		(requirement) =>
			requirement.status !== 'satisfied' &&
			requirement.reasonCodes.length === 1 &&
			requirement.reasonCodes[0] === 'requirement_no_claim',
	);
}
