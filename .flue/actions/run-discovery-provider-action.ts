import { defineAction } from '@flue/runtime';
import * as v from 'valibot';
import {
	DiscoveryActionSchema,
	type DiscoveryAction,
} from '../research/discovery-lifecycle-schemas';
import {
	createDiscoveryProviderCapacity,
	executeDiscoveryFetchAction,
	executeDiscoverySearchAction,
	type DiscoverySelectedSource,
} from '../research/discovery-provider-executor';
import { ResearchArtifactLedger } from '../research/ledger';
import { createResearchRuntime, readResearchEnv } from '../research/runtime';
import {
	DiscoveryRunRequestSchema,
	MarketSchema,
	ProviderCallReceiptSchema,
	SourceRecordSchema,
	EvidenceExcerptSchema,
} from '../research/schemas';

const DiscoveryProviderActionInputSchema = v.object({
	request: DiscoveryRunRequestSchema,
	market: MarketSchema,
	actionId: v.string(),
	action: DiscoveryActionSchema,
	searchesUsed: v.number(),
	fetchesUsed: v.number(),
	marketSearchCount: v.number(),
	selectedSources: v.array(
		v.object({
			sourceId: v.string(),
			url: v.string(),
			tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
			market: MarketSchema,
		}),
	),
});

const DiscoveryProviderActionOutputSchema = v.object({
	actionId: v.string(),
	status: v.picklist([
		'ok',
		'limit-reached',
		'budget-exhausted',
		'invalid-selection',
		'provider_timeout',
		'provider_rate_limit',
		'provider_error',
		'provider_outcome_unknown',
	]),
	receipts: v.array(ProviderCallReceiptSchema),
	selectedSourceIds: v.array(v.string()),
	selectedSources: v.array(
		v.object({
			sourceId: v.string(),
			url: v.string(),
			tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
			market: MarketSchema,
		}),
	),
	searchQuery: v.optional(v.string()),
	sources: v.array(SourceRecordSchema),
	evidence: v.array(EvidenceExcerptSchema),
});

export const runDiscoveryProviderAction = defineAction({
	name: 'run_discovery_provider_action',
	description: 'Execute one authorized discovery provider action for the durable control plane.',
	input: DiscoveryProviderActionInputSchema,
	output: DiscoveryProviderActionOutputSchema,

	async run({ input, log }) {
		const runtime = createResearchRuntime(input.request, readResearchEnv());
		const marketBudget = runtime.discoveryBudgets[input.market];
		if (!marketBudget) {
			throw new Error(`Missing discovery budget for market ${input.market}`);
		}

		const scope = {
			runKey: input.request.runKey,
			phase: 'discovery' as const,
			market: input.market,
			windowStart: input.request.window.start,
			windowEnd: input.request.window.end,
			maxProviderCostUsd: input.request.maxProviderCostUsd,
		};
		const capacity = createDiscoveryProviderCapacity({
			searchesUsed: input.searchesUsed,
			fetchesUsed: input.fetchesUsed,
		});
		const selectedSources = new Map<string, DiscoverySelectedSource>(
			input.selectedSources.map((source) => [source.sourceId, source]),
		);
		const ledger = new ResearchArtifactLedger();
		const clock = { now: () => new Date().toISOString() };

		if (input.action.type === 'search' || input.action.type === 'fetch') {
			// terminal actions are not provider actions
		} else {
			throw new Error(`Unsupported provider action type: ${input.action.type}`);
		}

		const action = input.action as Extract<
			DiscoveryAction,
			{ type: 'search' | 'fetch' }
		>;

		if (action.type === 'search') {
			const result = await executeDiscoverySearchAction({
				router: runtime.router,
				budget: marketBudget,
				clock,
				scope,
				action,
				capacity,
				marketSearchCount: input.marketSearchCount,
				attempt: input.searchesUsed + 1,
			});
			log.info('Discovery search provider action complete', {
				actionId: input.actionId,
				status: result.status,
				market: input.market,
			});
			return {
				actionId: input.actionId,
				status: result.status,
				receipts: result.receipts,
				selectedSourceIds: result.selectedSources.map((source) => source.sourceId),
				selectedSources: result.selectedSources,
				searchQuery: result.query,
				sources: [],
				evidence: [],
			};
		}

		const result = await executeDiscoveryFetchAction({
			router: runtime.router,
			budget: marketBudget,
			clock,
			scope,
			action,
			capacity,
			selectedSources,
			attemptBase: input.fetchesUsed,
			ledger,
		});
		log.info('Discovery fetch provider action complete', {
			actionId: input.actionId,
			status: result.status,
			market: input.market,
		});
		return {
			actionId: input.actionId,
			status: result.status,
			receipts: result.receipts,
			selectedSourceIds: [],
			selectedSources: [],
			sources: result.sourceRecords,
			evidence: result.evidenceRecords,
		};
	},
});
