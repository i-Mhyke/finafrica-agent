import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('research eval cli', () => {
	it('completes offline without network access', () => {
		const outDir = mkdtempSync(join(process.cwd(), 'tmp-research-eval-cli-'));
		const fetchBlocker = join(outDir, 'block-fetch.mjs');
		writeFileSync(
			fetchBlocker,
			'globalThis.fetch = () => { throw new Error("network calls are forbidden in offline eval"); };',
		);

		try {
			const result = spawnSync(
				process.execPath,
				[
					`--import=${fetchBlocker}`,
					'scripts/research-eval.mjs',
					'run',
					'--suite',
					'evals/research/cases/suite.json',
					'--out',
					outDir,
				],
				{
					cwd: process.cwd(),
					env: {
						...process.env,
						EXA_API_KEY: '',
						APIFY_API_TOKEN: '',
					},
					encoding: 'utf8',
				},
			);

			expect(result.status).toBe(0);
			const report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as {
				passed: boolean;
				cases: Array<{ caseId: string }>;
			};
			expect(report.passed).toBe(true);
			expect(report.cases).toHaveLength(10);
			expect(readFileSync(join(outDir, 'manifest.json'), 'utf8')).toContain('evaluatorVersion');
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});

	it('exits 2 for unknown flags', () => {
		const result = spawnSync(process.execPath, ['scripts/research-eval.mjs', 'run', '--nope'], {
			cwd: process.cwd(),
			encoding: 'utf8',
		});
		expect(result.status).toBe(2);
	});
});
