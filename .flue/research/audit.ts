import { deriveSourceId, normalizeCanonicalUrl } from './ids';
import type {
	ArticleRegionResearchResult,
	ArticleResearchBrief,
	ClaimCandidate,
	EvidenceExcerpt,
	SourceAudit,
	SourceRecord,
} from './schemas';

export function deduplicateBriefs(
	briefs: ArticleResearchBrief[],
): { unique: ArticleResearchBrief[]; duplicates: Array<{ brief: ArticleResearchBrief; duplicateOfBriefId: string }> } {
	const seen = new Map<string, ArticleResearchBrief>();
	const unique: ArticleResearchBrief[] = [];
	const duplicates: Array<{ brief: ArticleResearchBrief; duplicateOfBriefId: string }> = [];

	for (const brief of briefs) {
		const key = brief.workingTitle.toLowerCase().trim();
		const existing = seen.get(key);
		if (existing) {
			duplicates.push({ brief, duplicateOfBriefId: existing.briefId });
		} else {
			seen.set(key, brief);
			unique.push(brief);
		}
	}
	return { unique, duplicates };
}

export async function auditArticleResearch(
	brief: ArticleResearchBrief,
	regionResults: ArticleRegionResearchResult[],
): Promise<SourceAudit> {
	const sourceMap = new Map<string, SourceRecord>();
	const evidenceMap = new Map<string, EvidenceExcerpt>();
	const claimMap = new Map<string, ClaimCandidate>();
	const gaps: string[] = [];
	const duplicateSourceIds: string[] = [];
	const staleSourceIds: string[] = [];
	const now = Date.now();
	const staleThresholdMs = 365 * 24 * 60 * 60 * 1000;

	for (const region of regionResults) {
		const sourceIdRemap = new Map<string, string>();

		for (const source of region.sources) {
			const canonical = normalizeCanonicalUrl(source.canonicalUrl);
			const sourceId = await deriveSourceId(canonical);
			sourceIdRemap.set(source.sourceId, sourceId);
			const existing = sourceMap.get(sourceId);
			if (existing) {
				duplicateSourceIds.push(sourceId);
				sourceMap.set(sourceId, {
					...existing,
					receiptIds: [...new Set([...existing.receiptIds, ...source.receiptIds])],
				});
			} else {
				sourceMap.set(sourceId, { ...source, sourceId, canonicalUrl: canonical });
			}

			if (source.publishedAt) {
				const age = now - new Date(source.publishedAt).getTime();
				if (age > staleThresholdMs) staleSourceIds.push(sourceId);
			}
		}

		for (const excerpt of region.evidence) {
			const remappedSourceId = sourceIdRemap.get(excerpt.sourceId) ?? excerpt.sourceId;
			evidenceMap.set(excerpt.evidenceId, { ...excerpt, sourceId: remappedSourceId });
		}

		for (const claim of region.claims) {
			claimMap.set(claim.claimId, claim);
		}

		gaps.push(...region.gaps);
	}

	// Validate referential integrity
	for (const excerpt of evidenceMap.values()) {
		if (!sourceMap.has(excerpt.sourceId)) {
			gaps.push(`Dangling evidence ${excerpt.evidenceId} references missing source ${excerpt.sourceId}`);
		}
	}

	const claims = [...claimMap.values()].map((claim) => {
		const supportingValid = claim.supportingEvidenceIds.every((id) => evidenceMap.has(id));
		const contradictingValid = claim.contradictingEvidenceIds.every((id) => evidenceMap.has(id));

		if (!supportingValid || !contradictingValid) {
			gaps.push(`Dangling claim reference on ${claim.claimId}`);
		}

		// Social-only material claims
		if (claim.kind === 'fact' && claim.materiality === 'high') {
			const supportingSources = claim.supportingEvidenceIds
				.map((id) => evidenceMap.get(id))
				.filter(Boolean)
				.map((e) => sourceMap.get(e!.sourceId))
				.filter(Boolean);

			const allSocial =
				supportingSources.length > 0 &&
				supportingSources.every((s) => s!.sourceType === 'social');

			if (allSocial) {
				return { ...claim, status: 'unsupported' as const };
			}
		}

		if (
			claim.kind === 'fact' &&
			claim.materiality !== 'low' &&
			claim.supportingEvidenceIds.length === 0 &&
			claim.status === 'supported'
		) {
			return { ...claim, status: 'unsupported' as const };
		}

		return claim;
	});

	const sources = [...sourceMap.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
	const evidence = [...evidenceMap.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
	const sortedClaims = claims.sort((a, b) => a.claimId.localeCompare(b.claimId));

	return {
		briefId: brief.briefId,
		sources,
		evidence,
		claims: sortedClaims,
		gaps: [...new Set(gaps)].sort(),
		duplicateSourceIds: [...new Set(duplicateSourceIds)].sort(),
		staleSourceIds: [...new Set(staleSourceIds)].sort(),
	};
}

export function mergeArticleRemediation(
	previous: ArticleRegionResearchResult,
	remediation: ArticleRegionResearchResult,
): ArticleRegionResearchResult {
	return {
		...previous,
		status: remediation.status === 'failed' ? previous.status : remediation.status,
		receipts: [...previous.receipts, ...remediation.receipts],
		sources: mergeById(previous.sources, remediation.sources, 'sourceId'),
		evidence: mergeById(previous.evidence, remediation.evidence, 'evidenceId'),
		claims: mergeById(previous.claims, remediation.claims, 'claimId'),
		gaps: [...new Set([...previous.gaps, ...remediation.gaps])].sort(),
		error: remediation.error ?? previous.error,
	};
}

function mergeById<T extends Record<string, unknown>>(
	a: T[],
	b: T[],
	idKey: keyof T,
): T[] {
	const map = new Map<string, T>();
	for (const item of [...a, ...b]) {
		map.set(String(item[idKey]), item);
	}
	return [...map.values()].sort((x, y) => String(x[idKey]).localeCompare(String(y[idKey])));
}
