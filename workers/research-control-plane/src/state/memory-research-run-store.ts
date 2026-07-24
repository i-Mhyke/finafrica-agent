import {
	createScope,
	ResearchRunRepository,
	type SqlClient,
} from './research-run-repository';

export class InMemorySqlClient implements SqlClient {
	private readonly tables = new Map<string, Array<Record<string, unknown>>>();
	private lastChanges = 0;

	exec<T extends Record<string, unknown>>(
		query: string,
		...bindings: unknown[]
	): Iterable<T> {
		const normalized = query.trim().replace(/\s+/g, ' ');

		if (normalized.startsWith('SELECT changes()')) {
			return [{ changes: this.lastChanges }] as unknown as T[];
		}

		this.lastChanges = 0;

		if (normalized.startsWith('INSERT OR IGNORE INTO discovery_runs')) {
			const [runKey, workflowInstanceId, createdAt] = bindings;
			const rows = this.table('discovery_runs');
			if (!rows.some((row) => row.run_key === runKey)) {
				rows.push({
					run_key: runKey,
					workflow_instance_id: workflowInstanceId,
					created_at: createdAt,
				});
				this.lastChanges = 1;
			}
			return [];
		}

		if (normalized.startsWith('INSERT OR IGNORE INTO market_checkpoints')) {
			const [runKey, market, phase, revision, checkpointJson, , updatedAt] = bindings;
			const rows = this.table('market_checkpoints');
			const exists = rows.some(
				(row) =>
					row.run_key === runKey && row.market === market && row.phase === phase,
			);
			if (!exists) {
				rows.push({
					run_key: runKey,
					market,
					phase,
					revision,
					checkpoint_json: checkpointJson,
					terminal_committed: 0,
					updated_at: updatedAt,
				});
				this.lastChanges = 1;
			}
			return [];
		}

		if (normalized.startsWith('INSERT INTO market_checkpoints')) {
			const [runKey, market, phase, revision, checkpointJson, , updatedAt] = bindings;
			this.table('market_checkpoints').push({
				run_key: runKey,
				market,
				phase,
				revision,
				checkpoint_json: checkpointJson,
				terminal_committed: 0,
				updated_at: updatedAt,
			});
			this.lastChanges = 1;
			return [];
		}

		if (normalized.startsWith('SELECT checkpoint_json FROM market_checkpoints')) {
			const [runKey, market, phase] = bindings;
			return this.table('market_checkpoints')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.map((row) => ({ checkpoint_json: row.checkpoint_json })) as unknown as T[];
		}

		if (normalized.startsWith('SELECT revision, terminal_committed FROM market_checkpoints')) {
			const [runKey, market, phase] = bindings;
			return this.table('market_checkpoints')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.map((row) => ({
					revision: row.revision,
					terminal_committed: row.terminal_committed,
				})) as unknown as T[];
		}

		if (normalized.startsWith('UPDATE market_checkpoints')) {
			const [
				revision,
				checkpointJson,
				terminalCommitted,
				updatedAt,
				runKey,
				market,
				phase,
				expectedRevision,
			] = bindings;
			const rows = this.table('market_checkpoints');
			const index = rows.findIndex(
				(row) =>
					row.run_key === runKey &&
					row.market === market &&
					row.phase === phase &&
					row.revision === expectedRevision,
			);
			if (index === -1) {
				this.lastChanges = 0;
				return [];
			}
			rows[index] = {
				...rows[index]!,
				revision,
				checkpoint_json: checkpointJson,
				terminal_committed: terminalCommitted,
				updated_at: updatedAt,
			};
			this.lastChanges = 1;
			return [];
		}

		if (normalized.startsWith('SELECT changes()')) {
			return [{ changes: this.lastChanges }] as unknown as T[];
		}

		if (normalized.startsWith('SELECT action_id FROM provider_reservations')) {
			const [runKey, market, phase, actionId] = bindings;
			return this.table('provider_reservations')
				.filter(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.action_id === actionId,
				)
				.map((row) => ({ action_id: row.action_id })) as unknown as T[];
		}

		if (normalized.startsWith('INSERT INTO discovery_actions')) {
			this.table('discovery_actions').push({
				run_key: bindings[0],
				market: bindings[1],
				phase: bindings[2],
				action_id: bindings[3],
				action_json: bindings[4],
				created_at: bindings[5],
			});
			return [];
		}

		if (normalized.startsWith('INSERT INTO provider_reservations')) {
			this.table('provider_reservations').push({
				run_key: bindings[0],
				market: bindings[1],
				phase: bindings[2],
				action_id: bindings[3],
				reserved_at: bindings[4],
				status: bindings[5] ?? 'reserved',
			});
			this.lastChanges = 1;
			return [];
		}

		if (normalized.startsWith('SELECT action_id, payload_json FROM provider_observations')) {
			const [runKey, market, phase] = bindings;
			return this.table('provider_observations')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.action_id).localeCompare(String(right.action_id)),
				)
				.map((row) => ({
					action_id: row.action_id,
					payload_json: row.payload_json,
				})) as unknown as T[];
		}

		if (normalized.startsWith('SELECT payload_json FROM provider_observations')) {
			const [runKey, market, phase, actionId] = bindings;
			return this.table('provider_observations')
				.filter(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.action_id === actionId,
				)
				.map((row) => ({ payload_json: row.payload_json })) as unknown as T[];
		}

		if (normalized.startsWith('INSERT INTO provider_observations')) {
			this.table('provider_observations').push({
				run_key: bindings[0],
				market: bindings[1],
				phase: bindings[2],
				action_id: bindings[3],
				status: bindings[4],
				payload_json: bindings[5],
				observed_at: bindings[6],
			});
			this.lastChanges = 1;
			return [];
		}

		if (normalized.startsWith('UPDATE provider_reservations')) {
			const [status, runKey, market, phase, actionId] = bindings;
			const row = this.table('provider_reservations').find(
				(candidate) =>
					candidate.run_key === runKey &&
					candidate.market === market &&
					candidate.phase === phase &&
					candidate.action_id === actionId,
			);
			if (row) {
				row.status = status;
				this.lastChanges = 1;
			}
			return [];
		}

		if (normalized.startsWith('INSERT OR IGNORE INTO provider_receipts')) {
			const [runKey, market, phase, receiptId, receiptJson, actionId, createdAt] = bindings;
			const rows = this.table('provider_receipts');
			if (
				!rows.some(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.receipt_id === receiptId,
				)
			) {
				rows.push({
					run_key: runKey,
					market,
					phase,
					receipt_id: receiptId,
					receipt_json: receiptJson,
					action_id: actionId,
					created_at: createdAt,
				});
			}
			return [];
		}

		if (normalized.startsWith('INSERT OR IGNORE INTO source_records')) {
			const [runKey, market, phase, sourceId, sourceJson, createdAt] = bindings;
			const rows = this.table('source_records');
			if (
				!rows.some(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.source_id === sourceId,
				)
			) {
				rows.push({
					run_key: runKey,
					market,
					phase,
					source_id: sourceId,
					source_json: sourceJson,
					created_at: createdAt,
				});
			}
			return [];
		}

		if (normalized.startsWith('INSERT OR IGNORE INTO evidence_records')) {
			const [runKey, market, phase, evidenceId, evidenceJson, createdAt] = bindings;
			const rows = this.table('evidence_records');
			if (
				!rows.some(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.evidence_id === evidenceId,
				)
			) {
				rows.push({
					run_key: runKey,
					market,
					phase,
					evidence_id: evidenceId,
					evidence_json: evidenceJson,
					created_at: createdAt,
				});
			}
			return [];
		}

		if (normalized.startsWith('INSERT OR IGNORE INTO selected_search_results')) {
			const [runKey, market, phase, sourceId, selectionJson, searchQuery, selectedAt] =
				bindings;
			const rows = this.table('selected_search_results');
			if (
				!rows.some(
					(row) =>
						row.run_key === runKey &&
						row.market === market &&
						row.phase === phase &&
						row.source_id === sourceId,
				)
			) {
				rows.push({
					run_key: runKey,
					market,
					phase,
					source_id: sourceId,
					selection_json: selectionJson,
					search_query: searchQuery,
					selected_at: selectedAt,
				});
			}
			return [];
		}

		if (normalized.startsWith('SELECT source_id, selection_json FROM selected_search_results')) {
			const [runKey, market, phase] = bindings;
			return this.table('selected_search_results')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.source_id).localeCompare(String(right.source_id)),
				)
				.map((row) => ({
					source_id: row.source_id,
					selection_json: row.selection_json,
				})) as unknown as T[];
		}

		if (normalized.startsWith('SELECT receipt_json FROM provider_receipts')) {
			const [runKey, market, phase] = bindings;
			return this.table('provider_receipts')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.receipt_id).localeCompare(String(right.receipt_id)),
				)
				.map((row) => ({ receipt_json: row.receipt_json })) as unknown as T[];
		}

		if (normalized.startsWith('SELECT source_json FROM source_records')) {
			const [runKey, market, phase] = bindings;
			return this.table('source_records')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.source_id).localeCompare(String(right.source_id)),
				)
				.map((row) => ({ source_json: row.source_json })) as unknown as T[];
		}

		if (normalized.startsWith('SELECT evidence_json FROM evidence_records')) {
			const [runKey, market, phase] = bindings;
			return this.table('evidence_records')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.evidence_id).localeCompare(String(right.evidence_id)),
				)
				.map((row) => ({ evidence_json: row.evidence_json })) as unknown as T[];
		}

		if (normalized.startsWith('SELECT source_id FROM selected_search_results')) {
			const [runKey, market, phase] = bindings;
			return this.table('selected_search_results')
				.filter(
					(row) =>
						row.run_key === runKey && row.market === market && row.phase === phase,
				)
				.sort((left, right) =>
					String(left.source_id).localeCompare(String(right.source_id)),
				)
				.map((row) => ({ source_id: row.source_id })) as unknown as T[];
		}

		if (normalized.startsWith('INSERT INTO state_transitions')) {
			this.table('state_transitions').push({
				run_key: bindings[0],
				market: bindings[1],
				phase: bindings[2],
				transition_id: bindings[3],
				transition_json: bindings[4],
				created_at: bindings[5],
			});
			return [];
		}

		return [];
	}

	private table(name: string): Array<Record<string, unknown>> {
		if (!this.tables.has(name)) {
			this.tables.set(name, []);
		}
		return this.tables.get(name)!;
	}
}

export function createTestRepository(): ResearchRunRepository {
	return new ResearchRunRepository(new InMemorySqlClient());
}

export { createScope };
