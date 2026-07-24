import {
	BudgetExhaustedError,
	ProviderError,
	ProviderRequestLimitError,
} from '../providers/web-research/provider-errors';
import {
	MAX_EVIDENCE_EXCERPT_CHARS,
	MAX_NORMALIZED_CONTENT_CHARS,
} from '../providers/web-research/provider';
import type { CostAwareWebResearchRouter, BudgetTracker } from '../providers/web-research/router';
import type {
	DiscoveryFetchAction,
	DiscoverySearchAction,
} from './discovery-lifecycle-schemas';
import { deriveCallKey, deriveSourceId } from './ids';
import { ResearchArtifactLedger, type ResearchArtifact } from './ledger';
import { getAllowedDomains, getTier1Domains } from './market-policy';
import type {
	EvidenceExcerpt,
	Market,
	ProviderCallReceipt,
	SourceRecord,
	SourceTier,
} from './schemas';
import {
	DISCOVERY_FETCHES_PER_MARKET,
	DISCOVERY_SEARCHES_PER_MARKET,
} from './schemas';
import type { ToolClock, DiscoveryToolScope } from '../tools/research-tools';

export type DiscoveryProviderStatus =
	| 'ok'
	| 'limit-reached'
	| 'budget-exhausted'
	| 'invalid-selection'
	| 'provider_timeout'
	| 'provider_rate_limit'
	| 'provider_error'
	| 'provider_outcome_unknown';

export interface DiscoverySelectedSource {
	sourceId: string;
	url: string;
	tier: SourceTier;
	market: Market;
}

export interface DiscoveryProviderCapacity {
	searchesUsed: number;
	fetchesUsed: number;
	maxSearches: number;
	maxFetches: number;
	terminalStop?: 'limit-reached' | 'budget-exhausted' | null;
}

export interface DiscoverySearchExecutionResult {
	status: DiscoveryProviderStatus;
	query: string;
	results: Array<{
		sourceId: string;
		url: string;
		title: string;
		publishedAt: string | null;
		highlights: string[];
	}>;
	selectedSources: DiscoverySelectedSource[];
	receipts: ProviderCallReceipt[];
}

export interface DiscoveryFetchExecutionResult {
	status: DiscoveryProviderStatus;
	sources: Array<{
		sourceId: string;
		evidenceId: string;
		url: string;
		title: string;
		excerpt: string;
		publishedAt: string | null;
		tier: SourceTier;
		sourceType: 'primary' | 'secondary' | 'social';
		receiptIds: string[];
		contentHash: string;
	}>;
	receipts: ProviderCallReceipt[];
	ledgerArtifacts: ResearchArtifact[];
	sourceRecords: SourceRecord[];
	evidenceRecords: EvidenceExcerpt[];
}

export function classifyDiscoveryProviderFailure(error: unknown): DiscoveryProviderStatus {
	if (error instanceof BudgetExhaustedError || error instanceof ProviderRequestLimitError) {
		return 'budget-exhausted';
	}
	if (error instanceof ProviderError) {
		if (error.statusCode === 429) {
			return 'provider_rate_limit';
		}
		if (error.statusCode !== null && error.statusCode >= 500) {
			return 'provider_error';
		}
		if (error.name === 'AbortError' || /timeout/i.test(error.message)) {
			return 'provider_timeout';
		}
		return 'provider_error';
	}
	if (error instanceof DOMException && error.name === 'AbortError') {
		return 'provider_timeout';
	}
	if (error instanceof Error && /timeout/i.test(error.message)) {
		return 'provider_timeout';
	}
	return 'provider_outcome_unknown';
}

function assertCapacity(
	capacity: DiscoveryProviderCapacity,
	toolName: string,
): void {
	if (capacity.terminalStop) {
		throw new DiscoveryProviderTerminalError(toolName, capacity.terminalStop);
	}
}

export class DiscoveryProviderTerminalError extends Error {
	constructor(
		readonly toolName: string,
		readonly reason: 'limit-reached' | 'budget-exhausted',
	) {
		super(`Discovery provider ${toolName} is terminal: ${reason}`);
		this.name = 'DiscoveryProviderTerminalError';
	}
}

export async function executeDiscoverySearchAction(deps: {
	router: CostAwareWebResearchRouter;
	budget: BudgetTracker;
	clock: ToolClock;
	scope: DiscoveryToolScope;
	action: DiscoverySearchAction;
	capacity: DiscoveryProviderCapacity;
	marketSearchCount: number;
	attempt: number;
	signal?: AbortSignal;
}): Promise<DiscoverySearchExecutionResult> {
	const { action, capacity, scope } = deps;
	assertCapacity(capacity, 'search');
	if (capacity.searchesUsed >= capacity.maxSearches) {
		capacity.terminalStop = 'limit-reached';
		throw new DiscoveryProviderTerminalError('search', 'limit-reached');
	}
	if (deps.budget.exhausted) {
		throw new DiscoveryProviderTerminalError('search', 'budget-exhausted');
	}

	const abortSignal = deps.signal ?? AbortSignal.timeout(60_000);
	const market = scope.market;
	const callKey = await deriveCallKey({
		runKey: scope.runKey,
		briefId: null,
		market,
		phase: 'discovery',
		operation: 'search',
		queryOrUrl: action.query,
		provider: 'exa',
		mode: 'search',
		attempt: deps.attempt,
	});

	try {
		const response = await deps.router.search(
			{
				query: action.query,
				market,
				tier: action.tier,
				domains:
					deps.marketSearchCount === 0
						? [...getTier1Domains(market)]
						: getAllowedDomains(market, action.tier),
				startDate: scope.windowStart,
				endDate: scope.windowEnd,
				maxResults: action.resultCount,
				phase: 'discovery',
				briefId: null,
				callKey,
				attempt: deps.attempt,
			},
			abortSignal,
			deps.budget,
		);

		const selectedSources: DiscoverySelectedSource[] = [];
		const results = await Promise.all(
			response.results.map(async (result) => {
				const sourceId = await deriveSourceId(result.url);
				selectedSources.push({
					sourceId,
					url: result.url,
					tier: action.tier,
					market,
				});
				return {
					sourceId,
					url: result.url,
					title: result.title,
					publishedAt: result.publishedAt,
					highlights: result.highlights,
				};
			}),
		);

		capacity.searchesUsed += 1;

		return {
			status: 'ok',
			query: action.query,
			results,
			selectedSources,
			receipts: [response.receipt],
		};
	} catch (error) {
		return {
			status: classifyDiscoveryProviderFailure(error),
			query: action.query,
			results: [],
			selectedSources: [],
			receipts: [],
		};
	}
}

export async function executeDiscoveryFetchAction(deps: {
	router: CostAwareWebResearchRouter;
	budget: BudgetTracker;
	clock: ToolClock;
	scope: DiscoveryToolScope;
	action: DiscoveryFetchAction;
	capacity: DiscoveryProviderCapacity;
	selectedSources: Map<string, DiscoverySelectedSource>;
	attemptBase: number;
	ledger?: ResearchArtifactLedger;
	signal?: AbortSignal;
}): Promise<DiscoveryFetchExecutionResult> {
	const { action, capacity } = deps;
	assertCapacity(capacity, 'fetch');
	if (capacity.fetchesUsed + action.sourceIds.length > capacity.maxFetches) {
		capacity.terminalStop = 'limit-reached';
		throw new DiscoveryProviderTerminalError('fetch', 'limit-reached');
	}

	const selections = action.sourceIds.map((sourceId) => deps.selectedSources.get(sourceId));
	if (selections.some((selection) => !selection)) {
		return {
			status: 'invalid-selection',
			sources: [],
			receipts: [],
			ledgerArtifacts: [],
			sourceRecords: [],
			evidenceRecords: [],
		};
	}

	if (deps.budget.exhausted) {
		throw new DiscoveryProviderTerminalError('fetch', 'budget-exhausted');
	}

	const abortSignal = deps.signal ?? AbortSignal.timeout(60_000);
	const ledger = deps.ledger ?? new ResearchArtifactLedger();
	const sources = [];
	const receipts: ProviderCallReceipt[] = [];
	const ledgerArtifacts: ResearchArtifact[] = [];

	for (let index = 0; index < selections.length; index++) {
		const selection = selections[index]!;
		const { url, tier: selectedTier, market } = selection;
		const attempt = deps.attemptBase + index + 1;
		const callKey = await deriveCallKey({
			runKey: deps.scope.runKey,
			briefId: null,
			market,
			phase: 'discovery',
			operation: 'fetch',
			queryOrUrl: url,
			provider: 'exa',
			mode: 'highlights',
			attempt,
		});

		try {
			const response = await deps.router.fetch(
				{
					url,
					market,
					tier: selectedTier,
					mode: 'highlights',
					evidenceQuestion: action.evidenceQuestion,
					maxCharacters: Math.min(action.maxCharacters, MAX_EVIDENCE_EXCERPT_CHARS),
					phase: 'discovery',
					briefId: null,
					callKey,
					attempt,
				},
				abortSignal,
				deps.budget,
			);

			const artifact = await ledger.recordFetch(
				{
					url,
					market,
					tier: selectedTier,
					mode: 'highlights',
					evidenceQuestion: action.evidenceQuestion,
					maxCharacters: Math.min(action.maxCharacters, MAX_EVIDENCE_EXCERPT_CHARS),
					phase: 'discovery',
					briefId: null,
					callKey,
					attempt,
				},
				response,
				deps.clock.now(),
			);
			ledgerArtifacts.push(artifact);
			sources.push({
				sourceId: artifact.source.sourceId,
				evidenceId: artifact.evidence.evidenceId,
				url: response.finalUrl,
				title: response.title,
				excerpt: artifact.evidence.text,
				publishedAt: response.publishedAt,
				tier: artifact.source.tier,
				sourceType: artifact.source.sourceType,
				receiptIds: artifact.source.receiptIds,
				contentHash: artifact.source.contentHash ?? '',
			});
			receipts.push(response.receipt);
		} catch (error) {
			return {
				status: classifyDiscoveryProviderFailure(error),
				sources: [],
				receipts,
				ledgerArtifacts,
				sourceRecords: ledgerArtifacts.map((artifact) => artifact.source),
				evidenceRecords: ledgerArtifacts.map((artifact) => artifact.evidence),
			};
		}
	}

	capacity.fetchesUsed += action.sourceIds.length;

	return {
		status: 'ok',
		sources,
		receipts,
		ledgerArtifacts,
		sourceRecords: ledgerArtifacts.map((artifact) => artifact.source),
		evidenceRecords: ledgerArtifacts.map((artifact) => artifact.evidence),
	};
}

export function createDiscoveryProviderCapacity(
	overrides: Partial<DiscoveryProviderCapacity> = {},
): DiscoveryProviderCapacity {
	return {
		searchesUsed: 0,
		fetchesUsed: 0,
		maxSearches: DISCOVERY_SEARCHES_PER_MARKET,
		maxFetches: DISCOVERY_FETCHES_PER_MARKET,
		terminalStop: null,
		...overrides,
	};
}

export const DISCOVERY_FETCH_MAX_CHARACTERS = MAX_NORMALIZED_CONTENT_CHARS;
