import * as v from 'valibot';
import type { DiscoveryMarketCheckpoint } from '../../../../.flue/research/discovery-lifecycle-schemas';
import {
	createInitialDiscoveryCheckpoint,
	DiscoveryMarketCheckpointSchema,
	type DiscoveryPendingAction,
} from '../../../../.flue/research/discovery-lifecycle-schemas';
import type {
	EvidenceExcerpt,
	Market,
	ProviderCallReceipt,
	SourceRecord,
} from '../../../../.flue/research/schemas';

export const DISCOVERY_PHASE = 'discovery' as const;

export interface ResearchRunScope {
	runKey: string;
	market: Market;
	phase: typeof DISCOVERY_PHASE;
}

export interface SqlClient {
	exec<T extends Record<string, unknown>>(
		query: string,
		...bindings: unknown[]
	): Iterable<T>;
}

export interface SelectedSearchSource {
	sourceId: string;
	url: string;
	tier: 1 | 2 | 3;
	market: Market;
}

export interface ProviderObservationPayload {
	status: 'completed' | 'unknown' | 'failed';
	receiptIds: string[];
	selectedSourceIds?: string[];
	selectedSources?: SelectedSearchSource[];
	sourceIds?: string[];
	evidenceIds?: string[];
	searchQuery?: string;
	receipts?: ProviderCallReceipt[];
	sources?: SourceRecord[];
	evidence?: EvidenceExcerpt[];
}

export interface StateTransitionRecord {
	transitionId: string;
	fromRevision: number;
	toRevision: number;
	eventType: string;
	reason: string | null;
	createdAt: string;
}

export class ResearchRunRepositoryError extends Error {
	constructor(
		readonly code:
			| 'stale_revision'
			| 'duplicate_action'
			| 'missing_reservation'
			| 'terminal_committed'
			| 'cross_market_scope'
			| 'counter_rollback',
		message: string,
	) {
		super(message);
		this.name = 'ResearchRunRepositoryError';
	}
}

function scopeKey(scope: ResearchRunScope): string {
	return `${scope.runKey}:${scope.market}:${scope.phase}`;
}

function parseCheckpoint(raw: string): DiscoveryMarketCheckpoint {
	const parsed = v.parse(DiscoveryMarketCheckpointSchema, JSON.parse(raw));
	return parsed;
}

export class ResearchRunRepository {
	constructor(private readonly sql: SqlClient) {}

	ensureSchema(statements: string[]): void {
		for (const statement of statements) {
			const trimmed = statement.trim();
			if (trimmed.length > 0) {
				this.sql.exec(trimmed);
			}
		}
	}

	initRun(input: {
		runKey: string;
		workflowInstanceId: string;
		market: Market;
		maxRequests: number;
		maxCostUsd: number;
		now: string;
	}): DiscoveryMarketCheckpoint {
		this.sql.exec(
			`INSERT OR IGNORE INTO discovery_runs (run_key, workflow_instance_id, created_at)
			 VALUES (?, ?, ?)`,
			input.runKey,
			input.workflowInstanceId,
			input.now,
		);

		const existing = this.getCheckpoint(input.runKey, input.market);
		if (existing) {
			return existing;
		}

		const checkpoint = createInitialDiscoveryCheckpoint({
			runKey: input.runKey,
			workflowInstanceId: input.workflowInstanceId,
			market: input.market,
			maxRequests: input.maxRequests,
			maxCostUsd: input.maxCostUsd,
		});

		this.sql.exec(
			`INSERT OR IGNORE INTO market_checkpoints
			 (run_key, market, phase, revision, checkpoint_json, terminal_committed, updated_at)
			 VALUES (?, ?, ?, ?, ?, 0, ?)`,
			input.runKey,
			input.market,
			DISCOVERY_PHASE,
			checkpoint.revision,
			JSON.stringify(checkpoint),
			input.now,
		);

		return this.getCheckpoint(input.runKey, input.market) ?? checkpoint;
	}

	getCheckpoint(runKey: string, market: Market): DiscoveryMarketCheckpoint | null {
		const rows = [
			...this.sql.exec<{ checkpoint_json: string }>(
				`SELECT checkpoint_json
				 FROM market_checkpoints
				 WHERE run_key = ? AND market = ? AND phase = ?`,
				runKey,
				market,
				DISCOVERY_PHASE,
			),
		];
		if (rows.length === 0) {
			return null;
		}
		return parseCheckpoint(rows[0]!.checkpoint_json);
	}

	compareAndSwapCheckpoint(
		checkpoint: DiscoveryMarketCheckpoint,
		expectedRevision: number,
		now: string,
	): DiscoveryMarketCheckpoint {
		if (checkpoint.revision !== expectedRevision + 1) {
			throw new ResearchRunRepositoryError(
				'counter_rollback',
				`Checkpoint revision must increment monotonically: expected ${expectedRevision + 1}, got ${checkpoint.revision}`,
			);
		}

		const rows = [
			...this.sql.exec<{ revision: number; terminal_committed: number }>(
				`SELECT revision, terminal_committed
				 FROM market_checkpoints
				 WHERE run_key = ? AND market = ? AND phase = ?`,
				checkpoint.runKey,
				checkpoint.market,
				DISCOVERY_PHASE,
			),
		];
		if (rows.length === 0) {
			throw new ResearchRunRepositoryError('stale_revision', 'Checkpoint does not exist');
		}

		const current = rows[0]!;
		if (current.terminal_committed === 1) {
			throw new ResearchRunRepositoryError(
				'terminal_committed',
				'Terminal checkpoint cannot be overwritten',
			);
		}
		if (current.revision !== expectedRevision) {
			throw new ResearchRunRepositoryError(
				'stale_revision',
				`Stale checkpoint revision: expected ${expectedRevision}, found ${current.revision}`,
			);
		}

		const previous = this.getCheckpoint(checkpoint.runKey, checkpoint.market);
		if (previous) {
			this.assertMonotonicCounters(previous, checkpoint);
		}

		const terminalCommitted =
			checkpoint.state === 'completed-signal' ||
			checkpoint.state === 'completed-no-signal' ||
			checkpoint.state === 'failed'
				? 1
				: 0;

		const updated = this.sql.exec(
			`UPDATE market_checkpoints
			 SET revision = ?, checkpoint_json = ?, terminal_committed = ?, updated_at = ?
			 WHERE run_key = ? AND market = ? AND phase = ? AND revision = ?`,
			checkpoint.revision,
			JSON.stringify(checkpoint),
			terminalCommitted,
			now,
			checkpoint.runKey,
			checkpoint.market,
			DISCOVERY_PHASE,
			expectedRevision,
		);

		if ([...updated].length === 0) {
			throw new ResearchRunRepositoryError(
				'stale_revision',
				'Checkpoint compare-and-swap failed',
			);
		}

		return checkpoint;
	}

	private assertMonotonicCounters(
		previous: DiscoveryMarketCheckpoint,
		next: DiscoveryMarketCheckpoint,
	): void {
		if (next.budget.searchesUsed < previous.budget.searchesUsed) {
			throw new ResearchRunRepositoryError('counter_rollback', 'Search counter rollback');
		}
		if (next.budget.fetchesUsed < previous.budget.fetchesUsed) {
			throw new ResearchRunRepositoryError('counter_rollback', 'Fetch counter rollback');
		}
		if (next.budget.requestsReserved < previous.budget.requestsReserved) {
			throw new ResearchRunRepositoryError('counter_rollback', 'Request counter rollback');
		}
		if (next.actionIndex < previous.actionIndex) {
			throw new ResearchRunRepositoryError('counter_rollback', 'Action index rollback');
		}
	}

	reserveProviderAction(
		scope: ResearchRunScope,
		pending: DiscoveryPendingAction,
		_now: string,
	): void {
		const existing = [
			...this.sql.exec<{ action_id: string }>(
				`SELECT action_id
				 FROM provider_reservations
				 WHERE run_key = ? AND market = ? AND phase = ? AND action_id = ?`,
				scope.runKey,
				scope.market,
				scope.phase,
				pending.actionId,
			),
		];
		if (existing.length > 0) {
			throw new ResearchRunRepositoryError(
				'duplicate_action',
				`Provider action already reserved: ${pending.actionId}`,
			);
		}

		// Single-row reservation. Action type lives in the checkpoint pendingAction;
		// avoid a second discovery_actions write per hop.
		this.sql.exec(
			`INSERT INTO provider_reservations
			 (run_key, market, phase, action_id, reserved_at, status)
			 VALUES (?, ?, ?, ?, ?, 'reserved')`,
			scope.runKey,
			scope.market,
			scope.phase,
			pending.actionId,
			pending.reservedAt,
		);
	}

	requireReservation(scope: ResearchRunScope, actionId: string): void {
		const rows = [
			...this.sql.exec<{ action_id: string }>(
				`SELECT action_id
				 FROM provider_reservations
				 WHERE run_key = ? AND market = ? AND phase = ? AND action_id = ?`,
				scope.runKey,
				scope.market,
				scope.phase,
				actionId,
			),
		];
		if (rows.length === 0) {
			throw new ResearchRunRepositoryError(
				'missing_reservation',
				`Provider action ${actionId} was not reserved`,
			);
		}
	}

	saveObservation(
		scope: ResearchRunScope,
		actionId: string,
		payload: ProviderObservationPayload,
		now: string,
	): 'inserted' | 'existing' {
		this.requireReservation(scope, actionId);

		const existing = [
			...this.sql.exec<{ payload_json: string }>(
				`SELECT payload_json
				 FROM provider_observations
				 WHERE run_key = ? AND market = ? AND phase = ? AND action_id = ?`,
				scope.runKey,
				scope.market,
				scope.phase,
				actionId,
			),
		];
		if (existing.length > 0) {
			return 'existing';
		}

		for (const receipt of payload.receipts ?? []) {
			this.assertArtifactScope(scope, receipt.market);
		}
		for (const source of payload.sources ?? []) {
			this.assertArtifactScope(scope, source.market);
		}
		for (const selected of payload.selectedSources ?? []) {
			this.assertArtifactScope(scope, selected.market);
		}

		// One observation row holds receipts/sources/evidence/selectedSources.
		// Avoid fan-out inserts into provider_receipts / source_records /
		// evidence_records / selected_search_results (N writes per provider hop).
		this.sql.exec(
			`INSERT INTO provider_observations
			 (run_key, market, phase, action_id, status, payload_json, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			scope.runKey,
			scope.market,
			scope.phase,
			actionId,
			payload.status,
			JSON.stringify(payload),
			now,
		);

		this.sql.exec(
			`UPDATE provider_reservations
			 SET status = ?
			 WHERE run_key = ? AND market = ? AND phase = ? AND action_id = ?`,
			payload.status === 'completed' ? 'observed' : payload.status,
			scope.runKey,
			scope.market,
			scope.phase,
			actionId,
		);

		return 'inserted';
	}

	getObservation(
		scope: ResearchRunScope,
		actionId: string,
	): ProviderObservationPayload | null {
		const rows = [
			...this.sql.exec<{ payload_json: string }>(
				`SELECT payload_json
				 FROM provider_observations
				 WHERE run_key = ? AND market = ? AND phase = ? AND action_id = ?`,
				scope.runKey,
				scope.market,
				scope.phase,
				actionId,
			),
		];
		if (rows.length === 0) {
			return null;
		}
		return JSON.parse(rows[0]!.payload_json) as ProviderObservationPayload;
	}

	getSelectedSourceIds(scope: ResearchRunScope): string[] {
		return this.getSelectedSources(scope).map((source) => source.sourceId);
	}

	listObservations(scope: ResearchRunScope): ProviderObservationPayload[] {
		const rows = [
			...this.sql.exec<{ action_id: string; payload_json: string }>(
				`SELECT action_id, payload_json
				 FROM provider_observations
				 WHERE run_key = ? AND market = ? AND phase = ?
				 ORDER BY action_id ASC`,
				scope.runKey,
				scope.market,
				scope.phase,
			),
		];
		return rows.map((row) => JSON.parse(row.payload_json) as ProviderObservationPayload);
	}

	getSelectedSources(scope: ResearchRunScope): SelectedSearchSource[] {
		const fromObservations = new Map<string, SelectedSearchSource>();
		for (const observation of this.listObservations(scope)) {
			for (const selected of observation.selectedSources ?? []) {
				fromObservations.set(selected.sourceId, selected);
			}
		}
		if (fromObservations.size > 0) {
			return [...fromObservations.values()].sort((left, right) =>
				left.sourceId.localeCompare(right.sourceId),
			);
		}

		// Legacy rows written before observation-payload consolidation.
		const rows = [
			...this.sql.exec<{ source_id: string; selection_json: string }>(
				`SELECT source_id, selection_json
				 FROM selected_search_results
				 WHERE run_key = ? AND market = ? AND phase = ?
				 ORDER BY source_id ASC`,
				scope.runKey,
				scope.market,
				scope.phase,
			),
		];
		return rows.map((row) => JSON.parse(row.selection_json) as SelectedSearchSource);
	}

	getRetainedArtifacts(scope: ResearchRunScope): {
		receipts: ProviderCallReceipt[];
		sources: SourceRecord[];
		evidence: EvidenceExcerpt[];
	} {
		const receiptsById = new Map<string, ProviderCallReceipt>();
		const sourcesById = new Map<string, SourceRecord>();
		const evidenceById = new Map<string, EvidenceExcerpt>();

		for (const observation of this.listObservations(scope)) {
			for (const receipt of observation.receipts ?? []) {
				receiptsById.set(receipt.receiptId, receipt);
			}
			for (const source of observation.sources ?? []) {
				sourcesById.set(source.sourceId, source);
			}
			for (const evidence of observation.evidence ?? []) {
				evidenceById.set(evidence.evidenceId, evidence);
			}
		}

		// Legacy fan-out tables (pre-consolidation runs).
		if (receiptsById.size === 0) {
			for (const row of this.sql.exec<{ receipt_json: string }>(
				`SELECT receipt_json
				 FROM provider_receipts
				 WHERE run_key = ? AND market = ? AND phase = ?
				 ORDER BY receipt_id ASC`,
				scope.runKey,
				scope.market,
				scope.phase,
			)) {
				const receipt = JSON.parse(row.receipt_json) as ProviderCallReceipt;
				receiptsById.set(receipt.receiptId, receipt);
			}
		}
		if (sourcesById.size === 0) {
			for (const row of this.sql.exec<{ source_json: string }>(
				`SELECT source_json
				 FROM source_records
				 WHERE run_key = ? AND market = ? AND phase = ?
				 ORDER BY source_id ASC`,
				scope.runKey,
				scope.market,
				scope.phase,
			)) {
				const source = JSON.parse(row.source_json) as SourceRecord;
				sourcesById.set(source.sourceId, source);
			}
		}
		if (evidenceById.size === 0) {
			for (const row of this.sql.exec<{ evidence_json: string }>(
				`SELECT evidence_json
				 FROM evidence_records
				 WHERE run_key = ? AND market = ? AND phase = ?
				 ORDER BY evidence_id ASC`,
				scope.runKey,
				scope.market,
				scope.phase,
			)) {
				const evidence = JSON.parse(row.evidence_json) as EvidenceExcerpt;
				evidenceById.set(evidence.evidenceId, evidence);
			}
		}

		return {
			receipts: [...receiptsById.values()].sort((left, right) =>
				left.receiptId.localeCompare(right.receiptId),
			),
			sources: [...sourcesById.values()].sort((left, right) =>
				left.sourceId.localeCompare(right.sourceId),
			),
			evidence: [...evidenceById.values()].sort((left, right) =>
				left.evidenceId.localeCompare(right.evidenceId),
			),
		};
	}

	assertArtifactScope(scope: ResearchRunScope, artifactMarket: Market): void {
		if (artifactMarket !== scope.market) {
			throw new ResearchRunRepositoryError(
				'cross_market_scope',
				`Artifact market ${artifactMarket} does not match scope ${scope.market}`,
			);
		}
	}

	appendTransition(
		_scope: ResearchRunScope,
		_transition: StateTransitionRecord,
	): void {
		// Intentionally no-op: transition logs are debug-only write amp.
		// Checkpoint revision + observation payloads are the durable resume source of truth.
	}
}

export function createScope(runKey: string, market: Market): ResearchRunScope {
	return { runKey, market, phase: DISCOVERY_PHASE };
}
