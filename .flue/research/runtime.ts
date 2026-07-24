import { ApifyWebExtractionProvider } from '../providers/web-research/apify';
import { ExaWebResearchProvider } from '../providers/web-research/exa';
import {
	CostAwareWebResearchRouter,
	createBudgetTracker,
	type BudgetTracker,
} from '../providers/web-research/router';
import {
	DISCOVERY_MARKET_BUDGET_SHARE,
	FOUNDATION_MARKETS,
	type DiscoveryRunRequest,
	type Market,
} from './schemas';
import type { ResearchAuditEmitter } from './run-audit';
import {
	allocateProviderBudget,
	effectiveProviderBudgetUsd,
	effectiveProviderRequestLimit,
} from './schemas';
import { createDohHostnameResolver } from '../providers/web-research/url-policy';

export interface ResearchEnv {
	EXA_API_KEY?: string;
	APIFY_API_TOKEN?: string;
	APIFY_FALLBACK_ENABLED?: string;
}

export interface ResearchRuntime {
	router: CostAwareWebResearchRouter;
	runBudget: BudgetTracker;
	discoveryBudget: BudgetTracker;
	discoveryBudgets: Partial<Record<Market, BudgetTracker>>;
}

let configuredResearchEnv: ResearchEnv | null = null;

export function configureResearchEnvironment(source: Record<string, unknown>): void {
	configuredResearchEnv = parseResearchEnv(source);
}

export function createResearchRuntime(
	input: DiscoveryRunRequest,
	env: ResearchEnv,
	audit?: ResearchAuditEmitter,
): ResearchRuntime {
	const effective = effectiveProviderBudgetUsd(input.maxProviderCostUsd);
	const phases = allocateProviderBudget(effective);
	const runBudget = createBudgetTracker(effective, effective);
	const marketDiscoveryPool =
		phases.discovery * DISCOVERY_MARKET_BUDGET_SHARE;
	const validationBudget =
		phases.discovery - marketDiscoveryPool;
	const discoveryBudget = createBudgetTracker(
		validationBudget,
		validationBudget,
	);
	const perMarketDiscoveryBudget =
		marketDiscoveryPool / FOUNDATION_MARKETS.length;
	const discoveryBudgets: Partial<Record<Market, BudgetTracker>> = {};
	for (const market of FOUNDATION_MARKETS) {
		discoveryBudgets[market] = createBudgetTracker(
			perMarketDiscoveryBudget,
			perMarketDiscoveryBudget,
		);
	}

	const exaKey = env.EXA_API_KEY;
	if (!exaKey) {
		throw new Error('EXA_API_KEY is required for research provider calls');
	}

	const apifyEnabled = env.APIFY_FALLBACK_ENABLED === 'true';
	const resolveHostname = createDohHostnameResolver();
	const apify =
		apifyEnabled && env.APIFY_API_TOKEN
			? new ApifyWebExtractionProvider({
					apiToken: env.APIFY_API_TOKEN,
					resolveHostname,
				})
			: null;

	const router = new CostAwareWebResearchRouter({
			exa: new ExaWebResearchProvider({ apiKey: exaKey, resolveHostname }),
		apify,
		apifyFallbackEnabled: apifyEnabled,
		budget: runBudget,
		audit,
		maxProviderRequests: effectiveProviderRequestLimit(input.maxProviderRequests),
	});

	return { router, runBudget, discoveryBudget, discoveryBudgets };
}

export function readResearchEnv(source?: Record<string, unknown>): ResearchEnv {
	if (source) return parseResearchEnv(source);
	return configuredResearchEnv ?? {};
}

function parseResearchEnv(source: Record<string, unknown>): ResearchEnv {
	return {
		EXA_API_KEY: typeof source.EXA_API_KEY === 'string' ? source.EXA_API_KEY : undefined,
		APIFY_API_TOKEN: typeof source.APIFY_API_TOKEN === 'string' ? source.APIFY_API_TOKEN : undefined,
		APIFY_FALLBACK_ENABLED:
			typeof source.APIFY_FALLBACK_ENABLED === 'string' ? source.APIFY_FALLBACK_ENABLED : undefined,
	};
}
