import { describe, expect, it } from 'vitest';
import { reconcileReviewWithEvidence } from '../../.flue/research/review';
import type {
	EvidenceReadinessReport,
	ReviewReport,
	SourceAudit,
	StructuralPacket,
} from '../../.flue/research/schemas';
import reviewerPassFixture from '../fixtures/research/reviewer-pass.json';

function makePacket(overrides: Partial<StructuralPacket> = {}): StructuralPacket {
	return {
		briefId: 'brief_accept',
		packetVersion: 'v1',
		facts: ['CBN raised CAR to 15%'],
		editorsQuestions: Array.from({ length: 10 }, (_, i) => ({
			question: `Question ${i + 1}?`,
			answer: 'Answer',
			gap: null,
		})),
		dependencyGraph: {
			primaryActors: ['CBN'],
			adjacentActors: ['Banks'],
			infrastructure: [],
			regulators: ['CBN'],
			customers: [],
			capitalMarkets: [],
		},
		analysisLayers: {
			layer1WhatChanged: 'CAR raised',
			layer2IsNew: 'Yes',
			layer3WhoLoses: 'Undercapitalized banks',
			layer4PricingPower: 'Large banks',
			layer5StackCollapse: 'None',
			layer6InstitutionalPower: 'CBN',
			layer7WhatBecomesPossible: 'Consolidation',
		},
		storyOptions: [
			{ title: 'A', angle: 'Regulation', audience: 'Analysts' },
			{ title: 'B', angle: 'Impact', audience: 'Bankers' },
			{ title: 'C', angle: 'Timeline', audience: 'Compliance' },
		],
		recommendedLede: 'CBN raises CAR',
		whyItMatters: 'Capital pressure',
		howItChangesThings: 'Higher buffers required',
		actorActionability: [{ actor: 'Banks', action: 'Submit compliance plan' }],
		missingFacts: [],
		supportingSourceIds: ['src_1'],
		supportingEvidenceIds: ['ev_1'],
		...overrides,
	};
}

function makeAudit(overrides: Partial<SourceAudit> = {}): SourceAudit {
	return {
		briefId: 'brief_accept',
		sources: [
			{
				sourceId: 'src_1',
				canonicalUrl: 'https://cbn.gov.ng/documents/circular-2026',
				title: 'CBN Circular',
				publisher: 'CBN',
				author: null,
				publishedAt: '2026-07-20T00:00:00Z',
				retrievedAt: '2026-07-23T00:00:00Z',
				market: 'nigeria',
				tier: 1,
				sourceType: 'primary',
				receiptIds: [],
				contentHash: null,
				rightsNote: null,
			},
		],
		evidence: [
			{
				evidenceId: 'ev_1',
				sourceId: 'src_1',
				text: 'Minimum capital adequacy ratio raised to 15%',
				supports: ['claim_1'],
				capturedAt: '2026-07-23T00:00:00Z',
			},
		],
		claims: [
			{
				claimId: 'claim_1',
				statement: 'CBN raised CAR to 15%',
				kind: 'fact',
				materiality: 'high',
				requirementIds: ['req_1'],
				supportingEvidenceIds: ['ev_1'],
				contradictingEvidenceIds: [],
				status: 'supported',
			},
		],
		gaps: [],
		duplicateSourceIds: [],
		staleSourceIds: [],
		...overrides,
	};
}

function makeReadiness(overrides: Partial<EvidenceReadinessReport> = {}): EvidenceReadinessReport {
	return {
		briefId: 'brief_accept',
		ready: true,
		requirements: [],
		unsupportedMaterialClaimIds: [],
		unsubstantiatedMaterialClaimIds: [],
		blockingReasonCodes: [],
		...overrides,
	};
}

describe('reconcileReviewWithEvidence', () => {
	it('blocks PASS when readiness is not ready', () => {
		const review = reviewerPassFixture as ReviewReport;
		const reconciled = reconcileReviewWithEvidence(
			review,
			makePacket(),
			makeAudit(),
			makeReadiness({
				ready: false,
				blockingReasonCodes: ['requirement_missing_anchor', 'requirement_weak_source'],
			}),
		);

		expect(reconciled.decision).toBe('NEEDS_MORE_RESEARCH');
		expect(reconciled.missingItems).toEqual(
			expect.arrayContaining([
				'Deterministic evidence readiness blocked PASS',
				'requirement_missing_anchor',
				'requirement_weak_source',
			]),
		);
		expect(reconciled.reasons).not.toContain('Deterministic evidence readiness blocked PASS');
	});

	it('preserves REJECT even when readiness is not ready', () => {
		const review = {
			...(reviewerPassFixture as ReviewReport),
			decision: 'REJECT' as const,
			reasons: ['Libel risk'],
		};
		const reconciled = reconcileReviewWithEvidence(
			review,
			makePacket(),
			makeAudit(),
			makeReadiness({ ready: false, blockingReasonCodes: ['requirement_weak_source'] }),
		);

		expect(reconciled.decision).toBe('REJECT');
		expect(reconciled.reasons).toEqual(['Libel risk']);
	});

	it('allows PASS when readiness is ready and evidence audit passes', () => {
		const review = reviewerPassFixture as ReviewReport;
		const reconciled = reconcileReviewWithEvidence(
			review,
			makePacket(),
			makeAudit(),
			makeReadiness({ ready: true }),
		);

		expect(reconciled.decision).toBe('PASS');
	});
});
