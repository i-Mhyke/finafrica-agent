import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateEfficiencyCase } from '../../../evals/research/efficiency-evaluator.mjs';
import { parseEvalCase } from '../../../evals/research/schema.mjs';

const casesDir = join(process.cwd(), 'evals/research/cases');

describe('efficiency evaluator', () => {
	it('passes the known smoke-run audit within configured limits', () => {
		const evalCase = parseEvalCase(
			JSON.parse(readFileSync(join(casesDir, 'efficiency-known-run.json'), 'utf8')),
		);
		const result = evaluateEfficiencyCase(evalCase);
		expect(result.passed).toBe(true);
		expect(result.metrics.providerAttemptCount).toBe(25);
		expect(result.metrics.providerFailureCount).toBe(0);
		expect(result.metrics.maxStructuralAnalysisCallsPerArticle).toBe(1);
		expect(result.metrics.maxResearchReviewCallsPerArticle).toBe(1);
	});
});
