import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('provider benchmark command', () => {
	it('loads local provider credentials from the Worker development vars file', () => {
		const packageJson = JSON.parse(
			readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
		) as { scripts: Record<string, string> };

		expect(packageJson.scripts['eval:research-provider']).toContain(
			'--env-file-if-exists=.dev.vars',
		);
	});

	it('uses labeled market sources rather than placeholder URLs', () => {
		const discovery = JSON.parse(
			readFileSync(
				join(process.cwd(), 'tests/fixtures/research/provider-benchmark.json'),
				'utf8',
			),
		) as Array<{
			expectedPrimaryDomains: string[];
			acceptableSecondaryDomains: string[];
		}>;
		const extraction = JSON.parse(
			readFileSync(
				join(process.cwd(), 'tests/fixtures/research/extraction-benchmark.json'),
				'utf8',
			),
		) as Array<{ url: string }>;

		expect(discovery).toHaveLength(25);
		expect(
			discovery.every(
				(item) =>
					item.expectedPrimaryDomains.length > 0 &&
					item.acceptableSecondaryDomains.length > 0,
			),
		).toBe(true);
		expect(extraction).toHaveLength(20);
		expect(extraction.every((item) => !item.url.includes('example.com'))).toBe(true);
	});

	it('fails the promotion gate when required live metrics are unmeasured', () => {
		const reportsDir = mkdtempSync(join(tmpdir(), 'research-provider-benchmark-'));
		const result = spawnSync(process.execPath, ['scripts/benchmark-research-provider.mjs'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				EXA_API_KEY: '',
				APIFY_API_TOKEN: '',
				BENCHMARK_REPORTS_DIR: reportsDir,
			},
			encoding: 'utf8',
		});

		expect(result.status).toBe(1);
		const report = JSON.parse(
			readFileSync(join(reportsDir, 'research-provider-baseline.json'), 'utf8'),
		) as {
			discoveryCases: number;
			extractionCases: number;
			promotionPassed: boolean;
		};
		expect(report.discoveryCases).toBe(25);
		expect(report.extractionCases).toBe(20);
		expect(report.promotionPassed).toBe(false);
	});
});
