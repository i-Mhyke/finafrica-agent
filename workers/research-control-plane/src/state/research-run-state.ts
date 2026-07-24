import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { DiscoveryMarketCheckpoint } from '../../../../.flue/research/discovery-lifecycle-schemas';
import type { DiscoveryPendingAction } from '../../../../.flue/research/discovery-lifecycle-schemas';
import type { Market } from '../../../../.flue/research/schemas';
import {
	createScope,
	ResearchRunRepository,
	type ProviderObservationPayload,
	type ResearchRunScope,
	type StateTransitionRecord,
} from './research-run-repository';

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS discovery_runs (
		run_key TEXT NOT NULL,
		workflow_instance_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key)
	)`,
	`CREATE TABLE IF NOT EXISTS market_checkpoints (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		revision INTEGER NOT NULL,
		checkpoint_json TEXT NOT NULL,
		terminal_committed INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase)
	)`,
	`CREATE TABLE IF NOT EXISTS discovery_actions (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		action_id TEXT NOT NULL,
		action_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, action_id)
	)`,
	`CREATE TABLE IF NOT EXISTS provider_reservations (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		action_id TEXT NOT NULL,
		reserved_at TEXT NOT NULL,
		status TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, action_id)
	)`,
	`CREATE TABLE IF NOT EXISTS provider_observations (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		action_id TEXT NOT NULL,
		status TEXT NOT NULL,
		payload_json TEXT NOT NULL,
		observed_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, action_id)
	)`,
	`CREATE TABLE IF NOT EXISTS selected_search_results (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		source_id TEXT NOT NULL,
		selection_json TEXT NOT NULL,
		search_query TEXT NOT NULL,
		selected_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, source_id)
	)`,
	`CREATE TABLE IF NOT EXISTS source_records (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		source_id TEXT NOT NULL,
		source_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, source_id)
	)`,
	`CREATE TABLE IF NOT EXISTS evidence_records (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		evidence_id TEXT NOT NULL,
		evidence_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, evidence_id)
	)`,
	`CREATE TABLE IF NOT EXISTS provider_receipts (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		receipt_id TEXT NOT NULL,
		receipt_json TEXT NOT NULL,
		action_id TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, receipt_id)
	)`,
	`CREATE TABLE IF NOT EXISTS state_transitions (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		transition_id TEXT NOT NULL,
		transition_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, transition_id)
	)`,
	`CREATE TABLE IF NOT EXISTS validation_findings (
		run_key TEXT NOT NULL,
		market TEXT NOT NULL,
		phase TEXT NOT NULL DEFAULT 'discovery',
		finding_id TEXT NOT NULL,
		finding_json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		PRIMARY KEY (run_key, market, phase, finding_id)
	)`,
];

export class ResearchRunState extends DurableObject<Env> {
	private repository: ResearchRunRepository;
	private schemaLoaded = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.repository = new ResearchRunRepository({
			exec: <T extends Record<string, unknown>>(query: string, ...bindings: unknown[]) =>
				this.ctx.storage.sql.exec(query, ...bindings).toArray() as unknown as T[],
		});
	}

	private ensureSchema(): void {
		if (this.schemaLoaded) {
			return;
		}
		this.repository.ensureSchema(SCHEMA_STATEMENTS);
		this.schemaLoaded = true;
	}

	async initMarket(input: {
		runKey: string;
		workflowInstanceId: string;
		market: Market;
		maxRequests: number;
		maxCostUsd: number;
	}): Promise<DiscoveryMarketCheckpoint> {
		this.ensureSchema();
		return this.repository.initRun({
			...input,
			now: new Date().toISOString(),
		});
	}

	async getCheckpoint(runKey: string, market: Market): Promise<DiscoveryMarketCheckpoint | null> {
		this.ensureSchema();
		return this.repository.getCheckpoint(runKey, market);
	}

	async saveObservation(
		scope: ResearchRunScope,
		actionId: string,
		payload: ProviderObservationPayload,
	): Promise<'inserted' | 'existing'> {
		this.ensureSchema();
		return this.ctx.storage.transactionSync(() =>
			this.repository.saveObservation(scope, actionId, payload, new Date().toISOString()),
		);
	}

	async reserveProviderAction(
		scope: ResearchRunScope,
		pending: DiscoveryPendingAction,
	): Promise<void> {
		this.ensureSchema();
		this.ctx.storage.transactionSync(() => {
			this.repository.reserveProviderAction(scope, pending, new Date().toISOString());
		});
	}

	async saveCheckpoint(
		checkpoint: DiscoveryMarketCheckpoint,
		expectedRevision: number,
	): Promise<DiscoveryMarketCheckpoint> {
		this.ensureSchema();
		return this.ctx.storage.transactionSync(() =>
			this.repository.compareAndSwapCheckpoint(
				checkpoint,
				expectedRevision,
				new Date().toISOString(),
			),
		);
	}

	async getObservation(
		scope: ResearchRunScope,
		actionId: string,
	): Promise<ProviderObservationPayload | null> {
		this.ensureSchema();
		return this.repository.getObservation(scope, actionId);
	}

	async getSelectedSourceIds(scope: ResearchRunScope): Promise<string[]> {
		this.ensureSchema();
		return this.repository.getSelectedSourceIds(scope);
	}

	async getSelectedSources(scope: ResearchRunScope) {
		this.ensureSchema();
		return this.repository.getSelectedSources(scope);
	}

	async getRetainedArtifacts(scope: ResearchRunScope) {
		this.ensureSchema();
		return this.repository.getRetainedArtifacts(scope);
	}

	async appendTransition(
		scope: ResearchRunScope,
		transition: StateTransitionRecord,
	): Promise<void> {
		this.ensureSchema();
		this.repository.appendTransition(scope, transition);
	}
}

export { createScope, createTestRepository } from './memory-research-run-store';
export { ResearchRunRepository, ResearchRunRepositoryError } from './research-run-repository';
