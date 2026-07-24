import { describe, expect, it } from 'vitest';
import { buildRemediationBriefs } from '../../.flue/research/remediation';
import type { ArticleResearchBrief, EvidenceReadinessReport, SourceAudit } from '../../.flue/research/schemas';

const brief: ArticleResearchBrief = {
	briefId: 'brief_1',
	workingTitle: 'Test',
	thesis: 'Thesis',
	signalSummary: 'Summary',
	markets: ['nigeria', 'ghana'],
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
			requirementId: 'req_ng',
			market: 'nigeria',
			question: 'Nigeria question',
			materiality: 'high',
			sourceRule: 'primary',
			targetDomains: ['ndic.gov.ng'],
			anchors: ['15%'],
			recencyRule: 'none',
		},
		{
			requirementId: 'req_gh',
			market: 'ghana',
			question: 'Ghana question',
			materiality: 'high',
			sourceRule: 'primary',
			targetDomains: ['bog.gov.gh'],
			anchors: ['10%'],
			recencyRule: 'none',
		},
	],
};

const sourceAudit: SourceAudit = {
	briefId: 'brief_1',
	sources: [
		{
			sourceId: 'src_ndic',
			canonicalUrl: 'https://ndic.gov.ng/notices/revocation-2026',
			title: 'NDIC notice',
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
			sourceId: 'src_visit',
			canonicalUrl: 'https://businessday.ng/management-visit',
			title: 'Visit',
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
		{
			sourceId: 'src_gh',
			canonicalUrl: 'https://bog.gov.gh/circular',
			title: 'BoG',
			publisher: 'BoG',
			author: null,
			publishedAt: '2026-07-20T00:00:00Z',
			retrievedAt: '2026-07-23T00:00:00Z',
			market: 'ghana',
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
			text: 'Minimum capital adequacy ratio raised to 14%',
			supports: ['claim_ng'],
			capturedAt: '2026-07-23T00:00:00Z',
		},
	],
	claims: [
		{
			claimId: 'claim_ng',
			statement: 'NDIC notice',
			kind: 'fact',
			materiality: 'high',
			requirementIds: ['req_ng'],
			supportingEvidenceIds: ['ev_ndic'],
			contradictingEvidenceIds: [],
			status: 'supported',
		},
	],
	gaps: [],
	duplicateSourceIds: [],
	staleSourceIds: [],
};

function readiness(overrides: Partial<EvidenceReadinessReport> = {}): EvidenceReadinessReport {
	return {
		briefId: 'brief_1',
		ready: false,
		requirements: [
			{
				requirementId: 'req_ng',
				market: 'nigeria',
				status: 'weak',
				sourceIds: ['src_ndic'],
				evidenceIds: ['ev_ndic'],
				missingAnchors: ['15%'],
				reasonCodes: ['requirement_anchor_missing'],
			},
			{
				requirementId: 'req_gh',
				market: 'ghana',
				status: 'missing',
				sourceIds: [],
				evidenceIds: [],
				missingAnchors: ['10%'],
				reasonCodes: ['requirement_no_evidence'],
			},
		],
		unsupportedMaterialClaimIds: [],
		unsubstantiatedMaterialClaimIds: [],
		blockingReasonCodes: ['requirement_anchor_missing'],
		...overrides,
	};
}

describe('buildRemediationBriefs', () => {
	it('returns no remediation brief when readiness passes', () => {
		expect(
			buildRemediationBriefs(
				brief,
				sourceAudit,
				readiness({ ready: true, requirements: [], blockingReasonCodes: [] }),
			),
		).toEqual([]);
	});

	it('groups failed requirements by market with per-requirement contracts', () => {
		const briefs = buildRemediationBriefs(brief, sourceAudit, readiness());
		expect(briefs).toHaveLength(2);
		expect(briefs[0]?.market).toBe('nigeria');
		expect(briefs[1]?.market).toBe('ghana');
		expect(briefs[0]?.requirements[0]).toMatchObject({
			requirementId: 'req_ng',
			targetDomains: ['ndic.gov.ng'],
			reasonCodes: ['requirement_anchor_missing'],
			refetchUrls: ['https://ndic.gov.ng/notices/revocation-2026'],
		});
		expect(briefs[1]?.requirements[0]?.requirementId).toBe('req_gh');
	});

	it('excludes unlinked context sources but keeps refetch URLs on linked sources', () => {
		const briefs = buildRemediationBriefs(brief, sourceAudit, readiness());
		expect(briefs[0]?.excludedUrls).toContain('https://businessday.ng/management-visit');
		expect(briefs[0]?.excludedUrls).not.toContain(
			'https://ndic.gov.ng/notices/revocation-2026',
		);
	});

	it('sets remediation limits to six searches and ten fetches', () => {
		const briefs = buildRemediationBriefs(brief, sourceAudit, readiness());
		expect(briefs[0]?.maxSearches).toBe(6);
		expect(briefs[0]?.maxFetches).toBe(10);
	});

	it('keeps refetch URLs for linked sources that failed the primary source rule', () => {
		const secWeakAudit: SourceAudit = {
			...sourceAudit,
			sources: [
				...sourceAudit.sources,
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
				...sourceAudit.evidence,
				{
					evidenceId: 'ev_sec',
					sourceId: 'src_sec',
					text: 'A rights issue programme was reported',
					supports: ['claim_sec'],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
			claims: [
				...sourceAudit.claims,
				{
					claimId: 'claim_sec',
					statement: 'SEC issuance',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_sec'],
					supportingEvidenceIds: ['ev_sec'],
					contradictingEvidenceIds: [],
					status: 'supported',
				},
			],
		};
		const secBrief: ArticleResearchBrief = {
			...brief,
			evidenceRequirements: [
				...brief.evidenceRequirements,
				{
					requirementId: 'req_sec',
					market: 'nigeria',
					question: 'SEC issuance',
					materiality: 'high',
					sourceRule: 'primary',
					targetDomains: ['sec.gov.ng'],
					anchors: ['rights issue'],
					recencyRule: 'none',
				},
			],
		};
		const briefs = buildRemediationBriefs(
			secBrief,
			secWeakAudit,
			readiness({
				requirements: [
					{
						requirementId: 'req_ng',
						market: 'nigeria',
						status: 'weak',
						sourceIds: ['src_ndic'],
						evidenceIds: ['ev_ndic'],
						missingAnchors: ['15%'],
						reasonCodes: ['requirement_anchor_missing'],
					},
					{
						requirementId: 'req_sec',
						market: 'nigeria',
						status: 'weak',
						sourceIds: ['src_sec'],
						evidenceIds: ['ev_sec'],
						missingAnchors: [],
						reasonCodes: ['requirement_source_rule_failed'],
					},
					{
						requirementId: 'req_gh',
						market: 'ghana',
						status: 'missing',
						sourceIds: [],
						evidenceIds: [],
						missingAnchors: ['10%'],
						reasonCodes: ['requirement_no_evidence'],
					},
				],
			}),
		);
		const secRequirement = briefs[0]?.requirements.find(
			(item) => item.requirementId === 'req_sec',
		);
		expect(secRequirement?.refetchUrls).toEqual([]);
	});
});
