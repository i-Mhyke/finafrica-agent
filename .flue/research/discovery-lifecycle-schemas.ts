import * as v from 'valibot';
import { VERTICALS } from './market-policy';
import {
	DISCOVERY_FETCHES_PER_MARKET,
	DISCOVERY_LIFECYCLE_SCHEMA_VERSION,
	DISCOVERY_MAX_FINALIZATION_REPAIRS,
	DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
	DISCOVERY_SEARCHES_PER_MARKET,
	MarketDiscoveryAgentResultSchema,
	MarketDiscoveryResultSchema,
	MarketSchema,
	SourceTierSchema,
} from './schemas';
import type { MarketDiscoveryResult } from './schemas';

export {
	DISCOVERY_LIFECYCLE_SCHEMA_VERSION,
	DISCOVERY_MAX_FINALIZATION_REPAIRS,
	DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
};

export const DiscoveryLifecycleStateSchema = v.picklist([
	'decision-pending',
	'search-reserved',
	'fetch-reserved',
	'finalization-pending',
	'repair-pending',
	'completed-signal',
	'completed-no-signal',
	'failed',
]);
export type DiscoveryLifecycleState = v.InferOutput<typeof DiscoveryLifecycleStateSchema>;

export const DiscoverySearchActionSchema = v.object({
	type: v.literal('search'),
	query: v.pipe(v.string(), v.minLength(1)),
	vertical: v.picklist(VERTICALS),
	tier: SourceTierSchema,
	resultCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)),
});
export const DiscoveryFetchActionSchema = v.object({
	type: v.literal('fetch'),
	sourceIds: v.pipe(
		v.array(v.pipe(v.string(), v.regex(/^src_/))),
		v.minLength(1),
		v.maxLength(DISCOVERY_FETCHES_PER_MARKET),
	),
	evidenceQuestion: v.pipe(v.string(), v.minLength(1)),
	freshnessMode: v.picklist(['strict', 'relaxed']),
	maxCharacters: v.pipe(v.number(), v.integer(), v.minValue(100)),
});
export const DiscoverySubmitCandidateActionSchema = v.object({
	type: v.literal('submit-candidate'),
	candidate: MarketDiscoveryAgentResultSchema,
});
export const DiscoverySubmitNoSignalActionSchema = v.object({
	type: v.literal('submit-no-signal'),
	reasonCodes: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
});

export const DiscoveryActionSchema = v.variant('type', [
	DiscoverySearchActionSchema,
	DiscoveryFetchActionSchema,
	DiscoverySubmitCandidateActionSchema,
	DiscoverySubmitNoSignalActionSchema,
]);
export type DiscoverySearchAction = v.InferOutput<typeof DiscoverySearchActionSchema>;
export type DiscoveryFetchAction = v.InferOutput<typeof DiscoveryFetchActionSchema>;
export type DiscoveryAction = v.InferOutput<typeof DiscoveryActionSchema>;

export const DiscoveryValidationErrorSchema = v.object({
	code: v.string(),
	path: v.optional(v.string()),
	message: v.string(),
	recovery: v.optional(v.string()),
});
export type DiscoveryValidationError = v.InferOutput<typeof DiscoveryValidationErrorSchema>;

export const DiscoveryActionErrorSchema = v.object({
	code: v.string(),
	message: v.string(),
	recovery: v.optional(v.string()),
});
export type DiscoveryActionError = v.InferOutput<typeof DiscoveryActionErrorSchema>;

export const DiscoveryBudgetStateSchema = v.object({
	maxSearches: v.literal(DISCOVERY_SEARCHES_PER_MARKET),
	maxFetches: v.literal(DISCOVERY_FETCHES_PER_MARKET),
	maxRequests: v.number(),
	maxCostUsd: v.number(),
	searchesUsed: v.number(),
	fetchesUsed: v.number(),
	requestsReserved: v.number(),
	admittedCostUsd: v.number(),
	actualCostUsd: v.number(),
});
export type DiscoveryBudgetState = v.InferOutput<typeof DiscoveryBudgetStateSchema>;

export const DiscoveryFailureSchema = v.object({
	errorClass: v.string(),
	errorMessage: v.string(),
});
export type DiscoveryFailure = v.InferOutput<typeof DiscoveryFailureSchema>;

export const DiscoveryPendingActionSchema = v.object({
	actionId: v.string(),
	action: DiscoveryActionSchema,
	reservedAt: v.string(),
});
export type DiscoveryPendingAction = v.InferOutput<typeof DiscoveryPendingActionSchema>;

export const DiscoveryMarketCheckpointSchema = v.object({
	schemaVersion: v.literal(DISCOVERY_LIFECYCLE_SCHEMA_VERSION),
	runKey: v.pipe(v.string(), v.minLength(1)),
	workflowInstanceId: v.pipe(v.string(), v.minLength(1)),
	market: MarketSchema,
	revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
	state: DiscoveryLifecycleStateSchema,
	actionIndex: v.pipe(v.number(), v.integer(), v.minValue(0)),
	finalizationRepairCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
	noProgressCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
	budget: DiscoveryBudgetStateSchema,
	pendingAction: v.nullable(DiscoveryPendingActionSchema),
	selectedSourceIds: v.array(v.string()),
	completedSearchQueries: v.array(v.string()),
	sourceIds: v.array(v.string()),
	evidenceIds: v.array(v.string()),
	receiptIds: v.array(v.string()),
	validationErrors: v.array(DiscoveryValidationErrorSchema),
	progressFingerprint: v.string(),
	terminalResult: v.nullable(MarketDiscoveryResultSchema),
	failure: v.nullable(DiscoveryFailureSchema),
});
export type DiscoveryMarketCheckpoint = v.InferOutput<
	typeof DiscoveryMarketCheckpointSchema
>;

export const DiscoverySupervisorDecisionSchema = v.variant('type', [
	v.object({
		type: v.literal('execute'),
		action: DiscoveryActionSchema,
		actionId: v.string(),
	}),
	v.object({
		type: v.literal('redirect'),
		errors: v.array(DiscoveryActionErrorSchema),
		allowedActionTypes: v.array(
			v.picklist(['search', 'fetch', 'submit-candidate', 'submit-no-signal']),
		),
	}),
	v.object({
		type: v.literal('force-finalize'),
		reason: v.string(),
	}),
	v.object({
		type: v.literal('terminal'),
		result: MarketDiscoveryResultSchema,
	}),
	v.object({
		type: v.literal('fail'),
		failure: DiscoveryFailureSchema,
	}),
]);
export type DiscoverySupervisorDecision = v.InferOutput<
	typeof DiscoverySupervisorDecisionSchema
>;

export type DiscoveryLifecycleEvent =
	| { type: 'reservation_committed'; actionId: string }
	| {
			type: 'observation_recorded';
			actionId: string;
			receiptIds: string[];
			sourceIds?: string[];
			evidenceIds?: string[];
			selectedSourceIds?: string[];
			searchQuery?: string;
	  }
	| { type: 'observation_unknown'; actionId: string }
	| { type: 'redirect_recorded' }
	| { type: 'force_finalization'; reason: string }
	| {
			type: 'terminal_repair_required';
			errors: DiscoveryValidationError[];
	  }
	| { type: 'terminal_accepted'; result: MarketDiscoveryResult }
	| { type: 'terminal_failed'; failure: DiscoveryFailure };

export function createInitialDiscoveryCheckpoint(input: {
	runKey: string;
	workflowInstanceId: string;
	market: DiscoveryMarketCheckpoint['market'];
	maxRequests: number;
	maxCostUsd: number;
}): DiscoveryMarketCheckpoint {
	const checkpoint: DiscoveryMarketCheckpoint = {
		schemaVersion: DISCOVERY_LIFECYCLE_SCHEMA_VERSION,
		runKey: input.runKey,
		workflowInstanceId: input.workflowInstanceId,
		market: input.market,
		revision: 0,
		state: 'decision-pending',
		actionIndex: 0,
		finalizationRepairCount: 0,
		noProgressCount: 0,
		budget: {
			maxSearches: DISCOVERY_SEARCHES_PER_MARKET,
			maxFetches: DISCOVERY_FETCHES_PER_MARKET,
			maxRequests: input.maxRequests,
			maxCostUsd: input.maxCostUsd,
			searchesUsed: 0,
			fetchesUsed: 0,
			requestsReserved: 0,
			admittedCostUsd: 0,
			actualCostUsd: 0,
		},
		pendingAction: null,
		selectedSourceIds: [],
		completedSearchQueries: [],
		sourceIds: [],
		evidenceIds: [],
		receiptIds: [],
		validationErrors: [],
		progressFingerprint: '',
		terminalResult: null,
		failure: null,
	};
	checkpoint.progressFingerprint = fingerprintDiscoveryProgress(checkpoint);
	return checkpoint;
}

export function fingerprintDiscoveryProgress(
	checkpoint: DiscoveryMarketCheckpoint,
): string {
	const payload = {
		state: checkpoint.state,
		searchesUsed: checkpoint.budget.searchesUsed,
		fetchesUsed: checkpoint.budget.fetchesUsed,
		requestsReserved: checkpoint.budget.requestsReserved,
		admittedCostUsd: checkpoint.budget.admittedCostUsd,
		actualCostUsd: checkpoint.budget.actualCostUsd,
		selectedSourceIds: [...checkpoint.selectedSourceIds].sort(),
		sourceIds: [...checkpoint.sourceIds].sort(),
		evidenceIds: [...checkpoint.evidenceIds].sort(),
		receiptIds: [...checkpoint.receiptIds].sort(),
		validationCodes: checkpoint.validationErrors.map((error) => error.code).sort(),
	};
	return JSON.stringify(payload);
}
