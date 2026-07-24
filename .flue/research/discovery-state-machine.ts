import type {
	DiscoveryLifecycleEvent,
	DiscoveryMarketCheckpoint,
} from './discovery-lifecycle-schemas';
import {
	DISCOVERY_MAX_FINALIZATION_REPAIRS,
	DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
	fingerprintDiscoveryProgress,
} from './discovery-lifecycle-schemas';

function assertRevision(
	checkpoint: DiscoveryMarketCheckpoint,
	expectedRevision: number,
): void {
	if (checkpoint.revision !== expectedRevision) {
		throw new Error(
			`Stale checkpoint revision: expected ${expectedRevision}, got ${checkpoint.revision}`,
		);
	}
}

function assertNotTerminal(checkpoint: DiscoveryMarketCheckpoint): void {
	if (
		checkpoint.state === 'completed-signal' ||
		checkpoint.state === 'completed-no-signal' ||
		checkpoint.state === 'failed'
	) {
		throw new Error(`Cannot transition terminal discovery state: ${checkpoint.state}`);
	}
}

function bumpRevision(
	checkpoint: DiscoveryMarketCheckpoint,
	patch: Partial<DiscoveryMarketCheckpoint>,
): DiscoveryMarketCheckpoint {
	const next: DiscoveryMarketCheckpoint = {
		...checkpoint,
		...patch,
		revision: checkpoint.revision + 1,
	};
	next.progressFingerprint = fingerprintDiscoveryProgress(next);
	return next;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function mergeIds(existing: string[], incoming: string[] = []): string[] {
	return uniqueSorted([...existing, ...incoming]);
}

export function transitionDiscovery(
	checkpoint: DiscoveryMarketCheckpoint,
	event: DiscoveryLifecycleEvent,
): DiscoveryMarketCheckpoint {
	assertNotTerminal(checkpoint);

	switch (event.type) {
		case 'reservation_committed': {
			if (checkpoint.pendingAction === null) {
				throw new Error('Reservation must reference the currently authorized action');
			}
			if (checkpoint.pendingAction.actionId !== event.actionId) {
				throw new Error('Reservation actionId does not match pending action');
			}
			if (checkpoint.actionIndex >= DISCOVERY_MAX_SEMANTIC_DECISIONS) {
				throw new Error('Semantic decision budget exhausted');
			}

			const pendingAction = checkpoint.pendingAction;
			const nextState =
				pendingAction.action.type === 'search' ? 'search-reserved' : 'fetch-reserved';

			return bumpRevision(checkpoint, {
				state: nextState,
				actionIndex: checkpoint.actionIndex + 1,
				budget: {
					...checkpoint.budget,
					requestsReserved: checkpoint.budget.requestsReserved + 1,
				},
			});
		}

		case 'observation_recorded': {
			if (checkpoint.pendingAction?.actionId !== event.actionId) {
				throw new Error('Observation actionId does not match pending action');
			}

			const action = checkpoint.pendingAction.action;
			const searchesUsed =
				action.type === 'search'
					? checkpoint.budget.searchesUsed + 1
					: checkpoint.budget.searchesUsed;
			const fetchesUsed =
				action.type === 'fetch'
					? checkpoint.budget.fetchesUsed + 1
					: checkpoint.budget.fetchesUsed;

			if (searchesUsed > checkpoint.budget.maxSearches) {
				throw new Error('Search budget exceeded');
			}
			if (fetchesUsed > checkpoint.budget.maxFetches) {
				throw new Error('Fetch budget exceeded');
			}

			const completedSearchQueries =
				action.type === 'search' && event.searchQuery
					? mergeIds(checkpoint.completedSearchQueries, [event.searchQuery])
					: checkpoint.completedSearchQueries;

			return bumpRevision(checkpoint, {
				state: 'decision-pending',
				pendingAction: null,
				budget: {
					...checkpoint.budget,
					searchesUsed,
					fetchesUsed,
				},
				selectedSourceIds: mergeIds(
					checkpoint.selectedSourceIds,
					event.selectedSourceIds,
				),
				completedSearchQueries,
				sourceIds: mergeIds(checkpoint.sourceIds, event.sourceIds),
				evidenceIds: mergeIds(checkpoint.evidenceIds, event.evidenceIds),
				receiptIds: mergeIds(checkpoint.receiptIds, event.receiptIds),
			});
		}

		case 'observation_unknown': {
			if (checkpoint.pendingAction?.actionId !== event.actionId) {
				throw new Error('Unknown observation actionId does not match pending action');
			}

			return bumpRevision(checkpoint, {
				state: 'decision-pending',
				pendingAction: null,
				failure: {
					errorClass: 'provider_outcome_unknown',
					errorMessage: 'Provider outcome could not be determined for committed action',
				},
			});
		}

		case 'redirect_recorded': {
			return bumpRevision(checkpoint, {
				state: 'decision-pending',
				pendingAction: null,
			});
		}

		case 'force_finalization': {
			return bumpRevision(checkpoint, {
				state: 'finalization-pending',
				pendingAction: null,
				validationErrors: [],
			});
		}

		case 'terminal_repair_required': {
			if (checkpoint.finalizationRepairCount >= DISCOVERY_MAX_FINALIZATION_REPAIRS) {
				throw new Error('Finalization repair budget exhausted');
			}

			return bumpRevision(checkpoint, {
				state: 'repair-pending',
				pendingAction: null,
				finalizationRepairCount: checkpoint.finalizationRepairCount + 1,
				validationErrors: event.errors,
			});
		}

		case 'terminal_accepted': {
			if (event.result.market !== checkpoint.market) {
				throw new Error('Terminal result market does not match checkpoint market');
			}
			if (event.result.runKey !== checkpoint.runKey) {
				throw new Error('Terminal result runKey does not match checkpoint runKey');
			}

			const terminalState =
				event.result.coverage.status === 'covered'
					? 'completed-signal'
					: event.result.coverage.status === 'no-signals'
						? 'completed-no-signal'
						: 'failed';

			return bumpRevision(checkpoint, {
				state: terminalState,
				pendingAction: null,
				terminalResult: event.result,
				failure: null,
			});
		}

		case 'terminal_failed': {
			return bumpRevision(checkpoint, {
				state: 'failed',
				pendingAction: null,
				failure: event.failure,
			});
		}

		default: {
			const exhaustive: never = event;
			throw new Error(`Unhandled discovery lifecycle event: ${String(exhaustive)}`);
		}
	}
}

export function commitReservation(
	checkpoint: DiscoveryMarketCheckpoint,
	actionId: string,
): DiscoveryMarketCheckpoint {
	assertNotTerminal(checkpoint);

	if (checkpoint.pendingAction === null || checkpoint.pendingAction.actionId !== actionId) {
		throw new Error('Reservation must reference the currently authorized action');
	}

	return transitionDiscovery(checkpoint, { type: 'reservation_committed', actionId });
}

export function attachPendingAction(
	checkpoint: DiscoveryMarketCheckpoint,
	pendingAction: NonNullable<DiscoveryMarketCheckpoint['pendingAction']>,
): DiscoveryMarketCheckpoint {
	if (checkpoint.pendingAction !== null) {
		throw new Error('Pending action already attached');
	}

	return bumpRevision(checkpoint, { pendingAction });
}

export function recordNoProgress(
	checkpoint: DiscoveryMarketCheckpoint,
	previousFingerprint: string,
): DiscoveryMarketCheckpoint {
	if (checkpoint.progressFingerprint === previousFingerprint) {
		const noProgressCount = checkpoint.noProgressCount + 1;
		if (noProgressCount > DISCOVERY_MAX_NO_PROGRESS_DECISIONS) {
			throw new Error('No-progress decision budget exhausted');
		}
		return bumpRevision(checkpoint, { noProgressCount });
	}
	return checkpoint;
}
