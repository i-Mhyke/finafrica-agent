import { describe, expect, it, vi } from 'vitest';
import { ExaWebResearchProvider } from '../../.flue/providers/web-research/exa';
import { ProviderError } from '../../.flue/providers/web-research/provider-errors';
import { CostAwareWebResearchRouter, createBudgetTracker } from '../../.flue/providers/web-research/router';
import {
	classifyDiscoveryProviderFailure,
	createDiscoveryProviderCapacity,
	DiscoveryProviderTerminalError,
	executeDiscoveryFetchAction,
	executeDiscoverySearchAction,
} from '../../.flue/research/discovery-provider-executor';
import { deriveSourceId } from '../../.flue/research/ids';
import exaSearchFixture from '../fixtures/research/exa-search.json';
import exaContentsFixture from '../fixtures/research/exa-contents.json';

function setupRouter() {
	const searchFetch = vi.fn(async (url: string) => {
		const contents = {
			...exaContentsFixture,
			results: [
				{
					...exaContentsFixture.results[0],
					highlights: [exaContentsFixture.results[0].text],
				},
			],
		};
		return new Response(
			JSON.stringify(url.includes('/search') ? exaSearchFixture : contents),
			{ status: 200 },
		);
	});
	const budget = createBudgetTracker(5, 5);
	const router = new CostAwareWebResearchRouter({
		exa: new ExaWebResearchProvider({ apiKey: 'test-key', fetch: searchFetch }),
		apify: null,
		apifyFallbackEnabled: false,
		budget,
	});
	return { router, budget, searchFetch };
}

const scope = {
	runKey: 'run-1',
	phase: 'discovery' as const,
	market: 'nigeria' as const,
	windowStart: '2026-07-22T00:00:00Z',
	windowEnd: '2026-07-23T00:00:00Z',
	maxProviderCostUsd: 5,
};

describe('discovery provider executor', () => {
	it('derives canonical source ids for search results', async () => {
		const { router, budget } = setupRouter();
		const capacity = createDiscoveryProviderCapacity();
		const result = await executeDiscoverySearchAction({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope,
			action: {
				type: 'search',
				query: 'nigeria rates',
				vertical: 'monetary-policy',
				tier: 1,
				resultCount: 5,
			},
			capacity,
			marketSearchCount: 0,
			attempt: 1,
		});

		expect(result.status).toBe('ok');
		expect(result.results[0]?.sourceId).toMatch(/^src_/);
		expect(result.receipts[0]?.market).toBe('nigeria');
	});

	it('rejects a third discovery search for the market', async () => {
		const { router, budget } = setupRouter();
		const capacity = createDiscoveryProviderCapacity({ searchesUsed: 2 });
		await expect(
			executeDiscoverySearchAction({
				router,
				budget,
				clock: { now: () => '2026-07-23T00:00:00Z' },
				scope,
				action: {
					type: 'search',
					query: 'late search',
					vertical: 'monetary-policy',
					tier: 1,
					resultCount: 5,
				},
				capacity,
				marketSearchCount: 2,
				attempt: 3,
			}),
		).rejects.toBeInstanceOf(DiscoveryProviderTerminalError);
	});

	it('rejects a fifth discovery fetch for the market', async () => {
		const { router, budget } = setupRouter();
		const sourceId = await deriveSourceId('https://cbn.gov.ng/documents/circular-2026');
		const capacity = createDiscoveryProviderCapacity({ fetchesUsed: 4 });
		await expect(
			executeDiscoveryFetchAction({
				router,
				budget,
				clock: { now: () => '2026-07-23T00:00:00Z' },
				scope,
				action: {
					type: 'fetch',
					sourceIds: [sourceId],
					evidenceQuestion: 'What changed?',
					freshnessMode: 'strict',
					maxCharacters: 1000,
				},
				capacity,
				selectedSources: new Map([
					[
						sourceId,
						{
							sourceId,
							url: 'https://cbn.gov.ng/documents/circular-2026',
							tier: 1,
							market: 'nigeria',
						},
					],
				]),
				attemptBase: 4,
			}),
		).rejects.toBeInstanceOf(DiscoveryProviderTerminalError);
	});

	it('does not call the provider after terminal capacity is set', async () => {
		const { router, budget, searchFetch } = setupRouter();
		const capacity = createDiscoveryProviderCapacity({ terminalStop: 'limit-reached' });
		await expect(
			executeDiscoverySearchAction({
				router,
				budget,
				clock: { now: () => '2026-07-23T00:00:00Z' },
				scope,
				action: {
					type: 'search',
					query: 'blocked',
					vertical: 'monetary-policy',
					tier: 1,
					resultCount: 5,
				},
				capacity,
				marketSearchCount: 0,
				attempt: 1,
			}),
		).rejects.toBeInstanceOf(DiscoveryProviderTerminalError);
		expect(searchFetch).not.toHaveBeenCalled();
	});

	it('classifies provider timeout separately from generic errors', () => {
		expect(
			classifyDiscoveryProviderFailure(
				new ProviderError('upstream timeout', {
					retryable: true,
					provider: 'exa',
				}),
			),
		).toBe('provider_timeout');
		expect(
			classifyDiscoveryProviderFailure(
				new ProviderError('rate limited', {
					retryable: true,
					provider: 'exa',
					statusCode: 429,
				}),
			),
		).toBe('provider_rate_limit');
	});

	it('creates canonical ledger artifacts on successful fetch without model-authored ids', async () => {
		const { router, budget } = setupRouter();
		const sourceId = await deriveSourceId('https://cbn.gov.ng/documents/circular-2026');
		const capacity = createDiscoveryProviderCapacity();
		const result = await executeDiscoveryFetchAction({
			router,
			budget,
			clock: { now: () => '2026-07-23T00:00:00Z' },
			scope,
			action: {
				type: 'fetch',
				sourceIds: [sourceId],
				evidenceQuestion: 'What changed?',
				freshnessMode: 'strict',
				maxCharacters: 1000,
			},
			capacity,
			selectedSources: new Map([
				[
					sourceId,
					{
						sourceId,
						url: 'https://cbn.gov.ng/documents/circular-2026',
						tier: 1,
						market: 'nigeria',
					},
				],
			]),
			attemptBase: 0,
		});

		expect(result.status).toBe('ok');
		expect(result.sourceRecords[0]?.sourceId).toMatch(/^src_/);
		expect(result.evidenceRecords[0]?.evidenceId).toMatch(/^ev_/);
		expect(result.sourceRecords[0]?.market).toBe('nigeria');
	});
});
