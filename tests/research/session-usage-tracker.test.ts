import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FlueObservation } from '@flue/runtime';

const observers: Array<(observation: FlueObservation) => void> = [];

vi.mock('@flue/runtime', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@flue/runtime')>();
	return {
		...actual,
		observe: (subscriber: (observation: FlueObservation) => void) => {
			observers.push(subscriber);
			return () => {
				const index = observers.indexOf(subscriber);
				if (index >= 0) observers.splice(index, 1);
			};
		},
	};
});

import {
	recordObservationUsage,
	sessionMatchesUsageTracking,
	startSessionUsageTracking,
	usageFromAccumulator,
} from '../../.flue/research/session-usage-tracker';

function emitObservation(observation: FlueObservation): void {
	for (const observer of [...observers]) {
		observer(observation);
	}
}

describe('session usage tracker', () => {
	beforeEach(() => {
		observers.length = 0;
	});

	it('matches parent and delegated task sessions', () => {
		expect(sessionMatchesUsageTracking('brief-validator:brief_1', 'brief-validator:brief_1')).toBe(
			true,
		);
		expect(
			sessionMatchesUsageTracking(
				'brief-validator:brief_1',
				'task:brief-validator:brief_1:abc',
			),
		).toBe(true);
		expect(sessionMatchesUsageTracking('brief-validator:brief_1', 'brief-validator:brief_2')).toBe(
			false,
		);
	});

	it('accumulates turn and operation usage for the tracked session', async () => {
		const tracker = startSessionUsageTracking('brief-validator:brief_accept');
		emitObservation({
			type: 'turn',
			session: 'task:brief-validator:brief_accept:task-1',
			turnId: 'turn_1',
			purpose: 'agent',
			durationMs: 10,
			request: {} as never,
			response: {
				usage: { input: 9000, output: 100, cost: { total: 0.005 } },
			},
			isError: false,
			v: 3,
			eventIndex: 1,
			timestamp: '2026-07-24T00:00:00.000Z',
		});
		emitObservation({
			type: 'operation',
			session: 'task:brief-validator:brief_accept:task-1',
			operationId: 'op_1',
			operationKind: 'task',
			durationMs: 10,
			isError: true,
			usage: { input: 458, output: 20, cost: { total: 0.0012 } },
			v: 3,
			eventIndex: 2,
			timestamp: '2026-07-24T00:00:01.000Z',
		});
		emitObservation({
			type: 'turn',
			session: 'brief-validator:other',
			turnId: 'turn_other',
			purpose: 'agent',
			durationMs: 10,
			request: {} as never,
			response: {
				usage: { input: 999, output: 999, cost: { total: 9 } },
			},
			isError: false,
			v: 3,
			eventIndex: 3,
			timestamp: '2026-07-24T00:00:02.000Z',
		});

		await Promise.resolve();
		expect(tracker.stop()).toEqual({
			input: 9458,
			output: 120,
			costUsd: 0.0062,
		});
	});

	it('returns null when no usage was observed', () => {
		const accumulator = { input: 0, output: 0, costUsd: 0 };
		recordObservationUsage('brief-validator:brief_accept', accumulator, {
			type: 'turn',
			session: 'brief-validator:other',
			turnId: 'turn_other',
			purpose: 'agent',
			durationMs: 1,
			request: {} as never,
			response: {
				usage: { input: 10, output: 1, cost: { total: 0.01 } },
			},
			isError: false,
			v: 3,
			eventIndex: 1,
			timestamp: '2026-07-24T00:00:00.000Z',
		});
		expect(usageFromAccumulator(accumulator)).toBeNull();
	});
});
