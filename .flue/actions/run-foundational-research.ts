import { defineAction } from '@flue/runtime';
import { createFlueResearchDelegator, type ResearchToolBindings } from '../research/delegation';
import {
	createFailedResearchPortfolio,
	executeResearchPipeline,
} from '../research/pipeline';
import { createResearchRuntime, readResearchEnv } from '../research/runtime';
import {
	DiscoveryRunRequestSchema,
	type ResearchPortfolioRun,
	ResearchPortfolioRunSchema,
} from '../research/schemas';
import { ResearchArtifactLedger } from '../research/ledger';
import { createResearchAuditEmitter } from '../research/run-audit';

export const runFoundationalResearch = defineAction({
	name: 'run_foundational_research',
	description: 'Execute the foundational research pipeline for market intelligence scans.',
	input: DiscoveryRunRequestSchema,
	output: ResearchPortfolioRunSchema,

	async run({ harness, input, log }) {
		log.info('Starting foundational research pipeline', {
			runKey: input.runKey,
			trigger: input.trigger,
			windowStart: input.window.start,
			windowEnd: input.window.end,
			maxDiscoveredBriefs: input.maxDiscoveredBriefs,
			maxAcceptedBriefs: input.maxAcceptedBriefs,
			maxProviderCostUsd: input.maxProviderCostUsd,
			maxProviderRequests: input.maxProviderRequests,
		});

		let bindings: ResearchToolBindings | undefined;
		let audit;

		try {
			audit = createResearchAuditEmitter(log, input.runKey);
			const runtime = createResearchRuntime(input, readResearchEnv(), audit);
			bindings = {
				runtime,
				input,
				articleBudgets: new Map(),
				ledger: new ResearchArtifactLedger(),
				executionRecords: [],
				audit,
			};
		} catch (error) {
			audit?.failPipeline('pipeline_failed');
			log.error('Research provider runtime unavailable; failing research run', {
				errorClass: error instanceof Error ? error.name : 'unknown',
			});
			return createFailedResearchPortfolio(input);
		}

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

		let portfolio: ResearchPortfolioRun;
		try {
			portfolio = await executeResearchPipeline(
				{
					delegator,
					toolBindings: bindings,
					runBudget: bindings?.runtime.runBudget,
					audit,
				},
				input,
			);
		} catch (error) {
			audit.failPipeline('pipeline_failed');
			log.error('Research pipeline terminated unexpectedly', {
				errorClass: error instanceof Error ? error.name : 'unknown',
			});
			throw error;
		}

		log.info('Research pipeline complete', {
			runKey: portfolio.runKey,
			status: portfolio.status,
			discovered: portfolio.totals.discovered,
			accepted: portfolio.totals.accepted,
			passed: portfolio.totals.passed,
		});

		return portfolio;
	},
});
