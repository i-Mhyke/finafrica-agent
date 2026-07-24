import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateReviewCase } from '../../../evals/research/review-evaluator.mjs';
import { parseEvalCase } from '../../../evals/research/schema.mjs';

const casesDir = join(process.cwd(), 'evals/research/cases');

describe('review evaluator', () => {
	it('blocks publication when readiness is false but review passes', () => {
		const evalCase = parseEvalCase(
			JSON.parse(readFileSync(join(casesDir, 'review-false-pass.json'), 'utf8')),
		);
		const result = evaluateReviewCase(evalCase);
		expect(result.passed).toBe(true);
		expect(result.observations).toContain('review_pass_with_readiness_blocked');
		expect(result.metrics.publicationEligible).toBe(0);
	});
});
