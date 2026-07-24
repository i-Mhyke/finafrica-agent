import type { ArticleResearchBrief, Market } from './schemas';
import { allocateProviderBudget, effectiveProviderBudgetUsd } from './schemas';
import { createBudgetTracker, type BudgetTracker } from '../providers/web-research/router';

export interface ArticleBudgetAllocation {
	briefId: string;
	totalUsd: number;
	perMarketUsd: Partial<Record<Market, number>>;
	tracker: BudgetTracker;
	marketTrackers: Partial<Record<Market, BudgetTracker>>;
	remediationTrackers: Partial<Record<Market, BudgetTracker>>;
}

/** Split deep-research budget across accepted briefs and markets before concurrent work. */
export function allocateArticleBudgets(
	accepted: ArticleResearchBrief[],
	requestedBudgetUsd: number | null,
): Map<string, ArticleBudgetAllocation> {
	const effective = effectiveProviderBudgetUsd(requestedBudgetUsd);
	const { deepResearch, remediation } = allocateProviderBudget(effective);
	const perBrief = accepted.length > 0 ? deepResearch / accepted.length : 0;
	const remediationPerBrief = accepted.length > 0 ? remediation / accepted.length : 0;
	const allocations = new Map<string, ArticleBudgetAllocation>();

	for (const brief of accepted) {
		const marketCount = brief.markets.length || 1;
		const perMarket = perBrief / marketCount;
		const remediationPerMarket = remediationPerBrief / marketCount;
		const perMarketUsd: Partial<Record<Market, number>> = {};
		const marketTrackers: Partial<Record<Market, BudgetTracker>> = {};
		const remediationTrackers: Partial<Record<Market, BudgetTracker>> = {};
		for (const market of brief.markets) {
			perMarketUsd[market] = perMarket;
			marketTrackers[market] = createBudgetTracker(perMarket, perMarket);
			remediationTrackers[market] = createBudgetTracker(
				remediationPerMarket,
				remediationPerMarket,
			);
		}
		allocations.set(brief.briefId, {
			briefId: brief.briefId,
			totalUsd: perBrief,
			perMarketUsd,
			tracker: createBudgetTracker(perBrief, perBrief),
			marketTrackers,
			remediationTrackers,
		});
	}

	return allocations;
}
