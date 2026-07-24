import type {
	DiscoveryAction,
	DiscoveryActionError,
	DiscoveryMarketCheckpoint,
	DiscoverySupervisorDecision,
} from './discovery-lifecycle-schemas';
import {
	DISCOVERY_MAX_FINALIZATION_REPAIRS,
	DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
	fingerprintDiscoveryProgress,
} from './discovery-lifecycle-schemas';
import {
	MarketDiscoveryAgentResultSchema,
	MarketDiscoveryResultSchema,
	type EvidenceExcerpt,
	type ProviderCallReceipt,
	type SourceRecord,
} from './schemas';
import * as v from 'valibot';

const TERMINAL_STATES = new Set([
	'completed-signal',
	'completed-no-signal',
	'failed',
] as const);

const FINALIZATION_STATES = new Set([
	'finalization-pending',
	'repair-pending',
] as const);

export interface DiscoveryRetainedArtifacts {
	receipts: ProviderCallReceipt[];
	sources: SourceRecord[];
	evidence: EvidenceExcerpt[];
}

function buildActionId(checkpoint: DiscoveryMarketCheckpoint): string {
	return `${checkpoint.runKey}:${checkpoint.market}:action:${checkpoint.actionIndex + 1}`;
}

function allowedActionTypes(checkpoint: DiscoveryMarketCheckpoint): DiscoveryAction['type'][] {
	if (TERMINAL_STATES.has(checkpoint.state as never)) {
		return [];
	}

	if (FINALIZATION_STATES.has(checkpoint.state as never)) {
		return ['submit-candidate', 'submit-no-signal'];
	}

	const actions: DiscoveryAction['type'][] = ['search', 'submit-candidate', 'submit-no-signal'];
	if (checkpoint.selectedSourceIds.length > 0) {
		actions.push('fetch');
	}
	return actions;
}

function redirect(
	checkpoint: DiscoveryMarketCheckpoint,
	errors: DiscoveryActionError[],
): DiscoverySupervisorDecision {
	return {
		type: 'redirect',
		errors,
		allowedActionTypes: allowedActionTypes(checkpoint),
	};
}

function shouldForceFinalize(checkpoint: DiscoveryMarketCheckpoint): string | null {
	if (checkpoint.actionIndex >= DISCOVERY_MAX_SEMANTIC_DECISIONS) {
		return 'semantic_decision_limit';
	}
	if (checkpoint.noProgressCount >= DISCOVERY_MAX_NO_PROGRESS_DECISIONS) {
		return 'no_progress_limit';
	}
	if (checkpoint.budget.searchesUsed >= checkpoint.budget.maxSearches) {
		return 'search_budget_exhausted';
	}
	if (checkpoint.budget.fetchesUsed >= checkpoint.budget.maxFetches) {
		return 'fetch_budget_exhausted';
	}
	if (checkpoint.budget.requestsReserved >= checkpoint.budget.maxRequests) {
		return 'request_budget_exhausted';
	}
	if (checkpoint.budget.admittedCostUsd >= checkpoint.budget.maxCostUsd) {
		return 'cost_budget_exhausted';
	}
	return null;
}

function emptyRetained(): DiscoveryRetainedArtifacts {
	return { receipts: [], sources: [], evidence: [] };
}

function validateTerminalAction(
	checkpoint: DiscoveryMarketCheckpoint,
	action: Extract<DiscoveryAction, { type: 'submit-candidate' | 'submit-no-signal' }>,
	retained: DiscoveryRetainedArtifacts,
): DiscoverySupervisorDecision {
	if (action.type === 'submit-no-signal') {
		const result = {
			runKey: checkpoint.runKey,
			market: checkpoint.market,
			coverage: {
				market: checkpoint.market,
				searchesPerformed: checkpoint.budget.searchesUsed,
				signalsFound: 0,
				sourceIds: retained.sources.map((source) => source.sourceId),
				status: 'no-signals' as const,
			},
			receipts: retained.receipts,
			sources: retained.sources,
			evidence: retained.evidence,
			briefs: [],
		};
		const parsed = v.safeParse(MarketDiscoveryResultSchema, result);
		if (!parsed.success) {
			return redirect(checkpoint, [
				{
					code: 'terminal_validation_failed',
					message: 'No-signal terminal result failed validation',
				},
			]);
		}
		return { type: 'terminal', result: parsed.output };
	}

	const agentParsed = v.safeParse(MarketDiscoveryAgentResultSchema, action.candidate);
	if (!agentParsed.success) {
		return redirect(checkpoint, [
			{
				code: 'terminal_validation_failed',
				message: 'Candidate brief failed market discovery validation',
			},
		]);
	}

	if (
		agentParsed.output.runKey !== checkpoint.runKey ||
		agentParsed.output.market !== checkpoint.market
	) {
		return redirect(checkpoint, [
			{
				code: 'terminal_scope_mismatch',
				message: 'Candidate runKey/market must match the checkpoint scope',
			},
		]);
	}

	const retainedSourceIds = new Set(retained.sources.map((source) => source.sourceId));
	const retainedEvidenceIds = new Set(retained.evidence.map((evidence) => evidence.evidenceId));
	const unknownRefs = agentParsed.output.briefs.flatMap((brief) => [
		...brief.discoverySourceIds.filter((id) => !retainedSourceIds.has(id)),
		...brief.discoveryEvidenceIds.filter((id) => !retainedEvidenceIds.has(id)),
	]);
	if (unknownRefs.length > 0) {
		if (checkpoint.finalizationRepairCount >= DISCOVERY_MAX_FINALIZATION_REPAIRS) {
			return {
				type: 'fail',
				failure: {
					errorClass: 'terminal_validation_exhausted',
					errorMessage: 'Finalization repair budget exhausted',
				},
			};
		}
		return redirect(checkpoint, [
			{
				code: 'terminal_provenance_missing',
				message: `Candidate references artifacts not retained for this market: ${[...new Set(unknownRefs)].join(', ')}`,
				recovery: 'Reference only retained source/evidence IDs from successful fetches',
			},
		]);
	}

	const result = {
		runKey: checkpoint.runKey,
		market: checkpoint.market,
		coverage: {
			...agentParsed.output.coverage,
			sourceIds: retained.sources.map((source) => source.sourceId),
			searchesPerformed: checkpoint.budget.searchesUsed,
		},
		receipts: retained.receipts,
		sources: retained.sources,
		evidence: retained.evidence,
		briefs: agentParsed.output.briefs,
	};
	const parsed = v.safeParse(MarketDiscoveryResultSchema, result);
	if (!parsed.success) {
		if (checkpoint.finalizationRepairCount >= DISCOVERY_MAX_FINALIZATION_REPAIRS) {
			return {
				type: 'fail',
				failure: {
					errorClass: 'terminal_validation_exhausted',
					errorMessage: 'Finalization repair budget exhausted',
				},
			};
		}
		return redirect(checkpoint, [
			{
				code: 'terminal_validation_failed',
				message: 'Candidate terminal result failed validation',
				recovery: 'Repair candidate briefs and resubmit',
			},
		]);
	}

	return { type: 'terminal', result: parsed.output };
}

export function superviseDiscoveryAction(
	checkpoint: DiscoveryMarketCheckpoint,
	proposedAction: DiscoveryAction,
	retained: DiscoveryRetainedArtifacts = emptyRetained(),
): DiscoverySupervisorDecision {
	if (TERMINAL_STATES.has(checkpoint.state as never)) {
		return {
			type: 'fail',
			failure: {
				errorClass: 'illegal_terminal_transition',
				errorMessage: `Cannot supervise actions in terminal state ${checkpoint.state}`,
			},
		};
	}

	if (checkpoint.pendingAction !== null) {
		return redirect(checkpoint, [
			{
				code: 'pending_action_exists',
				message: 'A provider action is already reserved or executing',
			},
		]);
	}

	const forceReason = shouldForceFinalize(checkpoint);
	if (
		forceReason &&
		proposedAction.type !== 'submit-candidate' &&
		proposedAction.type !== 'submit-no-signal'
	) {
		return { type: 'force-finalize', reason: forceReason };
	}

	const allowed = allowedActionTypes(checkpoint);
	if (!allowed.includes(proposedAction.type)) {
		return redirect(checkpoint, [
			{
				code: 'action_not_allowed',
				message: `Action ${proposedAction.type} is not allowed in state ${checkpoint.state}`,
			},
		]);
	}

	if (
		proposedAction.type === 'submit-candidate' ||
		proposedAction.type === 'submit-no-signal'
	) {
		return validateTerminalAction(checkpoint, proposedAction, retained);
	}

	if (proposedAction.type === 'search') {
		if (checkpoint.budget.searchesUsed >= checkpoint.budget.maxSearches) {
			return redirect(checkpoint, [
				{
					code: 'search_budget_exhausted',
					message: 'Discovery search budget exhausted for this market',
				},
			]);
		}
		if (checkpoint.completedSearchQueries.includes(proposedAction.query)) {
			return redirect(checkpoint, [
				{
					code: 'duplicate_search_query',
					message: 'Search query already executed for this market',
				},
			]);
		}
	}

	if (proposedAction.type === 'fetch') {
		if (checkpoint.budget.fetchesUsed >= checkpoint.budget.maxFetches) {
			return redirect(checkpoint, [
				{
					code: 'fetch_budget_exhausted',
					message: 'Discovery fetch budget exhausted for this market',
				},
			]);
		}
		const unknownSources = proposedAction.sourceIds.filter(
			(sourceId) => !checkpoint.selectedSourceIds.includes(sourceId),
		);
		if (unknownSources.length > 0) {
			return redirect(checkpoint, [
				{
					code: 'unknown_source_ids',
					message: `Source IDs are not eligible for fetch: ${unknownSources.join(', ')}`,
				},
			]);
		}
	}

	return {
		type: 'execute',
		action: proposedAction,
		actionId: buildActionId(checkpoint),
	};
}

export function detectNoProgress(
	checkpoint: DiscoveryMarketCheckpoint,
	previousFingerprint: string,
): boolean {
	return fingerprintDiscoveryProgress(checkpoint) === previousFingerprint;
}

export { fingerprintDiscoveryProgress };
