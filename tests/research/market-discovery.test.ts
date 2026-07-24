import { describe, expect, it, vi } from 'vitest';
import type { FlueHarness } from '@flue/runtime';
import { createFlueResearchDelegator } from '../../.flue/research/delegation';
import { createResearchRuntime } from '../../.flue/research/runtime';
import { ResearchArtifactLedger } from '../../.flue/research/ledger';
import {
	FOUNDATION_MARKETS,
	type AgentExecutionRecord,
	type DiscoveryRunRequest,
	type Market,
	type MarketDiscoveryResult,
} from '../../.flue/research/schemas';
import {
	discoveryResearchers,
	discoveryResearcherProfiles,
} from '../../.flue/agents/profiles/discovery-orchestrator';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';

const request: DiscoveryRunRequest = {
	runKey: 'market-discovery',
	trigger: 'manual',
	window: {
		start: '2026-07-22T00:00:00Z',
		end: '2026-07-23T00:00:00Z',
	},
	focus: null,
	maxDiscoveredBriefs: 2,
	maxAcceptedBriefs: 1,
	maxProviderCostUsd: 1,
	maxProviderRequests: 30,
};

function marketResult(market: Market): MarketDiscoveryResult {
	return {
		runKey: request.runKey,
		market,
		coverage: {
			market,
			searchesPerformed: 2,
			signalsFound: 0,
			sourceIds: [],
			status: 'no-signals',
		},
		receipts: [],
		sources: [],
		evidence: [],
		briefs: [],
	};
}

describe('market-isolated discovery', () => {
	it('registers one discovery profile for each foundation market', () => {
		expect(FOUNDATION_MARKETS).toEqual(['nigeria', 'ghana']);
		expect(discoveryResearcherProfiles.map((profile) => profile.name)).toEqual([
			'discovery_nigeria',
			'discovery_ghana',
		]);
		expect(discoveryResearchers.nigeria.name).toBe('discovery_nigeria');
		expect(discoveryResearchers.ghana.name).toBe('discovery_ghana');
	});

	it('runs independent market tasks and merges their results', async () => {
		const task = vi.fn(async (_input: string, options: { agent?: string }) => {
			const market = options.agent === 'discovery_nigeria' ? 'nigeria' : 'ghana';
			return {
				data: marketResult(market),
				usage: {
					input: 100,
					output: 20,
					cost: { total: 0.001 },
				},
				model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
			};
		});
		const session = vi.fn(async (name: string) => ({ name, task }));
		const harness = { session } as unknown as FlueHarness;
		const runtime = createResearchRuntime(request, { EXA_API_KEY: 'test-key' });
		const delegator = createFlueResearchDelegator(
			harness,
			{
				discovery: {
					nigeria: 'discovery_nigeria',
					ghana: 'discovery_ghana',
				},
				briefValidator: 'brief_validator',
				regionResearchers: {
					nigeria: 'research_nigeria',
					kenya: 'research_kenya',
					ghana: 'research_ghana',
					'south-africa': 'research_south_africa',
					egypt: 'research_egypt',
				},
				structuralAnalyst: 'structural_analyst',
				researchReviewer: 'research_reviewer',
			},
			{
				runtime,
				input: request,
				articleBudgets: new Map(),
				ledger: new ResearchArtifactLedger(),
				executionRecords: [] as AgentExecutionRecord[],
			},
		);

		const portfolio = await delegator.discover(request);

		expect(session).toHaveBeenCalledWith('discovery:nigeria');
		expect(session).toHaveBeenCalledWith('discovery:ghana');
		expect(task).toHaveBeenCalledTimes(2);
		for (const [taskInput] of task.mock.calls) {
			expect(JSON.parse(taskInput).maxDiscoveredBriefs).toBe(1);
		}
		const resultSchema = task.mock.calls[0]?.[1]?.result as {
			entries?: Record<string, unknown>;
			pipe?: Array<{ entries?: Record<string, unknown> }>;
		};
		const resultFields = Object.keys(
			resultSchema.entries ?? resultSchema.pipe?.[0]?.entries ?? {},
		);
		expect(resultFields).not.toContain('receipts');
		expect(resultFields).not.toContain('sources');
		expect(resultFields).not.toContain('evidence');
		expect(portfolio.coverage.map((coverage) => coverage.market)).toEqual([
			'nigeria',
			'ghana',
		]);
	});

	it('creates independent discovery budget trackers for each market', () => {
		const runtime = createResearchRuntime(request, { EXA_API_KEY: 'test-key' });

		expect(runtime.discoveryBudgets.nigeria).toBeDefined();
		expect(runtime.discoveryBudgets.ghana).toBeDefined();
		expect(runtime.discoveryBudgets.nigeria).not.toBe(runtime.discoveryBudgets.ghana);
		expect(
			runtime.discoveryBudgets.nigeria!.remainingUsd +
				runtime.discoveryBudgets.ghana!.remainingUsd +
				runtime.discoveryBudget.remainingUsd,
		).toBeCloseTo(0.25, 6);
	});

	it('preserves a completed market when another market fails provenance reconciliation', async () => {
		const task = vi.fn(async (_input: string, options: { agent?: string }) => {
			if (options.agent === 'discovery_nigeria') {
				return {
					data: marketResult('nigeria'),
					usage: { input: 100, output: 20, cost: { total: 0.001 } },
					model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
				};
			}
			const nigeriaBrief = discoveryPortfolioFixture.briefs[0];
			return {
				data: {
					runKey: request.runKey,
					market: 'ghana',
					coverage: {
						market: 'ghana',
						searchesPerformed: 2,
						signalsFound: 1,
						sourceIds: ['src_unrecorded'],
						status: 'covered',
					},
					briefs: [
						{
							...nigeriaBrief,
							briefId: 'brief_ghana_unrecorded',
							markets: ['ghana'],
							discoverySourceIds: ['src_unrecorded'],
							discoveryEvidenceIds: ['ev_unrecorded'],
							evidenceRequirements: nigeriaBrief.evidenceRequirements.map(
								(requirement) => ({ ...requirement, market: 'ghana' }),
							),
						},
					],
				},
				usage: { input: 100, output: 20, cost: { total: 0.001 } },
				model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
			};
		});
		const harness = {
			session: vi.fn(async (name: string) => ({ name, task })),
		} as unknown as FlueHarness;
		const runtime = createResearchRuntime(request, { EXA_API_KEY: 'test-key' });
		const delegator = createFlueResearchDelegator(
			harness,
			{
				discovery: {
					nigeria: 'discovery_nigeria',
					ghana: 'discovery_ghana',
				},
				briefValidator: 'brief_validator',
				regionResearchers: {
					nigeria: 'research_nigeria',
					kenya: 'research_kenya',
					ghana: 'research_ghana',
					'south-africa': 'research_south_africa',
					egypt: 'research_egypt',
				},
				structuralAnalyst: 'structural_analyst',
				researchReviewer: 'research_reviewer',
			},
			{
				runtime,
				input: request,
				articleBudgets: new Map(),
				ledger: new ResearchArtifactLedger(),
				executionRecords: [],
			},
		);

		const portfolio = await delegator.discover(request);

		expect(portfolio.coverage).toEqual([
			expect.objectContaining({ market: 'nigeria', status: 'no-signals' }),
			expect.objectContaining({ market: 'ghana', status: 'failed' }),
		]);
		expect(portfolio.briefs).toEqual([]);
	});
});
