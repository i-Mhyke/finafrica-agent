import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
	regionFinishSchemaForBrief,
	regionHasClaimLinkage,
	shouldSkipRemediation,
} from '../../.flue/research/region-guards';
import { evaluateEvidenceReadiness } from '../../.flue/research/evidence-readiness';
import { auditArticleResearch } from '../../.flue/research/audit';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';
import regionResultsFixture from '../fixtures/research/region-results.json';
import type { ArticleRegionResearchResult } from '../../.flue/research/schemas';

describe('region guards', () => {
	const brief = discoveryPortfolioFixture.briefs[0];
	const window = { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' };

	it('accepts linked claims for material requirements', () => {
		const result = regionResultsFixture[0] as ArticleRegionResearchResult;
		expect(regionHasClaimLinkage(brief, result)).toBe(true);
		expect(
			v.safeParse(regionFinishSchemaForBrief(brief, 'nigeria'), result).success,
		).toBe(true);
	});

	it('rejects evidence without claim linkage at finish', () => {
		const unlinked = {
			...(regionResultsFixture[0] as ArticleRegionResearchResult),
			claims: [],
		};
		expect(regionHasClaimLinkage(brief, unlinked)).toBe(false);
		expect(
			v.safeParse(regionFinishSchemaForBrief(brief, 'nigeria'), unlinked).success,
		).toBe(false);
	});

	it('skips remediation when every blocked requirement lacks claims', async () => {
		const regionResult = {
			...(regionResultsFixture[0] as ArticleRegionResearchResult),
			claims: [],
		};
		const sourceAudit = await auditArticleResearch(brief, [regionResult]);
		const readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);
		expect(readiness.ready).toBe(false);
		expect(shouldSkipRemediation(readiness, sourceAudit)).toBe(true);
	});

	it('does not skip remediation when claims exist but evidence is weak', async () => {
		const weak = {
			...(regionResultsFixture[0] as ArticleRegionResearchResult),
			evidence: [
				{
					...(regionResultsFixture[0] as ArticleRegionResearchResult).evidence[0],
					text: 'Minimum capital adequacy ratio raised',
				},
			],
		};
		const sourceAudit = await auditArticleResearch(brief, [weak]);
		const readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);
		expect(readiness.ready).toBe(false);
		expect(shouldSkipRemediation(readiness, sourceAudit)).toBe(false);
	});
});
