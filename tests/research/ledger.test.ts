import { describe, expect, it } from 'vitest';
import {
	ResearchArtifactLedger,
	reconcileRegionWithLedger,
} from '../../.flue/research/ledger';
import { ArticleRegionResearchResultSchema } from '../../.flue/research/schemas';
import { parse } from 'valibot';
import regionResults from '../fixtures/research/region-results.json';

describe('research artifact ledger', () => {
	it('replaces model-authored provenance and marks unbound facts unsupported', async () => {
		const result = parse(ArticleRegionResearchResultSchema, regionResults[0]);
		const receipt = result.receipts[0];
		const ledger = new ResearchArtifactLedger();

		const artifact = await ledger.recordFetch(
			{
				url: 'https://cbn.gov.ng/documents/circular-2026',
				market: 'nigeria',
				tier: 1,
				mode: 'highlights',
				evidenceQuestion: 'What changed?',
				maxCharacters: 4000,
				phase: 'deep-research',
				briefId: 'brief_1',
				callKey: receipt.callKey,
				attempt: 1,
			},
			{
				url: 'https://cbn.gov.ng/documents/circular-2026',
				finalUrl: 'https://cbn.gov.ng/documents/circular-2026',
				title: 'CBN Circular',
				content: 'The circular changes capital requirements for regulated banks.',
				publishedAt: '2026-07-20T00:00:00Z',
				receipt,
			},
			'2026-07-23T00:00:00Z',
		);

		const reconciled = reconcileRegionWithLedger(
			result,
			ledger,
			result.receipts,
			'deep-research',
		);

		expect(reconciled.sources).toEqual([artifact.source]);
		expect(reconciled.evidence).toEqual([artifact.evidence]);
		expect(reconciled.sources[0].sourceId).not.toBe('src_1');
		expect(reconciled.claims[0]).toMatchObject({
			supportingEvidenceIds: [],
			status: 'unsupported',
		});
	});
});
