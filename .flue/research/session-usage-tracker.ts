import { observe, type FlueObservation } from '@flue/runtime';

export interface SalvagedTaskUsage {
	input: number;
	output: number;
	costUsd: number;
}

interface UsageAccumulator {
	input: number;
	output: number;
	costUsd: number;
}

function emptyAccumulator(): UsageAccumulator {
	return { input: 0, output: 0, costUsd: 0 };
}

export function sessionMatchesUsageTracking(
	trackedSession: string,
	eventSession: string | undefined,
): boolean {
	if (!eventSession) return false;
	if (eventSession === trackedSession) return true;
	return eventSession.startsWith(`task:${trackedSession}:`);
}

export function mergePromptUsage(
	accumulator: UsageAccumulator,
	usage: { input?: number; output?: number; cost?: { total?: number } } | undefined,
): void {
	if (!usage) return;
	if (typeof usage.input === 'number') accumulator.input += usage.input;
	if (typeof usage.output === 'number') accumulator.output += usage.output;
	if (typeof usage.cost?.total === 'number') accumulator.costUsd += usage.cost.total;
}

export function usageFromAccumulator(
	accumulator: UsageAccumulator,
): SalvagedTaskUsage | null {
	if (accumulator.input === 0 && accumulator.output === 0 && accumulator.costUsd === 0) {
		return null;
	}
	return {
		input: accumulator.input,
		output: accumulator.output,
		costUsd: accumulator.costUsd,
	};
}

export function recordObservationUsage(
	trackedSession: string,
	accumulator: UsageAccumulator,
	observation: FlueObservation,
): void {
	if (!sessionMatchesUsageTracking(trackedSession, observation.session)) return;

	if (observation.type === 'turn') {
		mergePromptUsage(accumulator, observation.response?.usage);
		return;
	}
	if (observation.type === 'operation') {
		mergePromptUsage(accumulator, observation.usage);
	}
}

export function startSessionUsageTracking(sessionName: string): {
	stop: () => SalvagedTaskUsage | null;
} {
	const accumulator = emptyAccumulator();
	let stopped = false;
	const unsubscribe = observe((observation) => {
		recordObservationUsage(sessionName, accumulator, observation);
	});

	return {
		stop() {
			if (stopped) return usageFromAccumulator(accumulator);
			stopped = true;
			unsubscribe();
			return usageFromAccumulator(accumulator);
		},
	};
}
