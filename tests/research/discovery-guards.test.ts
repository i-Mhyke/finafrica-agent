import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { discoveryFinishSchemaForLedger } from '../../.flue/research/discovery-guards';
import { ResearchArtifactLedger } from '../../.flue/research/ledger';
import type {
	ArticleResearchBrief,
	ProviderCallReceipt,
} from '../../.flue/research/schemas';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';
import regionResultsFixture from '../fixtures/research/region-results.json';

describe('discovery finish guards', () => {
	it('accepts only source and evidence IDs retained by successful fetches', async () => {
		const ledger = new ResearchArtifactLedger();
		const receipt = {
			...regionResultsFixture[0].receipts[0],
			receiptId: 'receipt_discovery',
			phase: 'discovery',
			briefId: null,
			market: 'nigeria',
			operation: 'fetch',
		} as ProviderCallReceipt;
		const artifact = await ledger.recordFetch(
			{
				url: 'https://ndic.gov.ng/notice',
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'discovery',
				briefId: null,
				callKey: receipt.callKey,
				attempt: 1,
			},
			{
				url: 'https://ndic.gov.ng/notice',
				finalUrl: 'https://ndic.gov.ng/notice',
				title: 'NDIC notice',
				content: 'NDIC published an attributable market notice.',
				publishedAt: '2026-07-22T00:00:00Z',
				receipt,
			},
			'2026-07-23T00:00:00Z',
		);
		const baseBrief = discoveryPortfolioFixture.briefs[0] as ArticleResearchBrief;
		const linkedBrief = {
			...baseBrief,
			discoverySourceIds: [artifact.source.sourceId],
			discoveryEvidenceIds: [artifact.evidence.evidenceId],
		};
		const schema = discoveryFinishSchemaForLedger(
			'discovery-guard',
			'nigeria',
			ledger,
		);
		const baseResult = {
			runKey: 'discovery-guard',
			market: 'nigeria',
			coverage: {
				market: 'nigeria',
				searchesPerformed: 2,
				signalsFound: 1,
				sourceIds: [artifact.source.sourceId],
				status: 'covered',
			},
			briefs: [linkedBrief],
		};

		expect(v.safeParse(schema, baseResult).success).toBe(true);
		expect(
			v.safeParse(schema, {
				...baseResult,
				briefs: [
					{
						...linkedBrief,
						discoveryEvidenceIds: ['ev_unrecorded'],
					},
				],
			}).success,
		).toBe(false);
	});
});
