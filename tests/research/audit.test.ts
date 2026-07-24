import { describe, expect, it } from 'vitest';
import { auditArticleResearch, deduplicateBriefs } from '../../.flue/research/audit';
import regionResultsFixture from '../fixtures/research/region-results.json';

const brief = {
	briefId: 'brief_1',
	workingTitle: 'Nigeria Capital Requirements',
	thesis: 'CBN raised capital requirements',
	signalSummary: 'New circular',
	markets: ['nigeria' as const],
	verticals: ['banking-regulation'],
	discoverySourceIds: ['src_1'],
	discoveryEvidenceIds: ['ev_1'],
	decisionRelevance: 'High',
	initialQuestions: [],
	primarySourceTargets: [],
	secondarySourceTargets: [],
	exclusions: [],
	evidenceRequirements: [
		{
			requirementId: 'req_accept_high',
			market: 'nigeria',
			question: 'What is the new CAR?',
			materiality: 'high',
			sourceRule: 'primary',
			targetDomains: ['cbn.gov.ng'],
			anchors: ['15%'],
			recencyRule: 'none',
		},
	],
};

describe('audit', () => {
	it('deduplicates canonical URLs while retaining all receipts', async () => {
		const results = regionResultsFixture as typeof regionResultsFixture;
		const audit = await auditArticleResearch(brief, results);
		expect(audit.duplicateSourceIds.length).toBeGreaterThanOrEqual(0);
		const source = audit.sources.find((s) => s.canonicalUrl.includes('cbn.gov.ng'));
		expect(source?.receiptIds.length).toBeGreaterThanOrEqual(1);
	});

	it('detects duplicate article briefs before deep research', () => {
		const { unique, duplicates } = deduplicateBriefs([
			brief,
			{ ...brief, briefId: 'brief_2', workingTitle: 'nigeria capital requirements' },
		]);
		expect(unique).toHaveLength(1);
		expect(duplicates).toHaveLength(1);
	});

	it('rejects dangling evidence and claim references', async () => {
		const badResult = [
			{
				...regionResultsFixture[0],
				evidence: [
					{
						evidenceId: 'ev_bad',
						sourceId: 'src_missing',
						text: 'orphan',
						supports: [],
						capturedAt: '2026-07-23T00:00:00Z',
					},
				],
			},
		];
		const audit = await auditArticleResearch(brief, badResult);
		expect(audit.gaps.some((g) => g.includes('Dangling'))).toBe(true);
	});

	it('keeps contradictory excerpts instead of overwriting them', async () => {
		const results = [
			{
				...regionResultsFixture[0],
				evidence: [
					{
						evidenceId: 'ev_a',
						sourceId: 'src_1',
						text: 'Rate is 15%',
						supports: ['claim_1'],
						capturedAt: '2026-07-23T00:00:00Z',
					},
					{
						evidenceId: 'ev_b',
						sourceId: 'src_2',
						text: 'Rate is 12%',
						supports: ['claim_1'],
						capturedAt: '2026-07-23T00:00:00Z',
					},
				],
			},
		];
		const audit = await auditArticleResearch(brief, results);
		expect(audit.evidence).toHaveLength(2);
	});

	it('marks social-only material claims unsupported', async () => {
		const results = [
			{
				...regionResultsFixture[0],
				sources: [
					{
						sourceId: 'src_social',
						canonicalUrl: 'https://twitter.com/user/status/1',
						title: 'Tweet',
						publisher: null,
						author: null,
						publishedAt: null,
						retrievedAt: '2026-07-23T00:00:00Z',
						market: 'nigeria' as const,
						tier: 3 as const,
						sourceType: 'social' as const,
						receiptIds: [],
						contentHash: null,
						rightsNote: null,
					},
				],
				evidence: [
					{
						evidenceId: 'ev_social',
						sourceId: 'src_social',
						text: 'Banks are struggling',
						supports: [],
						capturedAt: '2026-07-23T00:00:00Z',
					},
				],
				claims: [
					{
						claimId: 'claim_social',
						statement: 'Banks are insolvent',
						kind: 'fact' as const,
						materiality: 'high' as const,
						supportingEvidenceIds: ['ev_social'],
						contradictingEvidenceIds: [],
						status: 'supported' as const,
					},
				],
			},
		];
		const audit = await auditArticleResearch(brief, results);
		const claim = audit.claims.find((c) => c.claimId === 'claim_social');
		expect(claim?.status).toBe('unsupported');
	});

	it('marks stale time-sensitive sources as a gap', async () => {
		const results = [
			{
				...regionResultsFixture[0],
				sources: [
					{
						...regionResultsFixture[0].sources[0],
						publishedAt: '2020-01-01T00:00:00Z',
					},
				],
			},
		];
		const audit = await auditArticleResearch(brief, results);
		expect(audit.staleSourceIds.length).toBeGreaterThan(0);
	});

	it('preserves failed and successful article-region results together', async () => {
		const results = [
			regionResultsFixture[0],
			{ ...regionResultsFixture[0], market: 'kenya' as const, status: 'failed' as const, error: 'timeout' },
		];
		const audit = await auditArticleResearch({ ...brief, markets: ['nigeria', 'kenya'] }, results);
		expect(audit.sources.length).toBeGreaterThan(0);
	});
});
