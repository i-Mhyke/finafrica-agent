import type {
	ArticleResearchBrief,
	EvidenceReadinessReport,
	EvidenceRequirement,
	ResearchRemediationBrief,
	RemediationRequirement,
	SourceAudit,
} from './schemas';
import {
	REMEDIATION_FETCHES_PER_MARKET,
	REMEDIATION_SEARCHES_PER_MARKET,
} from './schemas';

function sourcesForRequirement(
	requirementId: string,
	sourceAudit: SourceAudit,
): { sourceIds: string[]; evidenceIds: string[]; urls: string[] } {
	const linkedClaims = sourceAudit.claims.filter((claim) =>
		claim.requirementIds.includes(requirementId),
	);
	const evidenceIds = [
		...new Set(linkedClaims.flatMap((claim) => claim.supportingEvidenceIds)),
	];
	const evidence = sourceAudit.evidence.filter((item) =>
		evidenceIds.includes(item.evidenceId),
	);
	const sourceIds = [...new Set(evidence.map((item) => item.sourceId))];
	const sources = sourceAudit.sources.filter((source) =>
		sourceIds.includes(source.sourceId),
	);
	return {
		sourceIds,
		evidenceIds,
		urls: sources.map((source) => source.canonicalUrl),
	};
}

function buildRequirementRemediation(
	requirement: EvidenceRequirement,
	readiness: EvidenceReadinessReport['requirements'][number],
	sourceAudit: SourceAudit,
): RemediationRequirement {
	const links = sourcesForRequirement(requirement.requirementId, sourceAudit);
	const reasonCodes = readiness.reasonCodes;
	const canRefetch =
		reasonCodes.includes('requirement_anchor_missing') ||
		reasonCodes.includes('requirement_no_evidence');
	const refetchUrls = canRefetch && links.urls.length > 0 ? links.urls : [];

	return {
		requirementId: requirement.requirementId,
		question: requirement.question,
		sourceRule: requirement.sourceRule,
		targetDomains: requirement.targetDomains,
		missingAnchors: readiness.missingAnchors,
		reasonCodes,
		currentSourceIds: links.sourceIds,
		currentEvidenceIds: links.evidenceIds,
		refetchUrls,
	};
}

function excludedUrlsForMarket(
	market: string,
	sourceAudit: SourceAudit,
	blockedRequirementIds: Set<string>,
): string[] {
	const linkedSourceIds = new Set<string>();
	for (const requirementId of blockedRequirementIds) {
		for (const sourceId of sourcesForRequirement(requirementId, sourceAudit).sourceIds) {
			linkedSourceIds.add(sourceId);
		}
	}

	const excluded = new Set<string>();
	for (const sourceId of sourceAudit.duplicateSourceIds) {
		const source = sourceAudit.sources.find((item) => item.sourceId === sourceId);
		if (source?.market === market) excluded.add(source.canonicalUrl);
	}
	for (const sourceId of sourceAudit.staleSourceIds) {
		const source = sourceAudit.sources.find((item) => item.sourceId === sourceId);
		if (source?.market === market) excluded.add(source.canonicalUrl);
	}
	for (const source of sourceAudit.sources) {
		if (source.market !== market) continue;
		if (linkedSourceIds.has(source.sourceId)) continue;
		const linkedToSatisfied = sourceAudit.claims.some(
			(claim) =>
				claim.supportingEvidenceIds.some((evidenceId) =>
					sourceAudit.evidence.some(
						(item) => item.evidenceId === evidenceId && item.sourceId === source.sourceId,
					),
				) &&
				claim.requirementIds.some((id) => !blockedRequirementIds.has(id)),
		);
		if (!linkedToSatisfied) {
			excluded.add(source.canonicalUrl);
		}
	}
	return [...excluded];
}

export function buildRemediationBriefs(
	brief: ArticleResearchBrief,
	sourceAudit: SourceAudit,
	readiness: EvidenceReadinessReport,
): ResearchRemediationBrief[] {
	if (readiness.ready) return [];

	const blocked = readiness.requirements.filter((item) => item.status !== 'satisfied');
	if (blocked.length === 0) return [];

	const blockedIds = new Set(blocked.map((item) => item.requirementId));
	const markets = brief.markets.filter((market) =>
		blocked.some((item) => item.market === market),
	);

	return markets.map((market) => {
		const marketBlocked = blocked.filter((item) => item.market === market);
		const marketBlockedIds = new Set(marketBlocked.map((item) => item.requirementId));
		const requirements = brief.evidenceRequirements
			.filter((item) => item.market === market && marketBlockedIds.has(item.requirementId))
			.map((requirement) => {
				const readinessItem = marketBlocked.find(
					(item) => item.requirementId === requirement.requirementId,
				)!;
				return buildRequirementRemediation(requirement, readinessItem, sourceAudit);
			});

		return {
			briefId: brief.briefId,
			market,
			requirements,
			excludedUrls: excludedUrlsForMarket(market, sourceAudit, marketBlockedIds),
			maxSearches: REMEDIATION_SEARCHES_PER_MARKET,
			maxFetches: REMEDIATION_FETCHES_PER_MARKET,
		};
	});
}
