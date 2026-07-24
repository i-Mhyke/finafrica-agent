import { describe, expect, it, vi } from 'vitest';
import type { FlueHarness } from '@flue/runtime';
import { createFlueResearchDelegator } from '../../.flue/research/delegation';
import { buildBriefValidationInput } from '../../.flue/research/brief-validation-input';
import {
	createResearchAuditEmitter,
	RESEARCH_AUDIT_LOG_MESSAGE,
} from '../../.flue/research/run-audit';
import { ResearchArtifactLedger } from '../../.flue/research/ledger';
import { createResearchRuntime } from '../../.flue/research/runtime';
import type {
	AgentExecutionRecord,
	ArticleResearchBrief,
	DiscoveryPortfolio,
	DiscoveryRunRequest,
} from '../../.flue/research/schemas';
import { BRIEF_VALIDATION_TASK_TIMEOUT_MS } from '../../.flue/research/schemas';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';
import briefValidationsFixture from '../fixtures/research/brief-validations.json';
import regionResultsFixture from '../fixtures/research/region-results.json';

const portfolio = discoveryPortfolioFixture as DiscoveryPortfolio;

function validationInput(brief: ArticleResearchBrief = portfolio.briefs[0]) {
	return buildBriefValidationInput(brief, portfolio);
}

const input: DiscoveryRunRequest = {
	runKey: 'execution-record-run',
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

describe('Flue research delegation audit', () => {
	it('uses the dedicated refiner profile without research tools', async () => {
		const task = vi.fn().mockResolvedValue({
			data: discoveryPortfolioFixture.briefs[0],
			usage: {
				input: 120,
				output: 30,
				cost: { total: 0.002 },
			},
			model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-refiner:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
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
		});

		await delegator.refineBrief(
			discoveryPortfolioFixture.briefs[0],
			briefValidationsFixture.brief_refine,
		);

		expect(task).toHaveBeenCalledOnce();
		expect(task.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				agent: 'brief_refiner',
				result: expect.anything(),
				signal: expect.any(AbortSignal),
			}),
		);
		expect(task.mock.calls[0]?.[1]).not.toHaveProperty('tools');
	});

	it('rejects a brief without a market before opening an agent session', async () => {
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: {
				input: 120,
				output: 30,
				cost: { total: 0.002 },
			},
			model: { provider: 'opencode-go', id: 'kimi-k2.6' },
		});
		const session = vi.fn().mockResolvedValue({
			name: 'brief-validator:brief_accept',
			task,
		});
		const harness = { session } as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
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
		});
		const malformedBrief = {
			...discoveryPortfolioFixture.briefs[0],
			markets: [],
		} as unknown as ArticleResearchBrief;

		await expect(
			delegator.validateBrief({ brief: malformedBrief, sources: [], evidence: [] }),
		).rejects.toThrow(/Invalid length|must include at least one market/);
		expect(session).not.toHaveBeenCalled();
		expect(task).not.toHaveBeenCalled();
	});

	it('records model, token, prompt, schema and skill versions for every task', async () => {
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: {
				input: 120,
				output: 30,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: {
					input: 0.001,
					output: 0.001,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0.002,
				},
			},
			model: { provider: 'opencode-go', id: 'kimi-k3' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const executionRecords: AgentExecutionRecord[] = [];
		const bindings = {
			runtime: createResearchRuntime(input, { EXA_API_KEY: 'test-key' }),
			input,
			articleBudgets: new Map(),
			ledger: new ResearchArtifactLedger(),
			executionRecords,
		};
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
			bindings,
		);

		await delegator.validateBrief(validationInput());

		expect(executionRecords).toHaveLength(1);
		expect(executionRecords[0]).toEqual(
			expect.objectContaining({
				runKey: input.runKey,
				briefId: 'brief_accept',
				agent: 'brief_validator',
				modelId: 'opencode-go/kimi-k3',
				promptVersion: expect.any(String),
				schemaVersion: expect.any(String),
				skillVersions: expect.objectContaining({
					'validate-research-briefs': expect.any(String),
				}),
				tokenUsage: { input: 120, output: 30 },
				status: 'succeeded',
			}),
		);
	});

	it('passes retained discovery sources and evidence to the validator', async () => {
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: { input: 1, output: 1, cost: { total: 0 } },
			model: { provider: 'opencode-go', id: 'kimi-k3' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});

		await delegator.validateBrief(validationInput());
		const payload = JSON.parse(String(task.mock.calls[0]?.[0]));
		expect(payload.brief.briefId).toBe('brief_accept');
		expect(payload.sources.length).toBeGreaterThan(0);
		expect(payload.evidence.length).toBeGreaterThan(0);
		expect(payload.evidence[0]?.text).toEqual(expect.any(String));
	});

	it('uses the configured validator task timeout', async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: { input: 1, output: 1, cost: { total: 0 } },
			model: { provider: 'opencode-go', id: 'kimi-k3' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});

		await delegator.validateBrief(validationInput());
		expect(timeoutSpy).toHaveBeenCalledWith(BRIEF_VALIDATION_TASK_TIMEOUT_MS);
		timeoutSpy.mockRestore();
	});

	it('records salvaged token usage when a delegated task fails with partial usage', async () => {
		const usage = { input: 9458, output: 120, cost: { total: 0.0062 } };
		const timeoutError = Object.assign(
			new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
			{ usage },
		);
		const task = vi.fn().mockRejectedValue(timeoutError);
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const executionRecords: AgentExecutionRecord[] = [];
		const bindings = {
			runtime: createResearchRuntime(input, { EXA_API_KEY: 'test-key' }),
			input,
			articleBudgets: new Map(),
			ledger: new ResearchArtifactLedger(),
			executionRecords,
		};
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
			bindings,
		);

		await expect(delegator.validateBrief(validationInput())).rejects.toThrow('timeout');
		expect(executionRecords[0]).toEqual(
			expect.objectContaining({
				status: 'failed',
				tokenUsage: { input: 9458, output: 120 },
				costUsd: 0.0062,
			}),
		);
	});

	it('filters validator input to linked discovery sources and evidence only', async () => {
		const extendedPortfolio = {
			...portfolio,
			sources: [
				...portfolio.sources,
				{
					sourceId: 'src_unlinked',
					canonicalUrl: 'https://cbn.gov.ng/documents/unrelated',
					title: 'Unrelated',
					publisher: 'CBN',
					author: null,
					publishedAt: '2026-07-20T00:00:00Z',
					retrievedAt: '2026-07-23T00:00:00Z',
					market: 'nigeria',
					tier: 1,
					sourceType: 'primary',
					receiptIds: [],
					contentHash: null,
					rightsNote: null,
				},
			],
			evidence: [
				...portfolio.evidence,
				{
					evidenceId: 'ev_unlinked',
					sourceId: 'src_unlinked',
					text: 'Unrelated evidence',
					supports: [],
					capturedAt: '2026-07-23T00:00:00Z',
				},
			],
		} as typeof portfolio;
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: { input: 1, output: 1, cost: { total: 0 } },
			model: { provider: 'opencode-go', id: 'kimi-k3' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});

		await delegator.validateBrief(
			buildBriefValidationInput(portfolio.briefs[0], extendedPortfolio),
		);
		const payload = JSON.parse(String(task.mock.calls[0]?.[0]));
		expect(payload.sources.map((source: { sourceId: string }) => source.sourceId)).toEqual([
			'src_1',
		]);
		expect(payload.evidence.map((item: { evidenceId: string }) => item.evidenceId)).toEqual([
			'ev_1',
		]);
	});

	it('emits paired agent-task audit stages for delegated work', async () => {
		const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
		const audit = createResearchAuditEmitter(log as never, input.runKey, () => '2026-07-23T10:00:00.000Z');
		const task = vi.fn().mockResolvedValue({
			data: briefValidationsFixture.brief_accept,
			usage: {
				input: 120,
				output: 30,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: {
					input: 0.001,
					output: 0.001,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0.002,
				},
			},
			model: { provider: 'opencode-go', id: 'kimi-k3' },
		});
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const bindings = {
			runtime: createResearchRuntime(input, { EXA_API_KEY: 'test-key' }, audit),
			input,
			articleBudgets: new Map(),
			ledger: new ResearchArtifactLedger(),
			executionRecords: [] as AgentExecutionRecord[],
			audit,
		};
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
			bindings,
		);

		await delegator.validateBrief(validationInput());

		const events = [...log.info.mock.calls, ...log.warn.mock.calls]
			.filter(([message]) => message === RESEARCH_AUDIT_LOG_MESSAGE)
			.map(([, attrs]) => attrs as Record<string, unknown>);
		expect(events.some((event) => event.auditEvent === 'stage_started')).toBe(true);
		expect(events.some((event) => event.auditEvent === 'stage_completed')).toBe(true);
		expect(events[0]?.stageId).toContain('agent-task:');
	});

	it('records the assigned model when a delegated task fails before returning usage', async () => {
		const task = vi.fn().mockRejectedValue(
			new Error('prompt failed: Stream ended without finish_reason'),
		);
		const harness = {
			session: vi.fn().mockResolvedValue({
				name: 'brief-validator:brief_accept',
				task,
			}),
		} as unknown as FlueHarness;
		const executionRecords: AgentExecutionRecord[] = [];
		const bindings = {
			runtime: createResearchRuntime(input, { EXA_API_KEY: 'test-key' }),
			input,
			articleBudgets: new Map(),
			ledger: new ResearchArtifactLedger(),
			executionRecords,
		};
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
			bindings,
		);

		await expect(
			delegator.validateBrief(validationInput()),
		).rejects.toThrow('Stream ended without finish_reason');

		expect(executionRecords[0]).toEqual(
			expect.objectContaining({
				status: 'failed',
				modelId: 'opencode-go/deepseek-v4-flash',
			}),
		);
	});

	it('does not include remediationBrief in normal deep research payload', async () => {
		const task = vi.fn().mockResolvedValue({
			data: regionResultsFixture[0],
			usage: { input: 1, output: 1, cost: { total: 0 } },
			model: { provider: 'opencode-go', id: 'kimi-k2.6' },
		});
		const session = vi.fn().mockResolvedValue({
			name: 'article:brief_accept:region:nigeria:deep-research',
			task,
		});
		const harness = { session } as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});
		await delegator.research(discoveryPortfolioFixture.briefs[0], 'nigeria');
		const payload = JSON.parse(String(task.mock.calls[0]?.[0]));
		expect(payload.remediationBrief).toBeUndefined();
		expect(session).toHaveBeenCalledWith('article:brief_accept:region:nigeria:deep-research');
	});

	it('passes the exact remediation brief in remediation payload', async () => {
		const task = vi.fn().mockResolvedValue({
			data: regionResultsFixture[0],
			usage: { input: 1, output: 1, cost: { total: 0 } },
			model: { provider: 'opencode-go', id: 'kimi-k2.6' },
		});
		const session = vi.fn().mockResolvedValue({
			name: 'article:brief_accept:region:nigeria:deep-research',
			task,
		});
		const harness = { session } as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});
		const remediationBrief = {
			briefId: 'brief_accept',
			market: 'nigeria' as const,
			requirements: [
				{
					requirementId: 'req_accept_high',
					question: 'What is the new CAR?',
					sourceRule: 'primary' as const,
					targetDomains: ['cbn.gov.ng'],
					missingAnchors: ['15%'],
					reasonCodes: ['requirement_anchor_missing'],
					currentSourceIds: ['src_1'],
					currentEvidenceIds: ['ev_1'],
					refetchUrls: ['https://cbn.gov.ng/documents/circular-2026'],
				},
			],
			excludedUrls: ['https://cbn.gov.ng/documents/circular-2026'],
			maxSearches: 6 as const,
			maxFetches: 10 as const,
		};
		await delegator.research(discoveryPortfolioFixture.briefs[0], 'nigeria', {
			phase: 'remediation',
			remediationBrief,
		});
		const payload = JSON.parse(String(task.mock.calls[0]?.[0]));
		expect(payload.remediationBrief).toEqual(remediationBrief);
	});

	it('rejects Ghana remediation passed to Nigeria', async () => {
		const harness = { session: vi.fn() } as unknown as FlueHarness;
		const delegator = createFlueResearchDelegator(harness, {
			discovery: { nigeria: 'discovery_nigeria', ghana: 'discovery_ghana' },
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
		});
		await expect(
			delegator.research(discoveryPortfolioFixture.briefs[0], 'nigeria', {
				phase: 'remediation',
				remediationBrief: {
					briefId: 'brief_accept',
					market: 'ghana',
					requirements: [
						{
							requirementId: 'req_gh',
							question: 'q',
							sourceRule: 'primary',
							targetDomains: ['bog.gov.gh'],
							missingAnchors: [],
							reasonCodes: ['requirement_no_evidence'],
							currentSourceIds: [],
							currentEvidenceIds: [],
							refetchUrls: [],
						},
					],
					excludedUrls: [],
					maxSearches: 6,
					maxFetches: 10,
				},
			}),
		).rejects.toThrow('does not match nigeria');
	});
});
