import { evidenceContainsAnchor } from '../../.flue/research/evidence-anchor-matcher.mjs';
import { evaluateEvidenceReadiness } from '../../.flue/research/evidence-readiness.ts';

const EVAL_READINESS_WINDOW = {
	start: '2026-07-22T00:00:00Z',
	end: '2026-07-24T00:00:00Z',
};

function excerptContainsAnchor(excerpt, anchor) {
	return evidenceContainsAnchor(excerpt, anchor);
}

function isPrimarySource(source) {
	return source.sourceType === 'primary' && source.tier === 1;
}

function domainMatchesTarget(canonicalUrl, targetDomains) {
	try {
		const hostname = new URL(canonicalUrl).hostname.replace(/^www\./, '');
		return targetDomains.some(
			(domain) => hostname === domain || hostname.endsWith(`.${domain}`),
		);
	} catch {
		return false;
	}
}

function requirementSatisfied(requirement, sourceAudit) {
	const linkedClaims = sourceAudit.claims.filter((claim) =>
		claim.requirementIds.includes(requirement.requirementId),
	);
	const evidenceIds = new Set(
		linkedClaims.flatMap((claim) => claim.supportingEvidenceIds),
	);
	const linkedEvidence = sourceAudit.evidence.filter((item) =>
		evidenceIds.has(item.evidenceId),
	);
	const linkedSourceIds = new Set(linkedEvidence.map((item) => item.sourceId));
	const linkedSources = sourceAudit.sources.filter((source) =>
		linkedSourceIds.has(source.sourceId),
	);

	if (requirement.sourceRule === 'primary') {
		return linkedSources.some(
			(source) => isPrimarySource(source) && domainMatchesTarget(source.canonicalUrl, requirement.targetDomains),
		);
	}

	return linkedSources.length > 0;
}

function buildEvalReadinessBrief(evalCase) {
	return {
		...evalCase.input.brief,
		evidenceRequirements: evalCase.input.brief.evidenceRequirements.map((requirement) => ({
			market: evalCase.market,
			question: requirement.requirementId,
			materiality: 'high',
			recencyRule: 'none',
			...requirement,
		})),
	};
}

function buildEvalReadinessAudit(evalCase) {
	const { sourceAudit } = evalCase.input;
	return {
		briefId: evalCase.input.brief.briefId,
		gaps: [],
		duplicateSourceIds: [],
		staleSourceIds: [],
		sources: sourceAudit.sources.map((source) => ({
			retrievedAt: '2026-07-23T00:00:00Z',
			receiptIds: [],
			contentHash: null,
			rightsNote: null,
			author: null,
			publishedAt: null,
			publisher: source.publisher ?? null,
			...source,
		})),
		evidence: sourceAudit.evidence.map((item) => ({
			supports: [],
			capturedAt: '2026-07-23T00:00:00Z',
			...item,
		})),
		claims: sourceAudit.claims.map((claim) => ({
			statement: claim.claimId,
			contradictingEvidenceIds: [],
			...claim,
		})),
	};
}

export function evaluateEvidenceCase(evalCase) {
	const { brief, sourceAudit, readiness, finalDecision } = evalCase.input;
	const failures = [];
	const observations = [];

	const evidenceById = new Map(sourceAudit.evidence.map((item) => [item.evidenceId, item]));
	const sourcesById = new Map(sourceAudit.sources.map((item) => [item.sourceId, item]));

	const materialClaims = sourceAudit.claims.filter(
		(claim) => claim.kind === 'fact' && claim.materiality !== 'low',
	);
	const supportedMaterialClaims = materialClaims.filter((claim) => claim.status === 'supported');
	const materialClaimSupportRate =
		materialClaims.length === 0
			? 0
			: supportedMaterialClaims.length / materialClaims.length;

	const requiredAnchors = brief.evidenceRequirements.flatMap((req) => req.anchors);
	let anchorsFound = 0;
	for (const requirement of brief.evidenceRequirements) {
		const linkedClaims = sourceAudit.claims.filter((claim) =>
			claim.requirementIds.includes(requirement.requirementId),
		);
		const evidenceIds = new Set(
			linkedClaims.flatMap((claim) => claim.supportingEvidenceIds),
		);
		for (const anchor of requirement.anchors) {
			const found = [...evidenceIds].some((evidenceId) => {
				const excerpt = evidenceById.get(evidenceId)?.text ?? '';
				return excerptContainsAnchor(excerpt, anchor);
			});
			if (found) anchorsFound += 1;
		}
	}
	const materialAnchorCoverage =
		requiredAnchors.length === 0 ? 0 : anchorsFound / requiredAnchors.length;

	const primaryRequirements = brief.evidenceRequirements.filter(
		(req) => req.sourceRule === 'primary',
	);
	const satisfiedPrimary = primaryRequirements.filter((req) =>
		requirementSatisfied(req, sourceAudit),
	).length;
	const primaryRequirementSatisfactionRate =
		primaryRequirements.length === 0 ? 0 : satisfiedPrimary / primaryRequirements.length;

	let socialOnlyMaterialSupportCount = 0;
	for (const claim of materialClaims) {
		const linkedSources = claim.supportingEvidenceIds
			.map((evidenceId) => evidenceById.get(evidenceId))
			.filter(Boolean)
			.map((evidence) => sourcesById.get(evidence.sourceId))
			.filter(Boolean);
		if (
			linkedSources.length > 0 &&
			linkedSources.every((source) => source.sourceType === 'social')
		) {
			socialOnlyMaterialSupportCount += 1;
		}
	}

	const danglingEvidenceReferenceCount = sourceAudit.claims.reduce((count, claim) => {
		return (
			count +
			claim.supportingEvidenceIds.filter((evidenceId) => !evidenceById.has(evidenceId)).length
		);
	}, 0);

	const danglingSourceReferenceCount = sourceAudit.evidence.reduce((count, item) => {
		return count + (sourcesById.has(item.sourceId) ? 0 : 1);
	}, 0);

	const unsupportedMaterialClaimIds = readiness.unsupportedMaterialClaimIds;
	const unsubstantiatedMaterialClaimIds = readiness.unsubstantiatedMaterialClaimIds;
	const unsupportedMaterialClaimEscapeCount =
		finalDecision === 'PASS'
			? unsupportedMaterialClaimIds.length + unsubstantiatedMaterialClaimIds.length
			: 0;

	if (materialAnchorCoverage < 1 && requiredAnchors.length > 0) {
		observations.push('material_anchor_missing');
	}
	if (socialOnlyMaterialSupportCount > 0) {
		observations.push('social_only_material_support');
	} else if (primaryRequirementSatisfactionRate < 1 && primaryRequirements.length > 0) {
		observations.push('primary_source_rule_failed');
	}
	if (danglingEvidenceReferenceCount > 0) {
		observations.push('dangling_evidence_reference');
	}
	if (danglingSourceReferenceCount > 0) {
		observations.push('dangling_source_reference');
	}
	if (unsupportedMaterialClaimEscapeCount > 0) {
		observations.push('unsupported_material_claim_escape');
		failures.push('unsupported_material_claim_escape');
	}

	if (readiness.ready !== evalCase.expected.readinessReady) {
		failures.push('readiness_mismatch');
	}
	if (!setsEqual(unsupportedMaterialClaimIds, evalCase.expected.unsupportedMaterialClaimIds)) {
		failures.push('unsupported_claim_set_mismatch');
	}
	if (
		!setsEqual(unsubstantiatedMaterialClaimIds, evalCase.expected.unsubstantiatedMaterialClaimIds)
	) {
		failures.push('unsubstantiated_claim_set_mismatch');
	}
	if (Math.abs(materialAnchorCoverage - evalCase.expected.materialAnchorCoverage) > 1e-9) {
		failures.push('material_anchor_coverage_mismatch');
	}
	if (
		Math.abs(
			primaryRequirementSatisfactionRate -
				evalCase.expected.primaryRequirementSatisfactionRate,
		) > 1e-9
	) {
		failures.push('primary_requirement_rate_mismatch');
	}
	if (socialOnlyMaterialSupportCount !== evalCase.expected.socialOnlyMaterialSupportCount) {
		failures.push('social_only_support_count_mismatch');
	}
	if (danglingEvidenceReferenceCount !== evalCase.expected.danglingEvidenceReferenceCount) {
		failures.push('dangling_evidence_count_mismatch');
	}
	if (danglingSourceReferenceCount !== evalCase.expected.danglingSourceReferenceCount) {
		failures.push('dangling_source_count_mismatch');
	}
	if (
		unsupportedMaterialClaimEscapeCount !==
		evalCase.expected.unsupportedMaterialClaimEscapeCount
	) {
		failures.push('unsupported_material_claim_escape_count_mismatch');
	}

	if (evalCase.expected.requirementStates) {
		const readinessReport = evaluateEvidenceReadiness(
			buildEvalReadinessBrief(evalCase),
			buildEvalReadinessAudit(evalCase),
			EVAL_READINESS_WINDOW,
		);
		for (const [requirementId, expectedStatus] of Object.entries(
			evalCase.expected.requirementStates,
		)) {
			const actualStatus = readinessReport.requirements.find(
				(item) => item.requirementId === requirementId,
			)?.status;
			if (actualStatus !== expectedStatus) {
				failures.push(
					`requirement_state_mismatch:${requirementId}:${actualStatus ?? 'missing'}!=${expectedStatus}`,
				);
			}
		}
	}

	return {
		passed: failures.length === 0,
		failures,
		observations,
		metrics: {
			materialClaimSupportRate,
			materialAnchorCoverage,
			primaryRequirementSatisfactionRate,
			socialOnlyMaterialSupportCount,
			danglingEvidenceReferenceCount,
			danglingSourceReferenceCount,
			unsupportedMaterialClaimEscapeCount,
		},
	};
}

function setsEqual(left, right) {
	if (left.length !== right.length) return false;
	const leftSet = new Set(left);
	return right.every((item) => leftSet.has(item));
}
