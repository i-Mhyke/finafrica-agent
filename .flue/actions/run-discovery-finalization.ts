import { defineAction } from '@flue/runtime';
import * as v from 'valibot';
import { discoveryFinalizer } from '../agents/profiles/discovery-finalizer';
import {
	DiscoveryActionSchema,
	DiscoveryMarketCheckpointSchema,
	DiscoveryValidationErrorSchema,
} from '../research/discovery-lifecycle-schemas';
import { DiscoveryRunRequestSchema, MarketSchema } from '../research/schemas';
import { AGENT_DECISION_TIMEOUT_MS, DiscoveryAgentTaskTimeoutError } from './run-discovery-decision';

const DiscoveryFinalizationInputSchema = v.object({
	request: DiscoveryRunRequestSchema,
	market: MarketSchema,
	checkpoint: DiscoveryMarketCheckpointSchema,
	validationErrors: v.array(DiscoveryValidationErrorSchema),
});

export const runDiscoveryFinalization = defineAction({
	name: 'run_discovery_finalization',
	description: 'Run one no-tools discovery finalization turn for the durable control plane.',
	input: DiscoveryFinalizationInputSchema,
	output: DiscoveryActionSchema,

	async run({ harness, input, log }) {
		const session = await harness.session(`discovery-finalizer:${input.market}`);
		try {
			const { data } = await session.task(
				JSON.stringify({
					request: input.request,
					market: input.market,
					checkpoint: input.checkpoint,
					validationErrors: input.validationErrors,
				}),
				{
					agent: discoveryFinalizer.name,
					result: DiscoveryActionSchema,
					signal: AbortSignal.timeout(AGENT_DECISION_TIMEOUT_MS),
				},
			);
			if (data.type !== 'submit-candidate' && data.type !== 'submit-no-signal') {
				throw new Error(`Finalizer must return a terminal action, got ${data.type}`);
			}
			return data;
		} catch (error) {
			if (
				error instanceof DOMException && error.name === 'AbortError' ||
				(error instanceof Error && /timed out/i.test(error.message))
			) {
				log.error('Discovery finalization timed out', { market: input.market });
				throw new DiscoveryAgentTaskTimeoutError(input.market);
			}
			throw error;
		}
	},
});
