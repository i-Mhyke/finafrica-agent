import { describe, expect, it, vi } from 'vitest';
import { createTestRepository } from '../../workers/research-control-plane/src/state/memory-research-run-store';
import {
	createMarketDiscoveryStore,
	runMarketDiscoveryLoop,
} from '../../workers/research-control-plane/src/workflows/run-market-discovery';
import type { FlueClient } from '../../workers/research-control-plane/src/flue-client';

import type { ProviderCallReceipt } from '../../.flue/research/schemas';

function validReceipt(overrides: Partial<ProviderCallReceipt> = {}): ProviderCallReceipt {
	return {
		receiptId: 'rcpt_1',
		callKey: 'call_1',
		provider: 'exa',
		providerRequestId: null,
		operation: 'search',
		mode: 'search',
		phase: 'discovery',
		briefId: null,
		market: 'nigeria',
		query: 'nigeria rates',
		requestedUrls: [],
		sourceTier: 1,
		requestedAt: '2026-07-24T00:00:00Z',
		completedAt: '2026-07-24T00:00:01Z',
		resultUrls: [],
		costUsd: 0.01,
		latencyMs: 10,
		status: 'succeeded',
		fallbackReason: null,
		usage: {
			computeUnits: null,
			externalTransferGbytes: null,
			proxySerps: null,
		},
		...overrides,
	};
}

const request = {
	runKey: 'scan-durable-1',
	trigger: 'manual' as const,
	window: { start: '2026-07-22T00:00:00Z', end: '2026-07-23T00:00:00Z' },
	focus: null,
	maxDiscoveredBriefs: 30,
	maxAcceptedBriefs: 10,
	maxProviderCostUsd: 5,
};

describe('durable discovery workflow loop', () => {
	it('terminates a market with submit-no-signal and retains monotonic revisions', async () => {
		const repository = createTestRepository();
		const store = createMarketDiscoveryStore(repository);
		const flue: FlueClient = {
			runDiscoveryDecision: vi.fn().mockResolvedValue({
				action: { type: 'submit-no-signal', reasonCodes: ['no_primary_signal'] },
			}),
			runDiscoveryProviderAction: vi.fn(),
			runDiscoveryFinalization: vi.fn(),
			continueMarketIntelligenceScan: vi.fn(),
		};

		const result = await runMarketDiscoveryLoop({
			request,
			market: 'nigeria',
			workflowInstanceId: 'wf-1',
			maxRequests: 20,
			store,
			flue,
		});

		expect(result.coverage.status).toBe('no-signals');
		expect(result.receipts).toEqual([]);
		expect(flue.runDiscoveryProviderAction).not.toHaveBeenCalled();
		const checkpoint = repository.getCheckpoint(request.runKey, 'nigeria');
		expect(checkpoint?.state).toBe('completed-no-signal');
		expect(checkpoint?.revision).toBeGreaterThan(0);
	});

	it('retries checkpoint persistence after a stale revision conflict', async () => {
		const repository = createTestRepository();
		const store = createMarketDiscoveryStore(repository);
		let intercepted = false;
		const originalSave = store.saveCheckpoint.bind(store);
		store.saveCheckpoint = async (checkpoint, expectedRevision) => {
			if (!intercepted) {
				intercepted = true;
				const current = repository.getCheckpoint(checkpoint.runKey, checkpoint.market)!;
				const bumped = { ...current, revision: current.revision + 1 };
				repository.compareAndSwapCheckpoint(bumped, current.revision, '2026-07-24T00:00:01Z');
			}
			return originalSave(checkpoint, expectedRevision);
		};
		const flue: FlueClient = {
			runDiscoveryDecision: vi.fn().mockResolvedValue({
				action: { type: 'submit-no-signal', reasonCodes: ['no_primary_signal'] },
			}),
			runDiscoveryProviderAction: vi.fn(),
			runDiscoveryFinalization: vi.fn(),
			continueMarketIntelligenceScan: vi.fn(),
		};

		const result = await runMarketDiscoveryLoop({
			request,
			market: 'nigeria',
			workflowInstanceId: 'wf-1',
			maxRequests: 20,
			store,
			flue,
		});

		expect(result.coverage.status).toBe('no-signals');
		const checkpoint = repository.getCheckpoint(request.runKey, 'nigeria');
		expect(checkpoint?.state).toBe('completed-no-signal');
	});

	it('replays committed provider observations after resume without a second provider call', async () => {
		const repository = createTestRepository();
		const store = createMarketDiscoveryStore(repository);
		const provider = vi.fn().mockResolvedValue({
			actionId: 'scan-durable-1:nigeria:action:1',
			status: 'ok',
			receipts: [validReceipt()],
			selectedSourceIds: ['src_1'],
			selectedSources: [
				{
					sourceId: 'src_1',
					url: 'https://cbn.gov.ng/documents/circular-2026',
					tier: 1,
					market: 'nigeria',
				},
			],
			searchQuery: 'nigeria rates',
			sources: [],
			evidence: [],
		});

		let decisionCount = 0;
		const flue: FlueClient = {
			runDiscoveryDecision: vi.fn().mockImplementation(async () => {
				decisionCount += 1;
				if (decisionCount === 1) {
					return {
						action: {
							type: 'search',
							query: 'nigeria rates',
							vertical: 'monetary-policy',
							tier: 1,
							resultCount: 5,
						},
					};
				}
				return {
					action: { type: 'submit-no-signal', reasonCodes: ['no_primary_signal'] },
				};
			}),
			runDiscoveryProviderAction: provider,
			runDiscoveryFinalization: vi.fn(),
			continueMarketIntelligenceScan: vi.fn(),
		};

		await runMarketDiscoveryLoop({
			request,
			market: 'nigeria',
			workflowInstanceId: 'wf-1',
			maxRequests: 20,
			store,
			flue,
		});

		const checkpoint = repository.getCheckpoint(request.runKey, 'nigeria');
		expect(checkpoint?.budget.searchesUsed).toBe(1);
		expect(provider).toHaveBeenCalledTimes(1);

		await runMarketDiscoveryLoop({
			request,
			market: 'nigeria',
			workflowInstanceId: 'wf-1',
			maxRequests: 20,
			store,
			flue,
		});
		expect(provider).toHaveBeenCalledTimes(1);
	});
});
