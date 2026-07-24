import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseEvalCase, parseEvalSuite } from '../../../evals/research/schema.mjs';

const casesDir = join(process.cwd(), 'evals/research/cases');

describe('research eval cases', () => {
	it('parses exactly ten unique cases from the suite manifest', () => {
		const suite = parseEvalSuite(
			JSON.parse(readFileSync(join(casesDir, 'suite.json'), 'utf8')),
		);
		expect(suite.cases).toHaveLength(10);
		const ids = new Set<string>();
		for (const caseFile of suite.cases) {
			const evalCase = parseEvalCase(
				JSON.parse(readFileSync(join(casesDir, caseFile), 'utf8')),
			);
			ids.add(evalCase.caseId);
		}
		expect(ids.size).toBe(10);
	});

	it('contains only json case files referenced by the suite', () => {
		const suite = parseEvalSuite(
			JSON.parse(readFileSync(join(casesDir, 'suite.json'), 'utf8')),
		);
		const files = readdirSync(casesDir).filter((file) => file.endsWith('.json'));
		expect(files.sort()).toEqual(['suite.json', ...suite.cases].sort());
	});
});
