import { describe, expect, it } from 'vitest';
import { evaluateEvidenceReadiness } from '../../.flue/research/evidence-readiness';
import type { ArticleResearchBrief, SourceAudit } from '../../.flue/research/schemas';

const window = { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' };

function makeBrief(overrides: Partial<ArticleResearchBrief> = {}): ArticleResearchBrief {
	return {
		briefId: 'brief_1',
		workingTitle: 'Test',
		thesis: 'Thesis',
		signalSummary: 'Summary',
		markets: ['nigeria'],
		verticals: [],
		discoverySourceIds: ['src_1'],
		discoveryEvidenceIds: ['ev_1'],
		decisionRelevance: 'High',
		initialQuestions: [],
		primarySourceTargets: ['cbn.gov.ng'],
		secondarySourceTargets: [],
		exclusions: [],
		evidenceRequirements: [
			{
				requirementId: 'req_1',
				market: 'nigeria',
				question: 'What is the CAR?',
				materiality: 'high',
				sourceRule: 'primary',
				targetDomains: ['cbn.gov.ng'],
				anchors: ['15%'],
				recencyRule: 'none',
			},
		],
		...overrides,
	};
}

function makeAudit(overrides: Partial<SourceAudit> = {}): SourceAudit {
	return {
		briefId: 'brief_1',
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

describe('evaluateEvidenceReadiness', () => {
	it('satisfies a requirement only when all anchors appear in linked evidence', () => {
		const report = evaluateEvidenceReadiness(makeBrief(), makeAudit(), window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('does not accept a valid evidence ID whose excerpt lacks the material number', () => {
		const audit = makeAudit({
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_1',
					text: 'Minimum capital adequacy ratio raised',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
		expect(report.ready).toBe(false);
	});

	it('requires a primary linked source on an allowed target domain', () => {
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceType: 'secondary',
					canonicalUrl: 'https://businessday.ng/story',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
	});

	it('accepts two secondary sources only from different publishers and hosts', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'independent-secondary',
					targetDomains: [],
					anchors: ['15%'],
					recencyRule: 'none',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					sourceId: 'src_1',
					canonicalUrl: 'https://businessday.ng/story',
					title: 'BusinessDay',
					publisher: 'BusinessDay',
					author: null,
					publishedAt: '2026-07-20T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
				{
					sourceId: 'src_2',
					canonicalUrl: 'https://nairametrics.com/story',
					title: 'Nairametrics',
					publisher: 'Nairametrics',
					author: null,
					publishedAt: '2026-07-20T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
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
				{
					evidenceId: 'ev_2',
					sourceId: 'src_2',
					text: 'CAR raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('does not count two URLs from one publisher as independent sources', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'independent-secondary',
					targetDomains: [],
					anchors: ['15%'],
					recencyRule: 'none',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					sourceId: 'src_1',
					canonicalUrl: 'https://businessday.ng/story-a',
					title: 'A',
					publisher: 'BusinessDay',
					author: null,
					publishedAt: '2026-07-20T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
				{
					sourceId: 'src_2',
					canonicalUrl: 'https://businessday.ng/story-b',
					title: 'B',
					publisher: 'BusinessDay',
					author: null,
					publishedAt: '2026-07-20T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
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
				{
					evidenceId: 'ev_2',
					sourceId: 'src_2',
					text: 'CAR raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
	});

	it('blocks a material factual claim with no requirement ID', () => {
		const audit = makeAudit({
			claims: [
				{
					claimId: 'claim_1',
					statement: 'CBN raised CAR to 15%',
					kind: 'fact',
					materiality: 'high',
					requirementIds: [],
					supportingEvidenceIds: ['ev_1'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.unsupportedMaterialClaimIds).toContain('claim_1');
		expect(report.ready).toBe(false);
	});

	it('blocks a material factual claim whose requirement ID does not exist', () => {
		const audit = makeAudit({
			claims: [
				{
					claimId: 'claim_1',
					statement: 'CBN raised CAR to 15%',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_missing'],
					supportingEvidenceIds: ['ev_1'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.unsupportedMaterialClaimIds).toContain('claim_1');
	});

	it('marks a requirement contradicted when linked claims have contradicting evidence', () => {
		const audit = makeAudit({
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_1',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_2',
					sourceId: 'src_1',
					text: 'Minimum capital adequacy ratio remains at 10%',
					supports: [],
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
					contradictingEvidenceIds: ['ev_2'],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.requirements[0]?.status).toBe('contradicted');
		expect(report.requirements[0]?.reasonCodes).toContain('requirement_contradicted');
		expect(report.ready).toBe(false);
	});

	it('blocks social-only evidence for a material fact', () => {
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceType: 'social',
					canonicalUrl: 'https://x.com/post',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.unsupportedMaterialClaimIds).toContain('claim_1');
	});

	it('blocks linked evidence that points at a missing source', () => {
		const audit = makeAudit({
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_1',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_2',
					sourceId: 'src_missing',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.requirements[0]?.status).toBe('missing');
		expect(report.requirements[0]?.reasonCodes).toContain('requirement_missing_source');
		expect(report.ready).toBe(false);
	});

	it('blocks stale evidence for a time-bound requirement', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'source-published-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					publishedAt: '2026-07-10T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
	});

	it('does not accept a fresh unrelated source for a time-bound primary requirement', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'source-published-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceId: 'src_primary',
					publishedAt: '2026-07-10T00:00:00Z',
				},
				{
					sourceId: 'src_social',
					canonicalUrl: 'https://x.com/post',
					title: 'Post',
					publisher: 'X',
					author: null,
					publishedAt: '2026-07-22T12:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 3,
					sourceType: 'social',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
			],
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_primary',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_2',
					sourceId: 'src_social',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
		expect(report.requirements[0]?.reasonCodes).toContain('requirement_outside_window');
	});

	it('accepts fresh independent secondary evidence for a time-bound OR requirement when primary is stale', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'primary-or-two-independent-secondary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'source-published-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceId: 'src_primary',
					publishedAt: '2026-07-10T00:00:00Z',
				},
				{
					sourceId: 'src_secondary_a',
					canonicalUrl: 'https://businessday.ng/story',
					title: 'BusinessDay',
					publisher: 'BusinessDay',
					author: null,
					publishedAt: '2026-07-22T12:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
				{
					sourceId: 'src_secondary_b',
					canonicalUrl: 'https://nairametrics.com/story',
					title: 'Nairametrics',
					publisher: 'Nairametrics',
					author: null,
					publishedAt: '2026-07-22T13:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
			],
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_primary',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_2',
					sourceId: 'src_secondary_a',
					text: 'Minimum capital adequacy ratio raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_3',
					sourceId: 'src_secondary_b',
					text: 'CAR raised to 15%',
					supports: ['claim_1'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('blocks a supported material claim with mixed valid and dangling evidence IDs', () => {
		const audit = makeAudit({
			claims: [
				{
					claimId: 'claim_1',
					statement: 'CBN raised CAR to 15%',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_1'],
					supportingEvidenceIds: ['ev_1', 'ev_missing'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.unsubstantiatedMaterialClaimIds).toContain('claim_1');
		expect(report.ready).toBe(false);
	});

	it('keeps old evidence eligible for a non-time-bound background requirement', () => {
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					publishedAt: '2024-01-01T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(makeBrief(), audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('returns requirements in the same order as the brief', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_a',
					market: 'nigeria',
					question: 'A',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_b',
					market: 'nigeria',
					question: 'B',
					materiality: 'medium',
					sourceRule: 'independent-secondary',
					targetDomains: [],
					anchors: ['ratio'],
					recencyRule: 'none',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, makeAudit(), window);
		expect(report.requirements.map((item) => item.requirementId)).toEqual(['req_a', 'req_b']);
	});

	it('does not mutate its inputs', () => {
		const brief = makeBrief();
		const audit = makeAudit();
		const briefCopy = structuredClone(brief);
		const auditCopy = structuredClone(audit);
		evaluateEvidenceReadiness(brief, audit, window);
		expect(brief).toEqual(briefCopy);
		expect(audit).toEqual(auditCopy);
	});

	it('accepts NDIC primary evidence for an NDIC-targeted requirement', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_ndic',
					market: 'nigeria',
					question: 'Which banks were revoked?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['ndic.gov.ng'],
					anchors: ['revoked'],
					recencyRule: 'none',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					sourceId: 'src_ndic',
					canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
					title: 'NDIC notice',
					publisher: 'NDIC',
					author: null,
					publishedAt: '2026-07-01T00:00:00Z',
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
					evidenceId: 'ev_ndic',
					sourceId: 'src_ndic',
					text: 'NDIC revoked the licences of three banks',
					supports: ['claim_ndic'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
			claims: [
				{
					claimId: 'claim_ndic',
					statement: 'Three banks revoked',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_ndic'],
					supportingEvidenceIds: ['ev_ndic'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('allows older NDIC publication dates when recencyRule is none', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_ndic',
					market: 'nigeria',
					question: 'Which banks were revoked?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['ndic.gov.ng'],
					anchors: ['revoked'],
					recencyRule: 'none',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceId: 'src_ndic',
					canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
					publishedAt: '2026-07-01T00:00:00Z',
				},
			],
			claims: [
				{
					claimId: 'claim_ndic',
					statement: 'Three banks revoked',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_ndic'],
					supportingEvidenceIds: ['ev_1'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_ndic',
					text: 'NDIC revoked the licences of three banks',
					supports: ['claim_ndic'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('rejects stale publications for source-published-in-window requirements', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_1',
					market: 'nigeria',
					question: 'What is the CAR?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['15%'],
					recencyRule: 'source-published-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					publishedAt: '2026-07-10T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
		expect(report.requirements[0]?.reasonCodes).toContain('requirement_outside_window');
	});

	it('accepts event-occurred-in-window when a requirement anchor falls inside the scan window', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_event',
					market: 'nigeria',
					question: 'When was the revocation effective?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['ndic.gov.ng'],
					anchors: ['2026-07-22T12:00:00Z', 'revoked'],
					recencyRule: 'event-occurred-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					sourceId: 'src_ndic',
					canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
					title: 'NDIC notice',
					publisher: 'NDIC',
					author: null,
					publishedAt: '2026-07-01T00:00:00Z',
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
					evidenceId: 'ev_ndic',
					sourceId: 'src_ndic',
					text: 'NDIC revoked the licences of three banks on 2026-07-22T12:00:00Z',
					supports: ['claim_ndic'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
			claims: [
				{
					claimId: 'claim_ndic',
					statement: 'Three banks revoked',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_event'],
					supportingEvidenceIds: ['ev_ndic'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('satisfied');
	});

	it('rejects event-occurred-in-window when no anchor date falls inside the scan window', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_event',
					market: 'nigeria',
					question: 'When was the revocation effective?',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['ndic.gov.ng'],
					anchors: ['revoked'],
					recencyRule: 'event-occurred-in-window',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					...makeAudit().sources[0]!,
					sourceId: 'src_ndic',
					canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
					publishedAt: '2026-07-01T00:00:00Z',
				},
			],
			claims: [
				{
					claimId: 'claim_ndic',
					statement: 'Three banks revoked',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_event'],
					supportingEvidenceIds: ['ev_1'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_ndic',
					text: 'NDIC revoked the licences of three banks',
					supports: ['claim_ndic'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		expect(report.requirements[0]?.status).toBe('weak');
		expect(report.requirements[0]?.reasonCodes).toContain('requirement_outside_window');
	});

	it('scores recapitalisation before-state as one satisfied, three weak, and one missing', () => {
		const brief = makeBrief({
			evidenceRequirements: [
				{
					requirementId: 'req_cbn_minimum_capital',
					market: 'nigeria',
					question: 'CBN minimum capital',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng'],
					anchors: ['₦500 billion'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_ndic_revocations',
					market: 'nigeria',
					question: 'NDIC revocations',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['ndic.gov.ng'],
					anchors: ['revoked'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_sec_issuance',
					market: 'nigeria',
					question: 'SEC issuance',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['sec.gov.ng'],
					anchors: ['rights issue'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_33_compliance',
					market: 'nigeria',
					question: '33 bank compliance',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng', 'ndic.gov.ng'],
					anchors: ['33'],
					recencyRule: 'none',
				},
				{
					requirementId: 'req_37_compliance',
					market: 'nigeria',
					question: '37 bank compliance',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['cbn.gov.ng', 'ndic.gov.ng'],
					anchors: ['37'],
					recencyRule: 'none',
				},
			],
		});
		const audit = makeAudit({
			sources: [
				{
					sourceId: 'src_cbn',
					canonicalUrl: 'https://cbn.gov.ng/documents/recapitalisation-2026',
					title: 'CBN',
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
				{
					sourceId: 'src_ndic',
					canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
					title: 'NDIC',
					publisher: 'NDIC',
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
				{
					sourceId: 'src_sec',
					canonicalUrl: 'https://businessday.ng/sec-rights-issue',
					title: 'BusinessDay',
					publisher: 'BusinessDay',
					author: null,
					publishedAt: '2026-07-22T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 2,
					sourceType: 'secondary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
			],
			evidence: [
				{
					evidenceId: 'ev_cbn',
					sourceId: 'src_cbn',
					text: 'Minimum capital requirement raised to ₦500 billion for international banks',
					supports: ['claim_cbn'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_ndic',
					sourceId: 'src_ndic',
					text: 'NDIC published a notice on bank resolution proceedings',
					supports: ['claim_ndic'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_sec',
					sourceId: 'src_sec',
					text: 'A rights issue programme was reported for recapitalisation',
					supports: ['claim_sec'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
				{
					evidenceId: 'ev_33',
					sourceId: 'src_cbn',
					text: 'Banks raised ₦4.65 trillion in recapitalisation',
					supports: ['claim_33'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
			claims: [
				{
					claimId: 'claim_cbn',
					statement: 'CBN minimum capital',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_cbn_minimum_capital'],
					supportingEvidenceIds: ['ev_cbn'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
				{
					claimId: 'claim_ndic',
					statement: 'NDIC notice',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_ndic_revocations'],
					supportingEvidenceIds: ['ev_ndic'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
				{
					claimId: 'claim_sec',
					statement: 'SEC issuance',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_sec_issuance'],
					supportingEvidenceIds: ['ev_sec'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
				{
					claimId: 'claim_33',
					statement: '33 bank compliance',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_33_compliance'],
					supportingEvidenceIds: ['ev_33'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		});
		const report = evaluateEvidenceReadiness(brief, audit, window);
		const byStatus = Object.groupBy(report.requirements, (item) => item.status);
		expect(byStatus.satisfied).toHaveLength(1);
		expect(byStatus.weak).toHaveLength(3);
		expect(byStatus.missing).toHaveLength(1);
		expect(byStatus.missing?.[0]?.requirementId).toBe('req_37_compliance');
	});
});
