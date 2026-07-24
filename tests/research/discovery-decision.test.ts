import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
	assertSingleDiscoveryAction,
	DiscoveryAgentTaskTimeoutError,
	DiscoveryDecisionInputSchema,
} from '../../.flue/actions/run-discovery-decision';
import { discoveryDecision } from '../../.flue/agents/profiles/discovery-decision';
import { discoveryFinalizer } from '../../.flue/agents/profiles/discovery-finalizer';
import { DiscoveryActionSchema } from '../../.flue/research/discovery-lifecycle-schemas';
import { createInitialDiscoveryCheckpoint } from '../../.flue/research/discovery-lifecycle-schemas';
import { superviseDiscoveryAction } from '../../.flue/research/discovery-supervisor';

describe('discovery decision agents', () => {
	const checkpoint = createInitialDiscoveryCheckpoint({
		runKey: 'scan-1',
		workflowInstanceId: 'wf-1',
		market: 'nigeria',
		maxRequests: 20,
		maxCostUsd: 5,
	});

	const request = {
		runKey: 'scan-1',
		trigger: 'manual' as const,
		window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
		focus: null,
		maxDiscoveredBriefs: 30,
		maxAcceptedBriefs: 10,
		maxProviderCostUsd: 5,
	};

	it('accepts one-action decision input and output schemas', () => {
		const input = v.parse(DiscoveryDecisionInputSchema, {
			request,
			market: 'nigeria',
			checkpoint,
			allowedActionTypes: ['search', 'submit-no-signal'],
			redirectErrors: [],
		});
		const action = v.parse(DiscoveryActionSchema, {
			type: 'search',
			query: 'nigeria rates',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		const supervised = superviseDiscoveryAction(input.checkpoint, action);
		expect(supervised.type).toBe('execute');
	});

	it('uses no-tools discovery profiles', () => {
		expect(discoveryDecision.name).toBe('discovery_decision');
		expect(discoveryFinalizer.name).toBe('discovery_finalizer');
		expect(discoveryDecision.skills ?? []).toHaveLength(0);
		expect(discoveryFinalizer.skills ?? []).toHaveLength(0);
	});

	it('rejects multi-fetch decisions above the market fetch limit', () => {
		expect(() =>
			assertSingleDiscoveryAction({
				type: 'fetch',
				sourceIds: ['src_1', 'src_2', 'src_3', 'src_4', 'src_5'],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 1000,
			}),
		).toThrow(/too many fetch source IDs/);
	});

	it('classifies bare decision timeouts as agent_task_timeout', () => {
		const error = new DiscoveryAgentTaskTimeoutError('nigeria');
		expect(error.errorClass).toBe('agent_task_timeout');
		expect(error.name).toBe('DiscoveryAgentTaskTimeoutError');
	});

	it('requires terminal finalizer actions only', () => {
		const terminal = v.safeParse(DiscoveryActionSchema, {
			type: 'submit-no-signal',
			reasonCodes: ['no_primary_signal'],
		});
		expect(terminal.success).toBe(true);

		const nonTerminal = v.safeParse(DiscoveryActionSchema, {
			type: 'search',
			query: 'blocked',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(nonTerminal.success).toBe(true);
		expect(nonTerminal.success && nonTerminal.output.type).toBe('search');
	});
});
