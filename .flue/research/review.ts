import type {
	EvidenceReadinessReport,
	ReviewReport,
	SourceAudit,
	StructuralPacket,
} from './schemas';

/** PASS is valid only when the review targets the current structural packet version. */
export function reconcileReviewWithPacket(
	review: ReviewReport,
	structuralPacket: StructuralPacket,
): ReviewReport {
	if (review.decision !== 'PASS') return review;
	if (review.packetVersion === structuralPacket.packetVersion) return review;
	return {
		...review,
		decision: 'NEEDS_MORE_RESEARCH',
		reasons: [
			...review.reasons,
			`Review packet version ${review.packetVersion} does not match structural packet ${structuralPacket.packetVersion}`,
		],
	};
}

export function reconcileReviewWithEvidence(
	review: ReviewReport,
	structuralPacket: StructuralPacket,
	sourceAudit: SourceAudit,
	readiness: EvidenceReadinessReport,
): ReviewReport {
	if (review.decision !== 'REJECT' && !readiness.ready) {
		return {
			...review,
			decision: 'NEEDS_MORE_RESEARCH',
			reasons: review.reasons,
			missingItems: [
				...review.missingItems,
				'Deterministic evidence readiness blocked PASS',
				...readiness.blockingReasonCodes,
			],
		};
	}

	const versionChecked = reconcileReviewWithPacket(review, structuralPacket);
	if (versionChecked.decision !== 'PASS') return versionChecked;

	const sourceIds = new Set(sourceAudit.sources.map((source) => source.sourceId));
	const evidenceIds = new Set(sourceAudit.evidence.map((evidence) => evidence.evidenceId));
	const missingSourceIds = structuralPacket.supportingSourceIds.filter((id) => !sourceIds.has(id));
	const missingEvidenceIds = structuralPacket.supportingEvidenceIds.filter((id) => !evidenceIds.has(id));
	const unsupportedClaims = sourceAudit.claims.filter(
		(claim) => claim.kind === 'fact' && claim.status !== 'supported',
	);
	const hasUnboundFacts =
		structuralPacket.facts.length > 0 && structuralPacket.supportingEvidenceIds.length === 0;

	if (
		missingSourceIds.length === 0 &&
		missingEvidenceIds.length === 0 &&
		unsupportedClaims.length === 0 &&
		!hasUnboundFacts
	) {
		return versionChecked;
	}

	return {
		...versionChecked,
		decision: 'NEEDS_MORE_RESEARCH',
		reasons: [
			...versionChecked.reasons,
			'Deterministic evidence audit blocked PASS',
		],
		missingItems: [
			...versionChecked.missingItems,
			...missingSourceIds.map((id) => `Missing source ${id}`),
			...missingEvidenceIds.map((id) => `Missing evidence ${id}`),
			...unsupportedClaims.map((claim) => `Unsupported factual claim ${claim.claimId}`),
			...(hasUnboundFacts ? ['Structural facts have no supporting evidence'] : []),
		],
	};
}
