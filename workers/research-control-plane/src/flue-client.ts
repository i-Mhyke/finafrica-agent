import type { DiscoveryAction } from '../../../.flue/research/discovery-lifecycle-schemas';
import type {
	DiscoveryRunRequest,
	EvidenceExcerpt,
	Market,
	MarketDiscoveryResult,
	ProviderCallReceipt,
	SourceRecord,
} from '../../../.flue/research/schemas';

export type FlueProviderActionStatus =
	| 'ok'
	| 'provider_timeout'
	| 'provider_rate_limit'
	| 'provider_error'
	| 'provider_outcome_unknown';

export interface FlueProviderActionResult {
	actionId: string;
	status: FlueProviderActionStatus;
	receipts: ProviderCallReceipt[];
	selectedSourceIds: string[];
	selectedSources: Array<{
		sourceId: string;
		url: string;
		tier: 1 | 2 | 3;
		market: Market;
	}>;
	searchQuery?: string;
	sources: SourceRecord[];
	evidence: EvidenceExcerpt[];
}

export interface FlueDecisionResult {
	action: DiscoveryAction;
}

export interface FlueClient {
	runDiscoveryDecision(input: {
		request: DiscoveryRunRequest;
		market: Market;
		checkpoint: unknown;
		allowedActionTypes: DiscoveryAction['type'][];
		redirectErrors: Array<{ code: string; message: string }>;
	}): Promise<FlueDecisionResult>;

	runDiscoveryProviderAction(input: {
		request: DiscoveryRunRequest;
		market: Market;
		actionId: string;
		action: DiscoveryAction;
		searchesUsed: number;
		fetchesUsed: number;
		marketSearchCount: number;
		selectedSources: Array<{
			sourceId: string;
			url: string;
			tier: 1 | 2 | 3;
			market: Market;
		}>;
	}): Promise<FlueProviderActionResult>;

	runDiscoveryFinalization(input: {
		request: DiscoveryRunRequest;
		market: Market;
		checkpoint: unknown;
		validationErrors: Array<{ code: string; message: string }>;
	}): Promise<FlueDecisionResult>;

	continueMarketIntelligenceScan(input: {
		request: DiscoveryRunRequest;
		discovery: {
			runKey: string;
			results: MarketDiscoveryResult[];
		};
	}): Promise<unknown>;
}

export function createFlueServiceClient(fetcher: Fetcher, adminToken: string): FlueClient {
	async function invokeWorkflow<T>(workflowName: string, input: unknown): Promise<T> {
		const response = await fetcher.fetch(
			`https://publication-agent.internal/workflows/${workflowName}?wait=result`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${adminToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(input),
			},
		);
		if (!response.ok) {
			throw new Error(`Flue workflow ${workflowName} failed: ${response.status}`);
		}
		const payload = (await response.json()) as { result?: T } & T;
		return (payload.result ?? payload) as T;
	}

	return {
		runDiscoveryDecision: async (input) => {
			const action = await invokeWorkflow<DiscoveryAction>(
				'research-discovery-decision',
				input,
			);
			return { action };
		},
		runDiscoveryProviderAction: (input) =>
			invokeWorkflow<FlueProviderActionResult>('research-discovery-provider-action', input),
		runDiscoveryFinalization: async (input) => {
			const action = await invokeWorkflow<DiscoveryAction>(
				'research-discovery-finalization',
				input,
			);
			return { action };
		},
		continueMarketIntelligenceScan: (input) =>
			invokeWorkflow('continue-market-intelligence-scan', input),
	};
}
