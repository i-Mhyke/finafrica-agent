import { describe, expect, it } from 'vitest';
import {
	classifySource,
	getAllowedDomains,
	getTier1Domains,
	MANDATORY_MARKETS,
	MARKET_POLICIES,
	VERTICALS,
} from '../../.flue/research/market-policy';

describe('market policy', () => {
	it('contains all five supported market policies', () => {
		expect(MANDATORY_MARKETS).toHaveLength(5);
		expect(MANDATORY_MARKETS).toEqual(
			expect.arrayContaining(['nigeria', 'kenya', 'ghana', 'south-africa', 'egypt']),
		);
		for (const market of MANDATORY_MARKETS) {
			expect(MARKET_POLICIES[market]).toBeDefined();
		}
		expect(VERTICALS.length).toBeGreaterThanOrEqual(10);
	});

	it('keeps Tier 1 regulator and exchange domains market-specific', () => {
		const nigeriaTier1 = getTier1Domains('nigeria');
		const kenyaTier1 = getTier1Domains('kenya');
		expect(nigeriaTier1).toContain('cbn.gov.ng');
		expect(nigeriaTier1).toContain('ndic.gov.ng');
		expect(nigeriaTier1).toContain('sec.gov.ng');
		expect(nigeriaTier1).not.toContain('centralbank.go.ke');
		expect(kenyaTier1).toContain('centralbank.go.ke');
		expect(kenyaTier1).not.toContain('cbn.gov.ng');
	});

	it('does not classify PR-wire domains as primary evidence', () => {
		const result = classifySource('https://www.prnewswire.com/news/test', 'nigeria');
		expect(result.isPrWire).toBe(true);
		expect(result.sourceType).not.toBe('primary');
		expect(result.tier).not.toBe(1);
	});

	it('allows a cross-border source without relabeling its market', () => {
		const result = classifySource('https://www.imf.org/en/Countries/NGA', 'nigeria');
		expect(result.tier).toBe(1);
		expect(result.sourceType).toBe('primary');
		// Market is assigned by caller context, not by classifySource
		expect(MARKET_POLICIES.nigeria.market).toBe('nigeria');
	});
});
