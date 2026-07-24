import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compareReports, runSuite } from '../../../evals/research/runner.mjs';

const suitePath = join(process.cwd(), 'evals/research/cases/suite.json');

describe('research eval runner', () => {
	it('runs the offline suite and passes all cases', () => {
		const report = runSuite({
			suitePath,
			generatedAt: '2026-07-23T00:00:00.000Z',
		});
		expect(report.cases).toHaveLength(10);
		expect(report.passed).toBe(true);
		expect(report.hardGateFailures).toEqual([]);
	});

	it('compares baseline and candidate reports', () => {
		const baseline = runSuite({
			suitePath,
			generatedAt: '2026-07-23T00:00:00.000Z',
		});
		const candidate = structuredClone(baseline);
		candidate.cases[0].passed = false;
		candidate.passed = false;
		const comparison = compareReports(baseline, candidate);
		expect(comparison.regressions).toEqual(['discovery-market-clean']);
	});

	it('rejects comparison when evaluator versions differ', () => {
		const baseline = runSuite({
			suitePath,
			generatedAt: '2026-07-23T00:00:00.000Z',
		});
		const candidate = structuredClone(baseline);
		candidate.evaluatorVersion = 2;
		expect(() => compareReports(baseline, candidate)).toThrow('evaluatorVersion mismatch');
	});
});

describe('research eval runner fixtures', () => {
	it('loads the suite manifest order', () => {
		const suite = JSON.parse(readFileSync(suitePath, 'utf8')) as { cases: string[] };
		expect(suite.cases[0]).toBe('discovery-market-clean.json');
		expect(suite.cases.at(-1)).toBe('recapitalisation-evidence-corrected.json');
	});
});
