import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { deriveCallKey, deriveSourceId } from '../research/ids';
import {
	getAllowedDomains,
	getTier1Domains,
	MANDATORY_MARKETS,
	VERTICALS,
} from '../research/market-policy';
import type { CostAwareWebResearchRouter, BudgetTracker } from '../providers/web-research/router';
import {
	MAX_EVIDENCE_EXCERPT_CHARS,
	MAX_NORMALIZED_CONTENT_CHARS,
} from '../providers/web-research/provider';
import type { Market, SourceTier } from '../research/schemas';
import {
	DISCOVERY_FETCHES_PER_MARKET,
	DISCOVERY_SEARCHES_PER_MARKET,
	DEEP_RESEARCH_FETCHES_PER_MARKET,
	DEEP_RESEARCH_SEARCHES_PER_MARKET,
	ProviderCallReceiptSchema,
	REMEDIATION_FETCHES_PER_MARKET,
	REMEDIATION_SEARCHES_PER_MARKET,
	RESEARCH_PROVIDER_DEFAULT_RUN_USD,
	RESEARCH_PROVIDER_HARD_RUN_USD,
} from '../research/schemas';
import { ResearchArtifactLedger } from '../research/ledger';
import {
	createDiscoveryProviderCapacity,
	DiscoveryProviderTerminalError,
	executeDiscoveryFetchAction,
	executeDiscoverySearchAction,
	type DiscoverySelectedSource,
} from '../research/discovery-provider-executor';

const MAX_VALIDATION_SEARCHES_PER_BRIEF = 1;
const MAX_SEARCH_RESULTS = 10;
const MAX_FETCH_URLS = 10;
const DEEP_RESEARCH_START_DATE = '2000-01-01T00:00:00Z';

const ToolStatusSchema = v.picklist([
	'ok',
	'limit-reached',
	'budget-exhausted',
	'invalid-selection',
]);

export type ResearchToolTerminalReason = 'limit-reached' | 'budget-exhausted';

export class ResearchToolTerminalError extends Error {
	constructor(
		readonly toolName: string,
		readonly reason: ResearchToolTerminalReason,
	) {
		super(
			`Research tool ${toolName} returned ${reason}; stop tool use and finish the task.`,
		);
		this.name = 'ResearchToolTerminalError';
	}
}

export interface ToolClock {
	now(): string;
}

export interface DiscoveryToolScope {
	runKey: string;
	phase: 'discovery';
	market: Market;
	windowStart: string;
	windowEnd: string;
	maxProviderCostUsd: number | null;
}

export interface ArticleToolScope {
	runKey: string;
	briefId: string;
	market: Market;
	phase: 'deep-research' | 'remediation';
	windowStart: string;
	windowEnd: string;
	maxProviderCostUsd: number | null;
}

interface ToolCounters {
	searches: number;
	fetches: number;
	searchesPerMarket: Map<Market, number>;
	terminalStop: ResearchToolTerminalReason | null;
}

interface SelectedSource {
	url: string;
	tier: SourceTier;
	market: Market;
}

function effectiveCostCeiling(requested: number | null): number {
	return Math.min(
		requested ?? RESEARCH_PROVIDER_DEFAULT_RUN_USD,
		RESEARCH_PROVIDER_HARD_RUN_USD,
	);
}

function createCounters(): ToolCounters {
	return { searches: 0, fetches: 0, searchesPerMarket: new Map(), terminalStop: null };
}

function assertToolAvailable(
	counters: ToolCounters,
	toolName: string,
): void {
	if (counters.terminalStop) {
		throw new ResearchToolTerminalError(toolName, counters.terminalStop);
	}
}

function assertBudgetAvailable(
	budget: BudgetTracker,
	toolName: string,
): void {
	if (budget.exhausted) {
		throw new ResearchToolTerminalError(toolName, 'budget-exhausted');
	}
}

function stopToolUse(
	counters: ToolCounters,
	toolName: string,
	reason: ResearchToolTerminalReason,
): never {
	counters.terminalStop = reason;
	throw new ResearchToolTerminalError(toolName, reason);
}

export function createDiscoveryTools(deps: {
	router: CostAwareWebResearchRouter;
	budget: BudgetTracker;
	clock: ToolClock;
	scope: DiscoveryToolScope;
	ledger?: ResearchArtifactLedger;
}) {
	const counters = createCounters();
	const ceiling = effectiveCostCeiling(deps.scope.maxProviderCostUsd);
	const ledger = deps.ledger ?? new ResearchArtifactLedger();
	const selectedSources = new Map<string, DiscoverySelectedSource>();
	const providerCapacity = createDiscoveryProviderCapacity();

	const search_web = defineTool({
		name: 'search_web',
		description: 'Search web sources within the discovery scan window and vertical.',
		input: v.object({
			query: v.pipe(v.string(), v.minLength(1)),
			vertical: v.picklist(VERTICALS),
			tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
			resultCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_SEARCH_RESULTS)),
		}),
		output: v.object({
			status: ToolStatusSchema,
			results: v.array(
				v.object({
					sourceId: v.string(),
					url: v.string(),
					title: v.string(),
					publishedAt: v.nullable(v.string()),
					highlights: v.array(v.string()),
				}),
			),
			receipts: v.array(ProviderCallReceiptSchema),
		}),
		async run({ input, signal }) {
			assertToolAvailable(counters, 'search_web');
			const market = deps.scope.market;
			const marketSearches = counters.searchesPerMarket.get(market) ?? 0;
			if (marketSearches >= DISCOVERY_SEARCHES_PER_MARKET) {
				stopToolUse(counters, 'search_web', 'limit-reached');
			}

			try {
				const result = await executeDiscoverySearchAction({
					router: deps.router,
					budget: deps.budget,
					clock: deps.clock,
					scope: deps.scope,
					action: {
						type: 'search',
						query: input.query,
						vertical: input.vertical,
						tier: input.tier as SourceTier,
						resultCount: input.resultCount,
					},
					capacity: providerCapacity,
					marketSearchCount: marketSearches,
					attempt: counters.searches + 1,
					signal: signal ?? undefined,
				});

				if (result.status === 'limit-reached' || result.status === 'budget-exhausted') {
					stopToolUse(counters, 'search_web', result.status);
				}
				if (result.status !== 'ok') {
					throw new Error(`Discovery search failed: ${result.status}`);
				}

				counters.searches++;
				counters.searchesPerMarket.set(market, marketSearches + 1);
				for (const selected of result.selectedSources) {
					selectedSources.set(selected.sourceId, selected);
				}

				return {
					status: 'ok' as const,
					results: result.results,
					receipts: result.receipts,
				};
			} catch (error) {
				if (error instanceof DiscoveryProviderTerminalError) {
					if (error.reason === 'limit-reached') {
						stopToolUse(counters, 'search_web', error.reason);
					}
					throw new ResearchToolTerminalError('search_web', error.reason);
				}
				throw error;
			}
		},
	});

	const fetch_sources = defineTool({
		name: 'fetch_sources',
		description: 'Fetch attributable content from selected source URLs.',
		input: v.object({
			sourceIds: v.pipe(
				v.array(v.pipe(v.string(), v.minLength(1))),
				v.maxLength(DISCOVERY_FETCHES_PER_MARKET),
			),
			evidenceQuestion: v.string(),
			freshnessMode: v.picklist(['strict', 'relaxed']),
			maxCharacters: v.pipe(
				v.number(),
				v.integer(),
				v.minValue(100),
				v.maxValue(MAX_NORMALIZED_CONTENT_CHARS),
			),
		}),
		output: v.object({
			status: ToolStatusSchema,
			sources: v.array(
				v.object({
					sourceId: v.string(),
					evidenceId: v.string(),
					url: v.string(),
					title: v.string(),
					excerpt: v.pipe(v.string(), v.maxLength(MAX_EVIDENCE_EXCERPT_CHARS)),
					publishedAt: v.nullable(v.string()),
					tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
					sourceType: v.picklist(['primary', 'secondary', 'social']),
					receiptIds: v.array(v.string()),
					contentHash: v.string(),
				}),
			),
			receipts: v.array(ProviderCallReceiptSchema),
		}),
		async run({ input, signal }) {
			assertToolAvailable(counters, 'fetch_sources');
			if (
				counters.fetches + input.sourceIds.length >
				DISCOVERY_FETCHES_PER_MARKET
			) {
				throw new ResearchToolTerminalError('fetch_sources', 'limit-reached');
			}

			const attemptBase = counters.fetches;
			const result = await executeDiscoveryFetchAction({
				router: deps.router,
				budget: deps.budget,
				clock: deps.clock,
				scope: deps.scope,
				action: {
					type: 'fetch',
					sourceIds: input.sourceIds,
					evidenceQuestion: input.evidenceQuestion,
					freshnessMode: input.freshnessMode,
					maxCharacters: input.maxCharacters,
				},
				capacity: providerCapacity,
				selectedSources,
				attemptBase,
				ledger,
				signal: signal ?? undefined,
			});

			if (result.status === 'invalid-selection') {
				return { status: 'invalid-selection' as const, sources: [], receipts: [] };
			}
			if (result.status === 'limit-reached' || result.status === 'budget-exhausted') {
				throw new ResearchToolTerminalError('fetch_sources', result.status);
			}
			if (result.status !== 'ok') {
				throw new Error(`Discovery fetch failed: ${result.status}`);
			}

			counters.fetches += input.sourceIds.length;
			return {
				status: 'ok' as const,
				sources: result.sources,
				receipts: result.receipts,
			};
		},
	});

	return {
		search_web,
		fetch_sources,
		ceiling,
		market: deps.scope.market,
		ledger,
	};
}

export function createArticleResearchTools(deps: {
	router: CostAwareWebResearchRouter;
	budget: BudgetTracker;
	clock: ToolClock;
	scope: ArticleToolScope;
	ledger?: ResearchArtifactLedger;
}) {
	const counters = createCounters();
	const ceiling = effectiveCostCeiling(deps.scope.maxProviderCostUsd);
	const { market, briefId, phase } = deps.scope;
	const ledger = deps.ledger ?? new ResearchArtifactLedger();
	const selectedSources = new Map<string, SelectedSource>();

	const search_web = defineTool({
		name: 'search_web',
		description: `Search web sources for ${market} market research.`,
		input: v.object({
			query: v.pipe(v.string(), v.minLength(1)),
			vertical: v.picklist(VERTICALS),
			tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
			resultCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_SEARCH_RESULTS)),
		}),
		output: v.object({
			status: ToolStatusSchema,
			results: v.array(
				v.object({
					sourceId: v.string(),
					url: v.string(),
					title: v.string(),
					highlights: v.array(v.string()),
				}),
			),
			receipts: v.array(ProviderCallReceiptSchema),
		}),
		async run({ input, signal }) {
			const abortSignal = signal ?? AbortSignal.timeout(60_000);
			assertToolAvailable(counters, 'search_web');
			const maxSearches =
				phase === 'remediation'
					? REMEDIATION_SEARCHES_PER_MARKET
					: DEEP_RESEARCH_SEARCHES_PER_MARKET;
			if (counters.searches >= maxSearches) {
				stopToolUse(counters, 'search_web', 'limit-reached');
			}
			assertBudgetAvailable(deps.budget, 'search_web');
			counters.searches++;

			const callKey = await deriveCallKey({
				runKey: deps.scope.runKey,
				briefId,
				market,
				phase,
				operation: 'search',
				queryOrUrl: input.query,
				provider: 'exa',
				mode: 'search',
				attempt: counters.searches,
			});

			const response = await deps.router.search(
				{
					query: input.query,
					market,
					tier: input.tier as SourceTier,
					domains: getAllowedDomains(market, input.tier as SourceTier),
					startDate: DEEP_RESEARCH_START_DATE,
					endDate: deps.scope.windowEnd,
					maxResults: input.resultCount,
					phase,
					briefId,
					callKey,
					attempt: counters.searches,
				},
				abortSignal,
				deps.budget,
			);

			const results = await Promise.all(
				response.results.map(async (result) => {
					const sourceId = await deriveSourceId(result.url);
					selectedSources.set(sourceId, {
						url: result.url,
						tier: input.tier as SourceTier,
						market,
					});
					return {
						sourceId,
						url: result.url,
						title: result.title,
						highlights: result.highlights,
					};
				}),
			);
			return {
				status: 'ok' as const,
				results,
				receipts: [response.receipt],
			};
		},
	});

	const fetch_sources = defineTool({
		name: 'fetch_sources',
		description: `Fetch attributable source content for ${market} research.`,
		input: v.object({
			sourceIds: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(MAX_FETCH_URLS)),
			evidenceQuestion: v.string(),
			freshnessMode: v.picklist(['strict', 'relaxed']),
			maxCharacters: v.pipe(v.number(), v.integer(), v.maxValue(MAX_NORMALIZED_CONTENT_CHARS)),
		}),
		output: v.object({
			status: ToolStatusSchema,
			sources: v.array(
				v.object({
					sourceId: v.string(),
					evidenceId: v.string(),
					url: v.string(),
					excerpt: v.pipe(v.string(), v.maxLength(MAX_EVIDENCE_EXCERPT_CHARS)),
					contentHash: v.string(),
				}),
			),
			receipts: v.array(ProviderCallReceiptSchema),
		}),
		async run({ input, signal }) {
			const abortSignal = signal ?? AbortSignal.timeout(60_000);
			assertToolAvailable(counters, 'fetch_sources');
			const maxFetches =
				phase === 'remediation'
					? REMEDIATION_FETCHES_PER_MARKET
					: DEEP_RESEARCH_FETCHES_PER_MARKET;
			if (counters.fetches + input.sourceIds.length > maxFetches) {
				throw new ResearchToolTerminalError('fetch_sources', 'limit-reached');
			}
			const selections = input.sourceIds.map((sourceId) => selectedSources.get(sourceId));
			if (selections.some((selection) => !selection)) {
				return { status: 'invalid-selection' as const, sources: [], receipts: [] };
			}
			assertBudgetAvailable(deps.budget, 'fetch_sources');
			const attemptBase = counters.fetches;
			counters.fetches += input.sourceIds.length;

			const sources = [];
			const receipts = [];
			for (let index = 0; index < selections.length; index++) {
				const selection = selections[index]!;
				const { url, tier: selectedTier } = selection;
				const attempt = attemptBase + index + 1;
				const callKey = await deriveCallKey({
					runKey: deps.scope.runKey,
					briefId,
					market,
					phase,
					operation: 'fetch',
					queryOrUrl: url,
					provider: 'exa',
					mode: 'highlights',
					attempt,
				});

				const response = await deps.router.fetch(
					{
						url,
						market,
						tier: selectedTier,
						mode: 'highlights',
						evidenceQuestion: input.evidenceQuestion,
						maxCharacters: Math.min(input.maxCharacters, MAX_EVIDENCE_EXCERPT_CHARS),
						phase,
						briefId,
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
						evidenceQuestion: input.evidenceQuestion,
						maxCharacters: Math.min(
							input.maxCharacters,
							MAX_EVIDENCE_EXCERPT_CHARS,
						),
						phase,
						briefId,
						callKey,
						attempt,
					},
					response,
					deps.clock.now(),
				);
				sources.push({
					sourceId: artifact.source.sourceId,
					evidenceId: artifact.evidence.evidenceId,
					url: response.finalUrl,
					excerpt: artifact.evidence.text,
					contentHash: artifact.source.contentHash ?? '',
				});
				receipts.push(response.receipt);
			}
			return { status: 'ok' as const, sources, receipts };
		},
	});

	return { search_web, fetch_sources, market, briefId, ceiling, ledger };
}

export function createBriefValidatorTools(deps: {
	router: CostAwareWebResearchRouter;
	budget: BudgetTracker;
	scope: { runKey: string; briefId: string; windowStart: string; windowEnd: string };
	market: Market;
}) {
	let searches = 0;
	let terminalStop: ResearchToolTerminalReason | null = null;
	const search_web = defineTool({
		name: 'search_web',
		description: 'Verify a brief signal with a bounded source search.',
		input: v.object({
			query: v.string(),
			vertical: v.picklist(VERTICALS),
			tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
			resultCount: v.pipe(v.number(), v.maxValue(MAX_SEARCH_RESULTS)),
		}),
		output: v.object({
			status: ToolStatusSchema,
			results: v.array(
				v.object({
					url: v.string(),
					title: v.string(),
					highlights: v.array(v.string()),
				}),
			),
			receipts: v.array(ProviderCallReceiptSchema),
		}),
		async run({ input, signal }) {
			const abortSignal = signal ?? AbortSignal.timeout(60_000);
			if (terminalStop) {
				throw new ResearchToolTerminalError('search_web', terminalStop);
			}
			if (searches >= MAX_VALIDATION_SEARCHES_PER_BRIEF) {
				terminalStop = 'limit-reached';
				throw new ResearchToolTerminalError('search_web', terminalStop);
			}
			assertBudgetAvailable(deps.budget, 'search_web');
			searches++;
			const market = deps.market;
			const callKey = await deriveCallKey({
				runKey: deps.scope.runKey,
				briefId: deps.scope.briefId,
				market,
				phase: 'discovery',
				operation: 'search',
				queryOrUrl: input.query,
				provider: 'exa',
				mode: 'search',
				attempt: searches,
			});
			const response = await deps.router.search(
				{
					query: input.query,
					market,
					tier: input.tier as SourceTier,
					domains: getAllowedDomains(market, input.tier as SourceTier),
					startDate: deps.scope.windowStart,
					endDate: deps.scope.windowEnd,
					maxResults: input.resultCount,
					phase: 'discovery',
					briefId: deps.scope.briefId,
					callKey,
					attempt: searches,
				},
				abortSignal,
				deps.budget,
			);
			return {
				status: 'ok' as const,
				results: response.results.map((r) => ({
					url: r.url,
					title: r.title,
					highlights: r.highlights,
				})),
				receipts: [response.receipt],
			};
		},
	});
	return { search_web };
}

export function resolveDiscoveryMarket(query: string, rotationIndex = 0): Market {
	const lower = query.toLowerCase();
	for (const market of MANDATORY_MARKETS) {
		const spaced = market.replace('-', ' ');
		if (lower.includes(spaced) || lower.includes(market)) return market;
	}
	return MANDATORY_MARKETS[rotationIndex % MANDATORY_MARKETS.length];
}

export function inferMarketFromUrl(url: string): Market | null {
	const lower = url.toLowerCase();
	for (const market of MANDATORY_MARKETS) {
		const tldHints: Record<Market, string[]> = {
			nigeria: ['.ng', 'cbn.gov.ng', 'nigeria'],
			kenya: ['.ke', 'cbk.or.ke', 'kenya'],
			ghana: ['.gh', 'bog.gov.gh', 'ghana'],
			'south-africa': ['.za', 'resbank.co.za', 'south-africa', 'southafrica'],
			egypt: ['.eg', 'cbe.org.eg', 'egypt'],
		};
		if (tldHints[market].some((hint) => lower.includes(hint))) return market;
	}
	return null;
}
