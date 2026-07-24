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
	InMemorySqlClient,
} from '../../workers/research-control-plane/src/state/memory-research-run-store';
import {
	ResearchRunRepository,
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

	it('initRun tolerates concurrent market initialization', () => {
		const { repository } = setup();
		const input = {
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market: 'nigeria' as const,
			maxRequests: 20,
			maxCostUsd: 5,
			now: '2026-07-24T00:00:00Z',
		};
		const first = repository.initRun(input);
		const second = repository.initRun({
			...input,
			now: '2026-07-24T00:00:01Z',
		});
		expect(second.revision).toBe(first.revision);
		expect(second.state).toBe(first.state);
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
			receipts: [receipt(actionId, 'nigeria')],
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
		expect(repository.getRetainedArtifacts(scope).receipts).toHaveLength(1);
	});

	it('limits provider observation persistence to reservation + observation rows', () => {
		const client = new InMemorySqlClient();
		let writes = 0;
		const counting = {
			exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]) {
				const normalized = query.trim().toUpperCase();
				if (normalized.startsWith('INSERT') || normalized.startsWith('UPDATE')) {
					writes += 1;
				}
				return client.exec<T>(query, ...bindings);
			},
		};
		const repository = new ResearchRunRepository(counting);
		const scope = createScope('scan-1', 'nigeria');
		repository.initRun({
			runKey: 'scan-1',
			workflowInstanceId: 'wf-1',
			market: 'nigeria',
			maxRequests: 20,
			maxCostUsd: 5,
			now: '2026-07-24T00:00:00Z',
		});
		writes = 0;

		const actionId = 'scan-1:nigeria:action:1';
		repository.reserveProviderAction(
			scope,
			{
				actionId,
				action: {
					type: 'search',
					query: 'nigeria rates',
					vertical: 'monetary-policy',
					tier: 1,
					resultCount: 5,
				},
				reservedAt: '2026-07-24T00:00:00Z',
			},
			'2026-07-24T00:00:01Z',
		);
		repository.saveObservation(
			scope,
			actionId,
			{
				status: 'completed',
				receiptIds: ['rcpt_1', 'rcpt_2'],
				sourceIds: ['src_1', 'src_2', 'src_3'],
				evidenceIds: ['ev_1', 'ev_2'],
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
				receipts: [receipt('1', 'nigeria'), receipt('2', 'nigeria')],
				sources: [
					{
						sourceId: 'src_1',
						canonicalUrl: 'https://cbn.gov.ng/a',
						title: 'A',
						publisher: null,
						author: null,
						publishedAt: null,
						retrievedAt: '2026-07-24T00:00:01Z',
						market: 'nigeria',
						tier: 1,
						sourceType: 'primary',
						receiptIds: ['rcpt_1'],
						contentHash: null,
						rightsNote: null,
					},
					{
						sourceId: 'src_2',
						canonicalUrl: 'https://cbn.gov.ng/b',
						title: 'B',
						publisher: null,
						author: null,
						publishedAt: null,
						retrievedAt: '2026-07-24T00:00:01Z',
						market: 'nigeria',
						tier: 1,
						sourceType: 'primary',
						receiptIds: ['rcpt_1'],
						contentHash: null,
						rightsNote: null,
					},
					{
						sourceId: 'src_3',
						canonicalUrl: 'https://cbn.gov.ng/c',
						title: 'C',
						publisher: null,
						author: null,
						publishedAt: null,
						retrievedAt: '2026-07-24T00:00:01Z',
						market: 'nigeria',
						tier: 1,
						sourceType: 'primary',
						receiptIds: ['rcpt_2'],
						contentHash: null,
						rightsNote: null,
					},
				],
				evidence: [
					{
						evidenceId: 'ev_1',
						sourceId: 'src_1',
						text: 'excerpt one',
						supports: [],
						capturedAt: '2026-07-24T00:00:01Z',
					},
					{
						evidenceId: 'ev_2',
						sourceId: 'src_2',
						text: 'excerpt two',
						supports: [],
						capturedAt: '2026-07-24T00:00:01Z',
					},
				],
			},
			'2026-07-24T00:00:02Z',
		);

		// 1 reservation insert + 1 observation insert + 1 reservation status update.
		// Previously this also fanned out into discovery_actions + N artifact tables.
		expect(writes).toBe(3);
		expect(repository.getRetainedArtifacts(scope).sources).toHaveLength(3);
		expect(repository.getRetainedArtifacts(scope).evidence).toHaveLength(2);
		repository.appendTransition(scope, {
			transitionId: 't1',
			fromRevision: 0,
			toRevision: 1,
			eventType: 'noop',
			reason: null,
			createdAt: '2026-07-24T00:00:03Z',
		});
		expect(writes).toBe(3);
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
