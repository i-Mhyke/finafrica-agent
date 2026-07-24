import type {
	ArticleResearchBrief,
	DiscoveryRunRequest,
	EvidenceExcerpt,
	EvidenceRequirement,
	EvidenceReadinessReport,
	SourceAudit,
	SourceRecord,
} from './schemas';
import { evidenceContainsAnchor } from './evidence-anchor-matcher.mjs';

function normalizeHost(value: string): string {
	try {
		const host = new URL(value).hostname.toLowerCase();
		return host.startsWith('www.') ? host.slice(4) : host;
	} catch {
		const stripped = value.toLowerCase().replace(/^www\./, '');
		return stripped.split('/')[0] ?? stripped;
	}
}

function normalizePublisherLabel(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizedPublisher(source: SourceRecord): string {
	if (source.publisher) {
		return normalizePublisherLabel(source.publisher);
	}
	return normalizeHost(source.canonicalUrl);
}

function hostMatchesTargetDomain(canonicalUrl: string, targetDomains: string[]): boolean {
	const host = normalizeHost(canonicalUrl);
	return targetDomains.some(
		(domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
	);
}

function evidenceForRequirement(
	requirementId: string,
	sourceAudit: SourceAudit,
): EvidenceExcerpt[] {
	const claimIds = new Set(
		sourceAudit.claims
			.filter((claim) => claim.requirementIds.includes(requirementId))
			.map((claim) => claim.claimId),
	);
	const evidenceIds = new Set<string>();
	for (const claim of sourceAudit.claims) {
		if (!claim.requirementIds.includes(requirementId)) continue;
		for (const id of claim.supportingEvidenceIds) {
			evidenceIds.add(id);
		}
	}
	return sourceAudit.evidence.filter(
		(excerpt) =>
			evidenceIds.has(excerpt.evidenceId) ||
			excerpt.supports.some((claimId) => claimIds.has(claimId)),
	);
}

function linkedSourcesForEvidence(
	evidence: EvidenceExcerpt[],
	sourceAudit: SourceAudit,
): SourceRecord[] {
	const sourceIds = new Set(evidence.map((item) => item.sourceId));
	return sourceAudit.sources.filter((source) => sourceIds.has(source.sourceId));
}

function evidenceWithMissingSources(
	evidence: EvidenceExcerpt[],
	sourceAudit: SourceAudit,
): EvidenceExcerpt[] {
	const retainedSourceIds = new Set(sourceAudit.sources.map((source) => source.sourceId));
	return evidence.filter((item) => !retainedSourceIds.has(item.sourceId));
}

function primarySourcesOnTarget(
	requirement: EvidenceRequirement,
	sources: SourceRecord[],
): SourceRecord[] {
	return sources.filter(
		(source) =>
			source.sourceType === 'primary' &&
			hostMatchesTargetDomain(source.canonicalUrl, requirement.targetDomains),
	);
}

function independentSecondarySources(sources: SourceRecord[]): SourceRecord[] {
	const secondarySources = sources.filter((source) => source.sourceType === 'secondary');
	if (secondarySources.length < 2) return [];
	const publishers = new Set(secondarySources.map((source) => normalizedPublisher(source)));
	const hosts = new Set(secondarySources.map((source) => normalizeHost(source.canonicalUrl)));
	if (publishers.size < 2 || hosts.size < 2) return [];
	return secondarySources;
}

function hasIndependentSecondary(sources: SourceRecord[]): boolean {
	return independentSecondarySources(sources).length >= 2;
}

function qualifyingSourcesForRule(
	requirement: EvidenceRequirement,
	sources: SourceRecord[],
): SourceRecord[] {
	const primaryOnTarget = primarySourcesOnTarget(requirement, sources);
	const independentSecondary = independentSecondarySources(sources);

	switch (requirement.sourceRule) {
		case 'primary':
			return primaryOnTarget;
		case 'independent-secondary':
			return independentSecondary;
		case 'primary-or-two-independent-secondary': {
			const bySourceId = new Map<string, SourceRecord>();
			for (const source of [...primaryOnTarget, ...independentSecondary]) {
				bySourceId.set(source.sourceId, source);
			}
			return [...bySourceId.values()];
		}
	}
}

function hasContradictingEvidence(
	requirementId: string,
	sourceAudit: SourceAudit,
): boolean {
	return sourceAudit.claims
		.filter((claim) => claim.requirementIds.includes(requirementId))
		.some((claim) =>
			claim.contradictingEvidenceIds.some((id) =>
				sourceAudit.evidence.some((excerpt) => excerpt.evidenceId === id),
			),
		);
}

function sourceRuleSatisfied(
	requirement: EvidenceRequirement,
	sources: SourceRecord[],
): boolean {
	if (sources.length === 0) return false;

	const primaryOnTarget = primarySourcesOnTarget(requirement, sources).length > 0;
	const independentSecondary = hasIndependentSecondary(sources);

	switch (requirement.sourceRule) {
		case 'primary':
			return primaryOnTarget;
		case 'independent-secondary':
			return independentSecondary;
		case 'primary-or-two-independent-secondary':
			return primaryOnTarget || independentSecondary;
	}
}

function publishedWithinWindow(
	source: SourceRecord,
	window: DiscoveryRunRequest['window'],
): boolean {
	if (!source.publishedAt) return false;
	const published = Date.parse(source.publishedAt);
	const start = Date.parse(window.start);
	const end = Date.parse(window.end);
	return published >= start && published <= end;
}

function evaluateRequirement(
	requirement: EvidenceRequirement,
	sourceAudit: SourceAudit,
	window: DiscoveryRunRequest['window'],
): EvidenceReadinessReport['requirements'][number] {
	const reasonCodes: string[] = [];
	const linkedClaims = sourceAudit.claims.filter((claim) =>
		claim.requirementIds.includes(requirement.requirementId),
	);

	if (hasContradictingEvidence(requirement.requirementId, sourceAudit)) {
		reasonCodes.push('requirement_contradicted');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'contradicted',
			sourceIds: [],
			evidenceIds: [],
			missingAnchors: [],
			reasonCodes,
		};
	}

	if (linkedClaims.length === 0) {
		reasonCodes.push('requirement_no_claim');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'missing',
			sourceIds: [],
			evidenceIds: [],
			missingAnchors: requirement.anchors,
			reasonCodes,
		};
	}

	const evidence = evidenceForRequirement(requirement.requirementId, sourceAudit);
	if (evidence.length === 0) {
		reasonCodes.push('requirement_no_evidence');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'missing',
			sourceIds: [],
			evidenceIds: [],
			missingAnchors: requirement.anchors,
			reasonCodes,
		};
	}

	const sources = linkedSourcesForEvidence(evidence, sourceAudit);
	const danglingEvidence = evidenceWithMissingSources(evidence, sourceAudit);
	if (sources.length === 0 || danglingEvidence.length > 0) {
		reasonCodes.push('requirement_missing_source');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'missing',
			sourceIds: sources.map((source) => source.sourceId),
			evidenceIds: evidence.map((item) => item.evidenceId),
			missingAnchors: requirement.anchors,
			reasonCodes,
		};
	}

	const missingAnchors = requirement.anchors.filter(
		(anchor) => !evidence.some((excerpt) => evidenceContainsAnchor(excerpt.text, anchor)),
	);
	if (missingAnchors.length > 0) {
		reasonCodes.push('requirement_anchor_missing');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'weak',
			sourceIds: sources.map((source) => source.sourceId),
			evidenceIds: evidence.map((item) => item.evidenceId),
			missingAnchors,
			reasonCodes,
		};
	}

	if (!sourceRuleSatisfied(requirement, sources)) {
		reasonCodes.push('requirement_source_rule_failed');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'weak',
			sourceIds: sources.map((source) => source.sourceId),
			evidenceIds: evidence.map((item) => item.evidenceId),
			missingAnchors: [],
			reasonCodes,
		};
	}

	const qualifyingSources = qualifyingSourcesForRule(requirement, sources);
	if (
		requirement.recencyRule === 'source-published-in-window' &&
		!qualifyingSources.some((source) => publishedWithinWindow(source, window))
	) {
		reasonCodes.push('requirement_outside_window');
		return {
			requirementId: requirement.requirementId,
			market: requirement.market,
			status: 'weak',
			sourceIds: sources.map((source) => source.sourceId),
			evidenceIds: evidence.map((item) => item.evidenceId),
			missingAnchors: [],
			reasonCodes,
		};
	}

	if (requirement.recencyRule === 'event-occurred-in-window') {
		const start = Date.parse(window.start);
		const end = Date.parse(window.end);
		const eventInWindow = requirement.anchors.some((anchor) => {
			const parsed = Date.parse(anchor);
			return !Number.isNaN(parsed) && parsed >= start && parsed <= end;
		});
		if (!eventInWindow) {
			reasonCodes.push('requirement_outside_window');
			return {
				requirementId: requirement.requirementId,
				market: requirement.market,
				status: 'weak',
				sourceIds: sources.map((source) => source.sourceId),
				evidenceIds: evidence.map((item) => item.evidenceId),
				missingAnchors: [],
				reasonCodes,
			};
		}
	}

	return {
		requirementId: requirement.requirementId,
		market: requirement.market,
		status: 'satisfied',
		sourceIds: sources.map((source) => source.sourceId),
		evidenceIds: evidence.map((item) => item.evidenceId),
		missingAnchors: [],
		reasonCodes,
	};
}

function evaluateClaims(
	brief: ArticleResearchBrief,
	sourceAudit: SourceAudit,
): {
	unsupportedMaterialClaimIds: string[];
	unsubstantiatedMaterialClaimIds: string[];
	reasonCodes: string[];
} {
	const requirementIds = new Set(
		brief.evidenceRequirements.map((item) => item.requirementId),
	);
	const unsupportedMaterialClaimIds: string[] = [];
	const unsubstantiatedMaterialClaimIds: string[] = [];
	const reasonCodes: string[] = [];

	for (const claim of sourceAudit.claims) {
		if (claim.kind !== 'fact' || claim.materiality === 'low') continue;

		if (claim.requirementIds.length === 0) {
			unsupportedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_missing_requirement');
			continue;
		}

		if (claim.requirementIds.some((id) => !requirementIds.has(id))) {
			unsupportedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_unknown_requirement');
			continue;
		}

		if (claim.status !== 'supported') {
			unsupportedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_not_supported');
			continue;
		}

		if (claim.supportingEvidenceIds.length === 0) {
			unsubstantiatedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_evidence_unsubstantiated');
			continue;
		}

		const evidenceById = new Map(
			sourceAudit.evidence.map((excerpt) => [excerpt.evidenceId, excerpt]),
		);
		const retainedSourceIds = new Set(sourceAudit.sources.map((source) => source.sourceId));
		const hasDanglingEvidence = claim.supportingEvidenceIds.some((evidenceId) => {
			const excerpt = evidenceById.get(evidenceId);
			return !excerpt || !retainedSourceIds.has(excerpt.sourceId);
		});
		if (hasDanglingEvidence) {
			unsubstantiatedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_evidence_unsubstantiated');
			continue;
		}

		const supportingSources = claim.supportingEvidenceIds
			.map((id) => evidenceById.get(id))
			.filter(Boolean)
			.map((excerpt) => sourceAudit.sources.find((source) => source.sourceId === excerpt!.sourceId))
			.filter(Boolean);

		if (
			supportingSources.length > 0 &&
			supportingSources.every((source) => source!.sourceType === 'social')
		) {
			unsupportedMaterialClaimIds.push(claim.claimId);
			reasonCodes.push('claim_social_only');
		}
	}

	return {
		unsupportedMaterialClaimIds,
		unsubstantiatedMaterialClaimIds,
		reasonCodes,
	};
}

export function evaluateEvidenceReadiness(
	brief: ArticleResearchBrief,
	sourceAudit: SourceAudit,
	window: DiscoveryRunRequest['window'],
): EvidenceReadinessReport {
	const requirements = brief.evidenceRequirements.map((requirement) =>
		evaluateRequirement(requirement, sourceAudit, window),
	);
	const claimEvaluation = evaluateClaims(brief, sourceAudit);

	const blockingReasonCodes = [
		...requirements.flatMap((item) => item.reasonCodes),
		...claimEvaluation.reasonCodes,
	];

	const highRequirementsSatisfied = requirements
		.filter((item) =>
			brief.evidenceRequirements.find(
				(req) => req.requirementId === item.requirementId && req.materiality === 'high',
			),
		)
		.every((item) => item.status === 'satisfied');

	const materialClaimsSupported = sourceAudit.claims
		.filter((claim) => claim.kind === 'fact' && claim.materiality !== 'low')
		.every((claim) => claim.status === 'supported');

	const ready =
		highRequirementsSatisfied &&
		materialClaimsSupported &&
		claimEvaluation.unsupportedMaterialClaimIds.length === 0 &&
		claimEvaluation.unsubstantiatedMaterialClaimIds.length === 0;

	return {
		briefId: brief.briefId,
		ready,
		requirements,
		unsupportedMaterialClaimIds: claimEvaluation.unsupportedMaterialClaimIds,
		unsubstantiatedMaterialClaimIds: claimEvaluation.unsubstantiatedMaterialClaimIds,
		blockingReasonCodes: [...new Set(blockingReasonCodes)],
	};
}
