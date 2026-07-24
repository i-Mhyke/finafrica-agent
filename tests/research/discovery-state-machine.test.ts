import { describe, expect, it } from 'vitest';
import {
	createInitialDiscoveryCheckpoint,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
	type DiscoveryAction,
} from '../../.flue/research/discovery-lifecycle-schemas';
import {
	attachPendingAction,
	commitReservation,
	recordNoProgress,
	transitionDiscovery,
} from '../../.flue/research/discovery-state-machine';

function baseCheckpoint() {
	return createInitialDiscoveryCheckpoint({
		runKey: 'scan-1',
		workflowInstanceId: 'wf-1',
		market: 'nigeria',
		maxRequests: 20,
		maxCostUsd: 5,
	});
}

function searchAction(): DiscoveryAction {
	return {
		type: 'search',
		query: 'nigeria monetary policy',
		vertical: 'monetary-policy',
		tier: 1,
		resultCount: 5,
	};
}

function reserveSearch(checkpoint: ReturnType<typeof baseCheckpoint>) {
	const actionId = 'scan-1:nigeria:action:1';
	const withPending = attachPendingAction(checkpoint, {
		actionId,
		action: searchAction(),
		reservedAt: '2026-07-24T00:00:00Z',
	});
	return commitReservation(withPending, actionId);
}

describe('discovery state machine', () => {
	it('transitions from reservation to observation and back to decision-pending', () => {
		const reserved = reserveSearch(baseCheckpoint());
		expect(reserved.state).toBe('search-reserved');
		expect(reserved.actionIndex).toBe(1);
		expect(reserved.budget.requestsReserved).toBe(1);

		const observed = transitionDiscovery(reserved, {
			type: 'observation_recorded',
			actionId: 'scan-1:nigeria:action:1',
			receiptIds: ['rcpt_1'],
			selectedSourceIds: ['src_1'],
			searchQuery: 'nigeria monetary policy',
		});

		expect(observed.state).toBe('decision-pending');
		expect(observed.pendingAction).toBeNull();
		expect(observed.budget.searchesUsed).toBe(1);
		expect(observed.selectedSourceIds).toEqual(['src_1']);
		expect(observed.receiptIds).toEqual(['rcpt_1']);
	});

	it('rejects reservation without a pending action', () => {
		expect(() =>
			transitionDiscovery(baseCheckpoint(), {
				type: 'reservation_committed',
				actionId: 'scan-1:nigeria:action:1',
			}),
		).toThrow(/authorized action/);
	});

	it('rejects duplicate pending reservations', () => {
		const checkpoint = attachPendingAction(baseCheckpoint(), {
			actionId: 'scan-1:nigeria:action:1',
			action: searchAction(),
			reservedAt: '2026-07-24T00:00:00Z',
		});
		expect(() =>
			attachPendingAction(checkpoint, {
				actionId: 'scan-1:nigeria:action:2',
				action: searchAction(),
				reservedAt: '2026-07-24T00:00:01Z',
			}),
		).toThrow(/already attached/);
	});

	it('rejects counter rollback via search budget overflow', () => {
		let checkpoint = baseCheckpoint();
		for (let index = 0; index < 2; index += 1) {
			const actionId = `scan-1:nigeria:action:${index + 1}`;
			checkpoint = attachPendingAction(checkpoint, {
				actionId,
				action: { ...searchAction(), query: `query-${index}` },
				reservedAt: '2026-07-24T00:00:00Z',
			});
			checkpoint = commitReservation(checkpoint, actionId);
			checkpoint = transitionDiscovery(checkpoint, {
				type: 'observation_recorded',
				actionId,
				receiptIds: [`rcpt_${index}`],
				searchQuery: `query-${index}`,
			});
		}

		const actionId = 'scan-1:nigeria:action:3';
		checkpoint = attachPendingAction(checkpoint, {
			actionId,
			action: searchAction(),
			reservedAt: '2026-07-24T00:00:00Z',
		});
		checkpoint = commitReservation(checkpoint, actionId);
		expect(() =>
			transitionDiscovery(checkpoint, {
				type: 'observation_recorded',
				actionId,
				receiptIds: ['rcpt_overflow'],
				searchQuery: 'overflow',
			}),
		).toThrow(/Search budget exceeded/);
	});

	it('records provider outcome unknown without replaying the action', () => {
		const reserved = reserveSearch(baseCheckpoint());
		const unknown = transitionDiscovery(reserved, {
			type: 'observation_unknown',
			actionId: 'scan-1:nigeria:action:1',
		});
		expect(unknown.state).toBe('decision-pending');
		expect(unknown.pendingAction).toBeNull();
		expect(unknown.failure?.errorClass).toBe('provider_outcome_unknown');
		expect(unknown.budget.searchesUsed).toBe(0);
	});

	it('commits terminal state once and blocks further transitions', () => {
		let checkpoint = baseCheckpoint();
		const terminal = transitionDiscovery(checkpoint, {
			type: 'terminal_accepted',
			result: {
				runKey: 'scan-1',
				market: 'nigeria',
				coverage: {
					market: 'nigeria',
					searchesPerformed: 0,
					signalsFound: 0,
					sourceIds: [],
					status: 'no-signals',
				},
				receipts: [],
				sources: [],
				evidence: [],
				briefs: [],
			},
		});
		expect(terminal.state).toBe('completed-no-signal');
		checkpoint = terminal;

		expect(() =>
			transitionDiscovery(checkpoint, {
				type: 'force_finalization',
				reason: 'late',
			}),
		).toThrow(/terminal/);
	});

	it('rejects cross-market terminal results', () => {
		expect(() =>
			transitionDiscovery(baseCheckpoint(), {
				type: 'terminal_accepted',
				result: {
					runKey: 'scan-1',
					market: 'ghana',
					coverage: {
						market: 'ghana',
						searchesPerformed: 0,
						signalsFound: 0,
						sourceIds: [],
						status: 'no-signals',
					},
					receipts: [],
					sources: [],
					evidence: [],
					briefs: [],
				},
			}),
		).toThrow(/market/);
	});

	it('increments no-progress count when fingerprint is unchanged', () => {
		const checkpoint = baseCheckpoint();
		const fingerprint = checkpoint.progressFingerprint;
		const next = recordNoProgress(checkpoint, fingerprint);
		expect(next.noProgressCount).toBe(1);
	});

	it('rejects semantic decision overflow during reservation', () => {
		let checkpoint = baseCheckpoint();
		checkpoint = {
			...checkpoint,
			actionIndex: DISCOVERY_MAX_SEMANTIC_DECISIONS,
		};
		checkpoint = attachPendingAction(checkpoint, {
			actionId: 'scan-1:nigeria:action:overflow',
			action: searchAction(),
			reservedAt: '2026-07-24T00:00:00Z',
		});
		expect(() => commitReservation(checkpoint, 'scan-1:nigeria:action:overflow')).toThrow(
			/Semantic decision budget exhausted/,
		);
	});
});
