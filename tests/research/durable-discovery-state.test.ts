import { describe, expect, it, vi } from 'vitest';
import {
	attachPendingAction,
	commitReservation,
	transitionDiscovery,
} from '../../.flue/research/discovery-state-machine';
import {
	createInitialDiscoveryCheckpoint,
	type DiscoveryMarketCheckpoint,
} from '../../.flue/research/discovery-lifecycle-schemas';
import {
	createScope,
	createTestRepository,
} from '../../workers/research-control-plane/src/state/memory-research-run-store';
import {
	ResearchRunRepositoryError,
} from '../../workers/research-control-plane/src/state/research-run-repository';
import type { ProviderCallReceipt } from '../../.flue/research/schemas';

function receipt(actionId: string, market: 'nigeria' | 'ghana'): ProviderCallReceipt {
	return {
		receiptId: `rcpt_${actionId}`,
		callKey: `call_${actionId}`,
		provider: 'exa',
		providerRequestId: null,
		operation: 'search',
		mode: 'search',
		phase: 'discovery',
		briefId: null,
		market,
		query: 'nigeria rates',
		requestedUrls: [],
		sourceTier: 1,
		requestedAt: '2026-07-24T00:00:00Z',
		completedAt: '2026-07-24T00:00:01Z',
		resultUrls: [],
		costUsd: 0.01,
		latencyMs: 120,
		status: 'succeeded',
		fallbackReason: null,
		usage: {
			computeUnits: null,
			externalTransferGbytes: null,
			proxySerps: null,
		},
	};
}

describe('durable discovery state', () => {
	function setup(market: 'nigeria' | 'ghana' = 'nigeria') {
		const repository = createTestRepository();
		const scope = createScope('scan-1', market);
		const checkpoint = repository.initRun({
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market,
			maxRequests: 20,
			maxCostUsd: 5,
			now: '2026-07-24T00:00:00Z',
		});
		return { repository, scope, checkpoint };
	}

	it('replays committed observations without calling the provider twice', () => {
		const { repository, scope } = setup();
		const actionId = 'scan-1:nigeria:action:1';
		const provider = vi.fn();

		repository.reserveProviderAction(scope, {
			actionId,
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			reservedAt: '2026-07-24T00:00:00Z',
		});

		const payload = {
			status: 'completed' as const,
			receiptIds: ['rcpt_1'],
			selectedSourceIds: ['src_1'],
			searchQuery: 'nigeria rates',
			receipts: [receipt(actionId, 'nigeria')],
		};

		const first = repository.saveObservation(scope, actionId, payload);
		provider();
		const second = repository.saveObservation(scope, actionId, payload);

		expect(first).toBe('inserted');
		expect(second).toBe('existing');
		expect(provider).toHaveBeenCalledTimes(1);
		expect(repository.getObservation(scope, actionId)).toEqual(payload);
	});

	it('rejects duplicate action reservations', () => {
		const { repository, scope } = setup();
		const pending = {
			actionId: 'scan-1:nigeria:action:1',
			action: {
				type: 'search' as const,
				query: 'nigeria rates',
				vertical: 'monetary-policy' as const,
				tier: 1 as const,
				resultCount: 5,
			},
			reservedAt: '2026-07-24T00:00:00Z',
		};
		repository.reserveProviderAction(scope, pending);
		expect(() => repository.reserveProviderAction(scope, pending)).toThrow(
			ResearchRunRepositoryError,
		);
	});

	it('rejects stale checkpoint revisions', () => {
		const { repository } = setup();
		const checkpoint = repository.getCheckpoint('scan-1', 'nigeria')!;
		const writerA = { ...checkpoint, revision: checkpoint.revision + 1 };
		const writerB = { ...checkpoint, revision: checkpoint.revision + 1 };
		repository.compareAndSwapCheckpoint(writerA, checkpoint.revision, '2026-07-24T00:00:01Z');

		expect(() =>
			repository.compareAndSwapCheckpoint(writerB, checkpoint.revision, '2026-07-24T00:00:02Z'),
		).toThrow(/Stale checkpoint revision/);
	});

	it('rejects cross-market artifact scope', () => {
		const { repository, scope } = setup('nigeria');
		const actionId = 'scan-1:nigeria:action:1';
		repository.reserveProviderAction(scope, {
			actionId,
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			reservedAt: '2026-07-24T00:00:00Z',
		});

		expect(() =>
			repository.saveObservation(scope, actionId, {
				status: 'completed',
				receiptIds: ['rcpt_gh'],
				receipts: [receipt(actionId, 'ghana')],
			}),
		).toThrow(/cross_market_scope|Artifact market ghana/);
	});

	it('rejects terminal checkpoint overwrite', () => {
		const { repository } = setup();
		let checkpoint = repository.getCheckpoint('scan-1', 'nigeria')!;
		checkpoint = transitionDiscovery(checkpoint, {
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
		repository.compareAndSwapCheckpoint(checkpoint, 0, '2026-07-24T00:00:01Z');

		const next: DiscoveryMarketCheckpoint = {
			...checkpoint,
			revision: checkpoint.revision + 1,
			state: 'decision-pending',
		};
		expect(() =>
			repository.compareAndSwapCheckpoint(next, checkpoint.revision, '2026-07-24T00:00:02Z'),
		).toThrow(/Terminal checkpoint cannot be overwritten/);
	});

	it('rejects counter rollback on checkpoint save', () => {
		const { repository } = setup();
		let checkpoint = repository.getCheckpoint('scan-1', 'nigeria')!;
		const withPending = attachPendingAction(checkpoint, {
			actionId: 'scan-1:nigeria:action:1',
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			reservedAt: '2026-07-24T00:00:00Z',
		});
		checkpoint = commitReservation(withPending, 'scan-1:nigeria:action:1');
		checkpoint = transitionDiscovery(checkpoint, {
			type: 'observation_recorded',
			actionId: 'scan-1:nigeria:action:1',
			receiptIds: ['rcpt_1'],
			searchQuery: 'nigeria rates',
		});

		const persisted = { ...checkpoint, revision: checkpoint.revision - 2 };
		repository.compareAndSwapCheckpoint(persisted, 0, '2026-07-24T00:00:01Z');

		const rolledBack = {
			...persisted,
			revision: persisted.revision + 1,
			budget: {
				...persisted.budget,
				searchesUsed: 0,
			},
		};
		expect(() =>
			repository.compareAndSwapCheckpoint(rolledBack, persisted.revision, '2026-07-24T00:00:02Z'),
		).toThrow(/Search counter rollback/);
	});

	it('requires reservation before provider observation', () => {
		const { repository, scope } = setup();
		expect(() =>
			repository.saveObservation(scope, 'scan-1:nigeria:action:1', {
				status: 'completed',
				receiptIds: [],
			}),
		).toThrow(/was not reserved/);
	});

	it('persists selected search results for fetch eligibility after resume', () => {
		const { repository, scope } = setup();
		const actionId = 'scan-1:nigeria:action:1';
		repository.reserveProviderAction(scope, {
			actionId,
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			reservedAt: '2026-07-24T00:00:00Z',
		});
		repository.saveObservation(scope, actionId, {
			status: 'completed',
			receiptIds: ['rcpt_1'],
			selectedSourceIds: ['src_1', 'src_2'],
			selectedSources: [
				{
					sourceId: 'src_1',
					url: 'https://cbn.gov.ng/a',
					tier: 1,
					market: 'nigeria',
				},
				{
					sourceId: 'src_2',
					url: 'https://cbn.gov.ng/b',
					tier: 1,
					market: 'nigeria',
				},
			],
			searchQuery: 'nigeria rates',
		});

		expect(repository.getSelectedSourceIds(scope)).toEqual(['src_1', 'src_2']);
		expect(repository.getSelectedSources(scope)).toEqual([
			{
				sourceId: 'src_1',
				url: 'https://cbn.gov.ng/a',
				tier: 1,
				market: 'nigeria',
			},
			{
				sourceId: 'src_2',
				url: 'https://cbn.gov.ng/b',
				tier: 1,
				market: 'nigeria',
			},
		]);
	});

	it('keeps nigeria and ghana checkpoints independent', () => {
		const repository = createTestRepository();
		const nigeria = repository.initRun({
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market: 'nigeria',
			maxRequests: 20,
			maxCostUsd: 5,
			now: '2026-07-24T00:00:00Z',
		});
		const ghana = repository.initRun({
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market: 'ghana',
			maxRequests: 20,
			maxCostUsd: 5,
			now: '2026-07-24T00:00:00Z',
		});

		expect(nigeria.market).toBe('nigeria');
		expect(ghana.market).toBe('ghana');
		expect(repository.getCheckpoint('scan-1', 'nigeria')?.market).toBe('nigeria');
		expect(repository.getCheckpoint('scan-1', 'ghana')?.market).toBe('ghana');
	});
});
