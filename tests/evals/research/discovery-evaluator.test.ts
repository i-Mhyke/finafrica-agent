import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateDiscoveryCase } from '../../../evals/research/discovery-evaluator.mjs';
import { parseEvalCase } from '../../../evals/research/schema.mjs';

const casesDir = join(process.cwd(), 'evals/research/cases');

function loadCase(fileName: string) {
	return parseEvalCase(JSON.parse(readFileSync(join(casesDir, fileName), 'utf8')));
}

describe('discovery evaluator', () => {
	it('passes the clean Nigeria control', () => {
		const result = evaluateDiscoveryCase(loadCase('discovery-market-clean.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual([]);
	});

	it('detects cross-market contamination in the negative control', () => {
		const result = evaluateDiscoveryCase(loadCase('discovery-cross-market.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual(['cross_market_contamination']);
		expect(result.metrics.crossMarketContaminationCount).toBe(1);
	});
});
