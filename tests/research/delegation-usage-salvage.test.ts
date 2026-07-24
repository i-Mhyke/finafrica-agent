import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlueHarness, FlueObservation } from '@flue/runtime';

const observers: Array<(observation: FlueObservation) => void> = [];

vi.mock('@flue/runtime', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@flue/runtime')>();
	return {
		...actual,
		observe: (subscriber: (observation: FlueObservation) => void) => {
			observers.push(subscriber);
			return () => {
				const index = observers.indexOf(subscriber);
				if (index >= 0) observers.splice(index, 1);
			};
		},
	};
});

import { buildBriefValidationInput } from '../../.flue/research/brief-validation-input';
import { createFlueResearchDelegator } from '../../.flue/research/delegation';
import { ResearchArtifactLedger } from '../../.flue/research/ledger';
import { createResearchRuntime } from '../../.flue/research/runtime';
import type {
	AgentExecutionRecord,
	DiscoveryPortfolio,
	DiscoveryRunRequest,
} from '../../.flue/research/schemas';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';

const portfolio = discoveryPortfolioFixture as DiscoveryPortfolio;

const input: DiscoveryRunRequest = {
	runKey: 'usage-salvage-run',
	trigger: 'manual',
	window: {
		start: '2026-07-22T00:00:00Z',
		end: '2026-07-23T00:00:00Z',
	},
	focus: null,
	maxDiscoveredBriefs: 5,
	maxAcceptedBriefs: 2,
	maxProviderCostUsd: 1,
};

function emitObservation(observation: FlueObservation): void {
	for (const observer of [...observers]) {
		observer(observation);
	}
}

describe('delegation usage salvage', () => {
	beforeEach(() => {
		observers.length = 0;
	});

	it('salvages observed turn usage when timeout errors carry no usage payload', async () => {
		const usage = { input: 9458, output: 120, cost: { total: 0.0062 } };
		const task = vi.fn(async () => {
			emitObservation({
				type: 'turn',
				session: 'task:brief-validator:brief_accept:task-1',
				turnId: 'turn_1',
				purpose: 'agent',
				durationMs: 10,
				request: {} as never,
				response: { usage },
				isError: false,
				v: 3,
				eventIndex: 1,
				timestamp: '2026-07-24T00:00:00.000Z',
			});
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const executionRecords: AgentExecutionRecord[] = [];
		const delegator = createFlueResearchDelegator(
			harness,
			{
				discovery: {
					nigeria: 'discovery_nigeria',
					ghana: 'discovery_ghana',
				},
				briefValidator: 'brief_validator',
				briefRefiner: 'brief_refiner',
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
				runtime: createResearchRuntime(input, { EXA_API_KEY: 'test-key' }),
				input,
				articleBudgets: new Map(),
				ledger: new ResearchArtifactLedger(),
				executionRecords,
			},
		);

		await expect(
			delegator.validateBrief(buildBriefValidationInput(portfolio.briefs[0], portfolio)),
		).rejects.toThrow('timeout');
		expect(executionRecords[0]).toEqual(
			expect.objectContaining({
				status: 'failed',
				tokenUsage: { input: 9458, output: 120 },
				costUsd: 0.0062,
			}),
		);
	});
});
