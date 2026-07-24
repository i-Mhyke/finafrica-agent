import type { DiscoveryRunRequest, Market, MarketDiscoveryResult } from '../../../.flue/research/schemas';
import { effectiveProviderRequestLimit } from '../../../.flue/research/schemas';

export interface Env {
	RESEARCH_ADMIN_TOKEN: string;
	RESEARCH_RUN_STATE: DurableObjectNamespace;
	MARKET_INTELLIGENCE_SCAN: Workflow;
	PUBLICATION_AGENT: Fetcher;
}

export interface ScanAdmission {
	workflowInstanceId: string;
	runKey: string;
	status: 'accepted';
}

export interface ScanStatus {
	workflowInstanceId: string;
	runKey: string;
	status: 'running' | 'completed' | 'failed';
	markets: Partial<Record<Market, { state: string; revision: number }>>;
}

export function durableRunId(runKey: string): string {
	return `durable:${runKey}`;
}

export function maxDiscoveryRequests(request: DiscoveryRunRequest): number {
	return effectiveProviderRequestLimit(request.maxProviderRequests);
}

export type TerminalMarketState =
	| 'completed-signal'
	| 'completed-no-signal'
	| 'failed';

export function isTerminalDiscoveryState(state: string): state is TerminalMarketState {
	return (
		state === 'completed-signal' ||
		state === 'completed-no-signal' ||
		state === 'failed'
	);
}

export function mergeMarketDiscoveryResults(
	runKey: string,
	results: MarketDiscoveryResult[],
): MarketDiscoveryResult[] {
	return results.filter((result) => result.runKey === runKey);
}
