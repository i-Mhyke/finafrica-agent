import { describe, expect, it } from 'vitest';
import {
	createInitialDiscoveryCheckpoint,
	DISCOVERY_MAX_FINALIZATION_REPAIRS,
	DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
	DISCOVERY_MAX_SEMANTIC_DECISIONS,
} from '../../.flue/research/discovery-lifecycle-schemas';
import {
	detectNoProgress,
	fingerprintDiscoveryProgress,
	superviseDiscoveryAction,
} from '../../.flue/research/discovery-supervisor';
import discoveryPortfolioFixture from '../fixtures/research/discovery-portfolio.json';

function baseCheckpoint() {
	return createInitialDiscoveryCheckpoint({
		runKey: 'scan-1',
		workflowInstanceId: 'wf-1',
		market: 'nigeria',
		maxRequests: 20,
		maxCostUsd: 5,
	});
}

describe('discovery supervisor', () => {
	it('authorizes a search action with a deterministic action id', () => {
		const decision = superviseDiscoveryAction(baseCheckpoint(), {
			type: 'search',
			query: 'nigeria rates',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(decision).toEqual({
			type: 'execute',
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			actionId: 'scan-1:nigeria:action:1',
		});
	});

	it('rejects fetch for unknown source ids', () => {
		const decision = superviseDiscoveryAction(baseCheckpoint(), {
			type: 'fetch',
			sourceIds: ['src_missing'],
			evidenceQuestion: 'What changed?',
			freshnessMode: 'strict',
			maxCharacters: 1000,
		});
		expect(decision.type).toBe('redirect');
		if (decision.type === 'redirect') {
			expect(decision.errors[0]?.code).toBe('action_not_allowed');
		}
	});

	it('rejects duplicate search queries', () => {
		const checkpoint = {
			...baseCheckpoint(),
			completedSearchQueries: ['nigeria rates'],
		};
		const decision = superviseDiscoveryAction(checkpoint, {
			type: 'search',
			query: 'nigeria rates',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(decision.type).toBe('redirect');
		if (decision.type === 'redirect') {
			expect(decision.errors[0]?.code).toBe('duplicate_search_query');
		}
	});

	it('forces finalization when semantic decision budget is exhausted', () => {
		const checkpoint = {
			...baseCheckpoint(),
			actionIndex: DISCOVERY_MAX_SEMANTIC_DECISIONS,
		};
		const decision = superviseDiscoveryAction(checkpoint, {
			type: 'search',
			query: 'late search',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(decision).toEqual({
			type: 'force-finalize',
			reason: 'semantic_decision_limit',
		});
	});

	it('forces finalization when no-progress budget is exhausted', () => {
		const checkpoint = {
			...baseCheckpoint(),
			noProgressCount: DISCOVERY_MAX_NO_PROGRESS_DECISIONS,
		};
		const decision = superviseDiscoveryAction(checkpoint, {
			type: 'search',
			query: 'another search',
			vertical: 'monetary-policy',
			tier: 1,
			resultCount: 5,
		});
		expect(decision).toEqual({
			type: 'force-finalize',
			reason: 'no_progress_limit',
		});
	});

	it('accepts submit-no-signal as a terminal decision', () => {
		const decision = superviseDiscoveryAction(baseCheckpoint(), {
			type: 'submit-no-signal',
			reasonCodes: ['no_primary_signal'],
		});
		expect(decision.type).toBe('terminal');
		if (decision.type === 'terminal') {
			expect(decision.result.coverage.status).toBe('no-signals');
			expect(decision.result.briefs).toEqual([]);
		}
	});

	it('redirects invalid candidate briefs and fails after repair budget exhaustion', () => {
		const brief = discoveryPortfolioFixture.briefs[0];
		const invalidCandidate = {
			runKey: 'scan-1',
			market: 'nigeria' as const,
			coverage: {
				market: 'nigeria' as const,
				searchesPerformed: 1,
				signalsFound: 1,
				sourceIds: ['src_missing'],
				status: 'covered' as const,
			},
			briefs: [
				{
					...brief,
					discoverySourceIds: ['src_missing'],
					discoveryEvidenceIds: ['ev_missing'],
				},
			],
		};

		const first = superviseDiscoveryAction(baseCheckpoint(), {
			type: 'submit-candidate',
			candidate: invalidCandidate,
		});
		expect(first.type).toBe('redirect');
		if (first.type === 'redirect') {
			expect(first.errors[0]?.code).toBe('terminal_provenance_missing');
		}

		const exhausted = superviseDiscoveryAction(
			{
				...baseCheckpoint(),
				state: 'repair-pending',
				finalizationRepairCount: DISCOVERY_MAX_FINALIZATION_REPAIRS,
			},
			{
				type: 'submit-candidate',
				candidate: invalidCandidate,
			},
		);
		expect(exhausted.type).toBe('fail');
		if (exhausted.type === 'fail') {
			expect(exhausted.failure.errorClass).toBe('terminal_validation_exhausted');
		}
	});

	it('detects unchanged semantic progress fingerprints', () => {
		const checkpoint = baseCheckpoint();
		const fingerprint = fingerprintDiscoveryProgress(checkpoint);
		expect(detectNoProgress(checkpoint, fingerprint)).toBe(true);
		expect(
			detectNoProgress(
				{
					...checkpoint,
					receiptIds: ['rcpt_1'],
				},
				fingerprint,
			),
		).toBe(false);
	});

	it('rejects actions while a pending provider action exists', () => {
		const checkpoint = {
			...baseCheckpoint(),
			pendingAction: {
				actionId: 'scan-1:nigeria:action:1',
				action: {
					type: 'search' as const,
					query: 'pending',
					vertical: 'monetary-policy' as const,
					tier: 1 as const,
					resultCount: 5,
				},
				reservedAt: '2026-07-24T00:00:00Z',
			},
		};
		const decision = superviseDiscoveryAction(checkpoint, {
			type: 'submit-no-signal',
			reasonCodes: ['done'],
		});
		expect(decision.type).toBe('redirect');
		if (decision.type === 'redirect') {
			expect(decision.errors[0]?.code).toBe('pending_action_exists');
		}
	});

	it('hydrates terminal no-signal with retained artifacts', () => {
		const retained = {
			receipts: [
				{
					receiptId: 'rcpt_1',
					callKey: 'call_1',
					provider: 'exa' as const,
					providerRequestId: null,
					operation: 'search' as const,
					mode: 'search' as const,
					phase: 'discovery' as const,
					briefId: null,
					market: 'nigeria' as const,
					query: 'nigeria rates',
					requestedUrls: [] as string[],
					sourceTier: 1 as const,
					requestedAt: '2026-07-24T00:00:00Z',
					completedAt: '2026-07-24T00:00:01Z',
					resultUrls: [] as string[],
					costUsd: 0.01,
					latencyMs: 10,
					status: 'succeeded' as const,
					fallbackReason: null,
					usage: {
						computeUnits: null,
						externalTransferGbytes: null,
						proxySerps: null,
					},
				},
			],
			sources: [],
			evidence: [],
		};
		const decision = superviseDiscoveryAction(
			baseCheckpoint(),
			{ type: 'submit-no-signal', reasonCodes: ['no_primary_signal'] },
			retained,
		);
		expect(decision.type).toBe('terminal');
		if (decision.type === 'terminal') {
			expect(decision.result.receipts).toHaveLength(1);
			expect(decision.result.receipts[0]?.receiptId).toBe('rcpt_1');
		}
	});
});
