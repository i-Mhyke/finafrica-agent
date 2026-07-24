import { defineAction } from '@flue/runtime';
import * as v from 'valibot';
import { discoveryDecision } from '../agents/profiles/discovery-decision';
import {
	DiscoveryActionErrorSchema,
	DiscoveryActionSchema,
	DiscoveryMarketCheckpointSchema,
} from '../research/discovery-lifecycle-schemas';
import { DiscoveryRunRequestSchema, MarketSchema } from '../research/schemas';

export const AGENT_DECISION_TIMEOUT_MS = 60_000;
const DISCOVERY_FETCH_LIMIT = 4;

export const DiscoveryDecisionInputSchema = v.object({
	request: DiscoveryRunRequestSchema,
	market: MarketSchema,
	checkpoint: DiscoveryMarketCheckpointSchema,
	allowedActionTypes: v.array(
		v.picklist(['search', 'fetch', 'submit-candidate', 'submit-no-signal']),
	),
	redirectErrors: v.array(DiscoveryActionErrorSchema),
});

export class DiscoveryAgentTaskTimeoutError extends Error {
	readonly errorClass = 'agent_task_timeout' as const;

	constructor(market: string) {
		super(`Discovery decision timed out for market ${market}`);
		this.name = 'DiscoveryAgentTaskTimeoutError';
	}
}

export function assertSingleDiscoveryAction(action: v.InferOutput<typeof DiscoveryActionSchema>): void {
	if (action.type === 'fetch' && action.sourceIds.length > DISCOVERY_FETCH_LIMIT) {
		throw new Error('Discovery decision returned too many fetch source IDs');
	}
}

export const runDiscoveryDecision = defineAction({
	name: 'run_discovery_decision',
	description: 'Run one no-tools discovery decision turn for the durable control plane.',
	input: DiscoveryDecisionInputSchema,
	output: DiscoveryActionSchema,

	async run({ harness, input, log }) {
		const session = await harness.session(`discovery-decision:${input.market}`);
		try {
			const { data } = await session.task(
				JSON.stringify({
					request: input.request,
					market: input.market,
					checkpoint: input.checkpoint,
					allowedActionTypes: input.allowedActionTypes,
					redirectErrors: input.redirectErrors,
				}),
				{
					agent: discoveryDecision.name,
					result: DiscoveryActionSchema,
					signal: AbortSignal.timeout(AGENT_DECISION_TIMEOUT_MS),
				},
			);
			assertSingleDiscoveryAction(data);
			return data;
		} catch (error) {
			if (
				(error instanceof DOMException && error.name === 'AbortError') ||
				(error instanceof Error && /timed out/i.test(error.message))
			) {
				log.error('Discovery decision timed out', { market: input.market });
				throw new DiscoveryAgentTaskTimeoutError(input.market);
			}
			throw error;
		}
	},
});
