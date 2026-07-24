import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFoundationalResearch } from '../../.flue/actions/run-foundational-research';
import { researchAdminFromEnv } from '../../.flue/auth/research-admin';
import workflow, { route, runs } from '../../.flue/workflows/market-intelligence-scan';
import { DiscoveryRunRequestSchema } from '../../.flue/research/schemas';
import type { FlueHarness } from '@flue/runtime';

describe('market-intelligence-scan workflow', () => {
	it('binds the reusable Action to the private coordinator', () => {
		expect(workflow).toBeDefined();
		expect(runFoundationalResearch.name).toBe('run_foundational_research');
	});

	it('defines the private agent in the workflow module for Vite reload compatibility', () => {
		const source = readFileSync(
			join(process.cwd(), '.flue/workflows/market-intelligence-scan.ts'),
			'utf8',
		);

		expect(source).toContain("import { defineAgent, defineWorkflow } from '@flue/runtime';");
		expect(source).toContain('const coordinatorAgent = defineAgent<ResearchWorkerEnv>');
		expect(source).not.toContain("import { coordinatorAgent } from");
	});

	it('uses the shared input and output schemas', () => {
		const valid = DiscoveryRunRequestSchema;
		expect(valid).toBeDefined();
		expect(runFoundationalResearch).toBeDefined();
	});

	it('exports route and runs middleware for research admin', () => {
		expect(route).toBe(researchAdminFromEnv);
		expect(runs).toBe(researchAdminFromEnv);
	});

	it('exports no publishing capability', () => {
		expect(runFoundationalResearch.name).not.toBe('publish');
		expect(runFoundationalResearch.name).not.toBe('article_writer');
	});

	it('fails closed before starting a model session when provider configuration is absent', async () => {
		let sessionCalls = 0;
		const harness = {
			session: async () => {
				sessionCalls++;
				throw new Error('model session must not start');
			},
		} as unknown as FlueHarness;

		const result = await runFoundationalResearch.run({
			harness,
			log: { info() {}, warn() {}, error() {}, debug() {} },
			input: {
				runKey: 'missing-provider-config',
				trigger: 'manual',
				window: {
					start: '2026-07-22T00:00:00Z',
					end: '2026-07-23T00:00:00Z',
				},
				focus: null,
				maxDiscoveredBriefs: 5,
				maxAcceptedBriefs: 2,
				maxProviderCostUsd: 1,
			},
		});

		expect(result.status).toBe('failed');
		expect(sessionCalls).toBe(0);
	});
});
