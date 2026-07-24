import { defineAction } from '@flue/runtime';
import * as v from 'valibot';
import { createFlueResearchDelegator, type ResearchToolBindings } from '../research/delegation';
import { mergeMarketDiscoveryResults } from '../research/delegation';
import { continueResearchPipeline } from '../research/pipeline';
import { createResearchRuntime, readResearchEnv } from '../research/runtime';
import {
	DiscoveryPortfolioSchema,
	DiscoveryRunRequestSchema,
	MarketDiscoveryResultSchema,
	ResearchPortfolioRunSchema,
} from '../research/schemas';
import { ResearchArtifactLedger } from '../research/ledger';
import { createResearchAuditEmitter } from '../research/run-audit';

const ContinueFoundationalResearchInputSchema = v.object({
	request: DiscoveryRunRequestSchema,
	discovery: v.object({
		runKey: v.string(),
		results: v.array(MarketDiscoveryResultSchema),
	}),
});

export const continueFoundationalResearch = defineAction({
	name: 'continue_foundational_research',
	description: 'Continue the foundational research pipeline from durable discovery output.',
	input: ContinueFoundationalResearchInputSchema,
	output: ResearchPortfolioRunSchema,

	async run({ harness, input, log }) {
		const portfolioInput = v.parse(
			DiscoveryPortfolioSchema,
			mergeMarketDiscoveryResults(input.discovery.runKey, input.discovery.results),
		);
		const audit = createResearchAuditEmitter(log, input.request.runKey);
		const runtime = createResearchRuntime(input.request, readResearchEnv(), audit);
		const bindings: ResearchToolBindings = {
			runtime,
			input: input.request,
			articleBudgets: new Map(),
			ledger: new ResearchArtifactLedger(),
			executionRecords: [],
			audit,
		};
		const delegator = createFlueResearchDelegator(
			harness,
			{
				discovery: {
					nigeria: 'discovery_nigeria',
					ghana: 'discovery_ghana',
				},
				briefValidator: 'brief_validator',
				briefRefiner: 'brief_refiner',
				regionResearchers: {
					nigeria: 'research_nigeria',
					kenya: 'research_kenya',
					ghana: 'research_ghana',
					'south-africa': 'research_south_africa',
					egypt: 'research_egypt',
				},
				structuralAnalyst: 'structural_analyst',
				researchReviewer: 'research_reviewer',
			},
			bindings,
		);

		return continueResearchPipeline(
			{
				delegator,
				toolBindings: bindings,
				runBudget: bindings.runtime.runBudget,
				audit,
			},
			input.request,
			portfolioInput,
		);
	},
});
