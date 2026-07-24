import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { buildCanaryRequest, resolveOutputPath, runCanary, sanitizeOutput } from '../../../scripts/research-canary.mjs';

describe('research canary cli', () => {
	it('exits before fetch when --live is absent', () => {
		const outFile = join(mkdtempSync(join(tmpdir(), 'research-canary-')), 'result.json');
		const result = spawnSync(
			process.execPath,
			[
				'scripts/research-canary.mjs',
				'--run-key',
				'canary-1',
				'--window-start',
				'2026-07-22T00:00:00Z',
				'--window-end',
				'2026-07-23T00:00:00Z',
				'--out',
				outFile,
			],
			{
				cwd: process.cwd(),
				encoding: 'utf8',
			},
		);
		expect(result.status).toBe(2);
	});

	it('posts the fixed capped body when live', async () => {
		const outDir = mkdtempSync(join(tmpdir(), 'research-canary-live-'));
		const outFile = join(outDir, 'result.json');
		let capturedUrl = '';
		let capturedBody: Record<string, unknown> | null = null;

		const exitCode = await runCanary(
			{
				live: true,
				runKey: 'canary-live-1',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				out: outFile,
				baseUrl: 'http://fake.local',
			},
			{
				rootDir: '/',
				fetchImpl: async (url, init) => {
					capturedUrl = String(url);
					capturedBody = JSON.parse(String(init?.body));
					return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
				},
			},
		);

		expect(exitCode).toBe(0);
		expect(capturedUrl).toBe(
			'http://fake.local/workflows/market-intelligence-scan?wait=true',
		);
		expect(capturedBody).toEqual(buildCanaryRequest({
			runKey: 'canary-live-1',
			windowStart: '2026-07-22T00:00:00Z',
			windowEnd: '2026-07-23T00:00:00Z',
		}));
		expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({ status: 'ok' });
	});

	it('saves invalid-response on malformed JSON', async () => {
		const outDir = mkdtempSync(join(tmpdir(), 'research-canary-invalid-'));
		const outFile = join(outDir, 'result.json');

		const exitCode = await runCanary(
			{
				live: true,
				runKey: 'canary-invalid',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				out: outFile,
				baseUrl: 'http://fake.local',
			},
			{
				rootDir: '/',
				fetchImpl: async () => new Response('not-json', { status: 200 }),
			},
		);

		expect(exitCode).toBe(1);
		expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({
			status: 'invalid-response',
		});
	});

	it('redacts secret object keys recursively', () => {
		const sanitized = sanitizeOutput({
			headers: {
				'x-api-key': 'super-secret-key',
				authorization: 'Bearer abc.def.ghi',
			},
			access_token: 'oauth-secret',
		});

		expect(sanitized).toEqual({
			headers: {
				'x-api-key': '[REDACTED]',
				authorization: '[REDACTED]',
			},
			access_token: '[REDACTED]',
		});
	});

	it('preserves token usage metrics required for promotion checks', () => {
		const sanitized = sanitizeOutput({
			tokenUsage: {
				inputTokens: 176_557,
				outputTokens: 59_593,
			},
			efficiency: {
				llm: {
					inputTokens: 100,
					outputTokens: 25,
				},
			},
		});

		expect(sanitized).toEqual({
			tokenUsage: {
				inputTokens: 176_557,
				outputTokens: 59_593,
			},
			efficiency: {
				llm: {
					inputTokens: 100,
					outputTokens: 25,
				},
			},
		});
	});

	it('writes absolute output paths without rebasing under rootDir', async () => {
		const outDir = mkdtempSync(join(tmpdir(), 'research-canary-abs-'));
		const outFile = join(outDir, 'nested', 'result.json');

		const exitCode = await runCanary(
			{
				live: true,
				runKey: 'canary-abs',
				windowStart: '2026-07-22T00:00:00Z',
				windowEnd: '2026-07-23T00:00:00Z',
				out: outFile,
				baseUrl: 'http://fake.local',
			},
			{
				rootDir: process.cwd(),
				fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
			},
		);

		expect(exitCode).toBe(0);
		expect(resolveOutputPath(process.cwd(), outFile)).toBe(outFile);
		expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({ status: 'ok' });
	});
});
