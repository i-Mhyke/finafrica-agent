import type { DiscoveryMarketCheckpoint } from '../../../../.flue/research/discovery-lifecycle-schemas';
import {
	attachPendingAction,
	commitReservation,
	recordNoProgress,
	transitionDiscovery,
} from '../../../../.flue/research/discovery-state-machine';
import {
	detectNoProgress,
	fingerprintDiscoveryProgress,
	superviseDiscoveryAction,
	type DiscoveryRetainedArtifacts,
} from '../../../../.flue/research/discovery-supervisor';
import {
	effectiveProviderBudgetUsd,
	type DiscoveryRunRequest,
	type Market,
	type MarketDiscoveryResult,
} from '../../../../.flue/research/schemas';
import type { FlueClient, FlueProviderActionResult } from '../flue-client';
import {
	createScope,
	ResearchRunRepositoryError,
	type ProviderObservationPayload,
	type ResearchRunRepository,
	type SelectedSearchSource,
} from '../state/research-run-repository';
import { isTerminalDiscoveryState } from '../env';

const MAX_CHECKPOINT_PERSIST_ATTEMPTS = 8;

export interface MarketDiscoveryStore {
	initMarket(input: {
		runKey: string;
		workflowInstanceId: string;
		market: Market;
		maxRequests: number;
		maxCostUsd: number;
	}): DiscoveryMarketCheckpoint | Promise<DiscoveryMarketCheckpoint>;
	getCheckpoint(
		runKey: string,
		market: Market,
	): DiscoveryMarketCheckpoint | null | Promise<DiscoveryMarketCheckpoint | null>;
	saveCheckpoint(
		checkpoint: DiscoveryMarketCheckpoint,
		expectedRevision: number,
	): DiscoveryMarketCheckpoint | Promise<DiscoveryMarketCheckpoint>;
	reserveProviderAction(
		scope: ReturnType<typeof createScope>,
		pending: NonNullable<DiscoveryMarketCheckpoint['pendingAction']>,
	): void | Promise<void>;
	saveObservation(
		scope: ReturnType<typeof createScope>,
		actionId: string,
		payload: ProviderObservationPayload,
	): 'inserted' | 'existing' | Promise<'inserted' | 'existing'>;
	getObservation(
		scope: ReturnType<typeof createScope>,
		actionId: string,
	): ProviderObservationPayload | null | Promise<ProviderObservationPayload | null>;
	getSelectedSources(
		scope: ReturnType<typeof createScope>,
	): SelectedSearchSource[] | Promise<SelectedSearchSource[]>;
	getRetainedArtifacts(
		scope: ReturnType<typeof createScope>,
	): DiscoveryRetainedArtifacts | Promise<DiscoveryRetainedArtifacts>;
}

export function createMarketDiscoveryStore(repository: ResearchRunRepository): MarketDiscoveryStore {
	const now = () => new Date().toISOString();
	return {
		initMarket: (input) => repository.initRun({ ...input, now: now() }),
		getCheckpoint: (runKey, market) => repository.getCheckpoint(runKey, market),
		saveCheckpoint: (checkpoint, expectedRevision) =>
			repository.compareAndSwapCheckpoint(checkpoint, expectedRevision, now()),
		reserveProviderAction: (scope, pending) =>
			repository.reserveProviderAction(scope, pending, now()),
		saveObservation: (scope, actionId, payload) =>
			repository.saveObservation(scope, actionId, payload, now()),
		getObservation: (scope, actionId) => repository.getObservation(scope, actionId),
		getSelectedSources: (scope) => repository.getSelectedSources(scope),
		getRetainedArtifacts: (scope) => repository.getRetainedArtifacts(scope),
	};
}

function isStaleRevisionError(error: unknown): boolean {
	if (error instanceof ResearchRunRepositoryError) {
		return error.code === 'stale_revision' || error.code === 'terminal_committed';
	}
	if (error instanceof Error) {
		return (
			error.message.includes('Checkpoint compare-and-swap failed') ||
			error.message.includes('Stale checkpoint revision') ||
			error.message.includes('Terminal checkpoint cannot be overwritten')
		);
	}
	return false;
}

function checkpointAlreadyPersisted(
	latest: DiscoveryMarketCheckpoint,
	desired: DiscoveryMarketCheckpoint,
): boolean {
	return (
		latest.state === desired.state &&
		latest.progressFingerprint === desired.progressFingerprint &&
		(latest.terminalResult === null
			? desired.terminalResult === null
			: desired.terminalResult !== null)
	);
}

function mergeCheckpointForRetry(
	latest: DiscoveryMarketCheckpoint,
	desired: DiscoveryMarketCheckpoint,
): DiscoveryMarketCheckpoint {
	return {
		...desired,
		revision: latest.revision + 1,
		actionIndex: Math.max(latest.actionIndex, desired.actionIndex),
		finalizationRepairCount: Math.max(
			latest.finalizationRepairCount,
			desired.finalizationRepairCount,
		),
		noProgressCount: Math.max(latest.noProgressCount, desired.noProgressCount),
		budget: {
			...desired.budget,
			searchesUsed: Math.max(latest.budget.searchesUsed, desired.budget.searchesUsed),
			fetchesUsed: Math.max(latest.budget.fetchesUsed, desired.budget.fetchesUsed),
			requestsReserved: Math.max(
				latest.budget.requestsReserved,
				desired.budget.requestsReserved,
			),
			admittedCostUsd: Math.max(latest.budget.admittedCostUsd, desired.budget.admittedCostUsd),
			actualCostUsd: Math.max(latest.budget.actualCostUsd, desired.budget.actualCostUsd),
		},
	};
}

async function persistCheckpoint(
	store: MarketDiscoveryStore,
	before: DiscoveryMarketCheckpoint,
	after: DiscoveryMarketCheckpoint,
): Promise<DiscoveryMarketCheckpoint> {
	let expectedRevision = before.revision;
	let pending = after;

	for (let attempt = 0; attempt < MAX_CHECKPOINT_PERSIST_ATTEMPTS; attempt += 1) {
		try {
			return await store.saveCheckpoint(pending, expectedRevision);
		} catch (error) {
			if (!isStaleRevisionError(error)) {
				throw error;
			}

			const latest = await store.getCheckpoint(pending.runKey, pending.market);
			if (!latest) {
				throw error;
			}
			if (isTerminalDiscoveryState(latest.state)) {
				return latest;
			}
			if (checkpointAlreadyPersisted(latest, pending)) {
				return latest;
			}

			expectedRevision = latest.revision;
			pending = mergeCheckpointForRetry(latest, pending);
		}
	}

	throw new Error(
		`Checkpoint persist failed after ${MAX_CHECKPOINT_PERSIST_ATTEMPTS} attempts for ${after.market}`,
	);
}

async function applySupervisedTerminal(
	store: MarketDiscoveryStore,
	checkpoint: DiscoveryMarketCheckpoint,
	action: Parameters<typeof superviseDiscoveryAction>[1],
	retained: DiscoveryRetainedArtifacts,
): Promise<{ checkpoint: DiscoveryMarketCheckpoint; done: boolean }> {
	const supervised = superviseDiscoveryAction(checkpoint, action, retained);
	if (supervised.type === 'terminal') {
		const before = checkpoint;
		const next = transitionDiscovery(checkpoint, {
			type: 'terminal_accepted',
			result: supervised.result,
		});
		return { checkpoint: await persistCheckpoint(store, before, next), done: true };
	}
	if (supervised.type === 'redirect') {
		const before = checkpoint;
		const next = transitionDiscovery(checkpoint, {
			type: 'terminal_repair_required',
			errors: supervised.errors.map((error) => ({
				code: error.code,
				message: error.message,
				recovery: error.recovery,
			})),
		});
		return { checkpoint: await persistCheckpoint(store, before, next), done: false };
	}
	if (supervised.type === 'fail') {
		const before = checkpoint;
		const next = transitionDiscovery(checkpoint, {
			type: 'terminal_failed',
			failure: supervised.failure,
		});
		return { checkpoint: await persistCheckpoint(store, before, next), done: true };
	}
	return { checkpoint, done: false };
}

export async function runMarketDiscoveryLoop(input: {
	request: DiscoveryRunRequest;
	market: Market;
	workflowInstanceId: string;
	maxRequests: number;
	store: MarketDiscoveryStore;
	flue: FlueClient;
}): Promise<MarketDiscoveryResult> {
	const scope = createScope(input.request.runKey, input.market);
	let checkpoint =
		(await input.store.getCheckpoint(input.request.runKey, input.market)) ??
		(await input.store.initMarket({
			runKey: input.request.runKey,
			workflowInstanceId: input.workflowInstanceId,
			market: input.market,
			maxRequests: input.maxRequests,
			maxCostUsd: effectiveProviderBudgetUsd(input.request.maxProviderCostUsd),
		}));

	if (checkpoint.terminalResult) {
		return checkpoint.terminalResult;
	}

	while (!isTerminalDiscoveryState(checkpoint.state)) {
		const previousFingerprint = fingerprintDiscoveryProgress(checkpoint);
		const retained = await input.store.getRetainedArtifacts(scope);

		if (
			checkpoint.state === 'finalization-pending' ||
			checkpoint.state === 'repair-pending'
		) {
			const finalized = await input.flue.runDiscoveryFinalization({
				request: input.request,
				market: input.market,
				checkpoint,
				validationErrors: checkpoint.validationErrors,
			});
			const applied = await applySupervisedTerminal(
				input.store,
				checkpoint,
				finalized.action,
				retained,
			);
			checkpoint = applied.checkpoint;
			if (applied.done) {
				break;
			}
			continue;
		}

		const decision = await input.flue.runDiscoveryDecision({
			request: input.request,
			market: input.market,
			checkpoint,
			allowedActionTypes: ['search', 'fetch', 'submit-candidate', 'submit-no-signal'],
			redirectErrors: [],
		});

		const supervised = superviseDiscoveryAction(checkpoint, decision.action, retained);
		if (supervised.type === 'force-finalize') {
			const before = checkpoint;
			checkpoint = transitionDiscovery(checkpoint, {
				type: 'force_finalization',
				reason: supervised.reason,
			});
			checkpoint = await persistCheckpoint(input.store, before, checkpoint);
			continue;
		}
		if (supervised.type === 'redirect') {
			const before = checkpoint;
			checkpoint = transitionDiscovery(checkpoint, { type: 'redirect_recorded' });
			checkpoint = await persistCheckpoint(input.store, before, checkpoint);
			const beforeNoProgress = checkpoint;
			checkpoint = recordNoProgress(checkpoint, previousFingerprint);
			checkpoint = await persistCheckpoint(input.store, beforeNoProgress, checkpoint);
			continue;
		}
		if (supervised.type === 'terminal' || supervised.type === 'fail') {
			const applied = await applySupervisedTerminal(
				input.store,
				checkpoint,
				decision.action,
				retained,
			);
			checkpoint = applied.checkpoint;
			if (applied.done) {
				break;
			}
			continue;
		}

		const pending = {
			actionId: supervised.actionId,
			action: supervised.action,
			reservedAt: new Date().toISOString(),
		};
		const beforeAttach = checkpoint;
		checkpoint = attachPendingAction(checkpoint, pending);
		checkpoint = await persistCheckpoint(input.store, beforeAttach, checkpoint);
		await input.store.reserveProviderAction(scope, pending);
		const beforeCommit = checkpoint;
		checkpoint = commitReservation(checkpoint, supervised.actionId);
		checkpoint = await persistCheckpoint(input.store, beforeCommit, checkpoint);

		const replay = await input.store.getObservation(scope, supervised.actionId);
		type ProviderObservation = Omit<FlueProviderActionResult, 'actionId'>;
		let provider: ProviderObservation | null = replay
			? {
					status: 'ok' as const,
					receipts: replay.receipts ?? [],
					selectedSourceIds: replay.selectedSourceIds ?? [],
					selectedSources: replay.selectedSources ?? [],
					searchQuery: replay.searchQuery,
					sources: replay.sources ?? [],
					evidence: replay.evidence ?? [],
				}
			: null;

		if (!replay) {
			provider = await input.flue.runDiscoveryProviderAction({
				request: input.request,
				market: input.market,
				actionId: supervised.actionId,
				action: supervised.action,
				searchesUsed: checkpoint.budget.searchesUsed,
				fetchesUsed: checkpoint.budget.fetchesUsed,
				marketSearchCount: checkpoint.budget.searchesUsed,
				selectedSources: await input.store.getSelectedSources(scope),
			});
		}

		const beforeObservation = checkpoint;
		if (provider && provider.status === 'ok') {
			if (!replay) {
				await input.store.saveObservation(scope, supervised.actionId, {
					status: 'completed',
					receiptIds: provider.receipts.map((receipt) => receipt.receiptId),
					selectedSourceIds: provider.selectedSourceIds,
					selectedSources: provider.selectedSources,
					sourceIds: provider.sources.map((source) => source.sourceId),
					evidenceIds: provider.evidence.map((evidence) => evidence.evidenceId),
					searchQuery: provider.searchQuery,
					receipts: provider.receipts,
					sources: provider.sources,
					evidence: provider.evidence,
				});
			}
			checkpoint = transitionDiscovery(checkpoint, {
				type: 'observation_recorded',
				actionId: supervised.actionId,
				receiptIds: provider.receipts.map((receipt) => receipt.receiptId),
				selectedSourceIds: provider.selectedSourceIds,
				sourceIds: provider.sources.map((source) => source.sourceId),
				evidenceIds: provider.evidence.map((evidence) => evidence.evidenceId),
				searchQuery: provider.searchQuery,
			});
		} else if (
			provider &&
			(provider.status === 'provider_timeout' ||
				provider.status === 'provider_rate_limit' ||
				provider.status === 'provider_error' ||
				provider.status === 'provider_outcome_unknown')
		) {
			if (!replay) {
				await input.store.saveObservation(scope, supervised.actionId, {
					status: 'unknown',
					receiptIds: provider.receipts.map((receipt) => receipt.receiptId),
					receipts: provider.receipts,
				});
			}
			checkpoint = transitionDiscovery(checkpoint, {
				type: 'observation_unknown',
				actionId: supervised.actionId,
			});
		} else if (!replay) {
			checkpoint = transitionDiscovery(checkpoint, { type: 'redirect_recorded' });
		}

		if (detectNoProgress(checkpoint, previousFingerprint)) {
			const beforeNoProgress = checkpoint;
			checkpoint = recordNoProgress(checkpoint, previousFingerprint);
			checkpoint = await persistCheckpoint(input.store, beforeNoProgress, checkpoint);
		} else {
			checkpoint = await persistCheckpoint(input.store, beforeObservation, checkpoint);
		}
	}

	if (!checkpoint.terminalResult) {
		throw new Error(`Market ${input.market} ended without a terminal result`);
	}
	return checkpoint.terminalResult;
}
