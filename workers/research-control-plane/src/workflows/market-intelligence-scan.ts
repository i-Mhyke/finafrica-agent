import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from 'cloudflare:workers';
import * as v from 'valibot';
import {
	DiscoveryRunRequestSchema,
	FOUNDATION_MARKETS,
	type DiscoveryRunRequest,
} from '../../../../.flue/research/schemas';
import type { Env } from '../env';
import { maxDiscoveryRequests } from '../env';
import { createFlueServiceClient } from '../flue-client';
import { ResearchRunState } from '../state/research-run-state';
import { runMarketDiscoveryLoop, type MarketDiscoveryStore } from './run-market-discovery';

export class MarketIntelligenceScanWorkflow extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<{ request: unknown }>, step: WorkflowStep) {
		const request = v.parse(DiscoveryRunRequestSchema, event.payload.request);
		const workflowInstanceId = event.instanceId;

		const [nigeria, ghana] = await Promise.all([
			step.do('discovery:nigeria', async () =>
				this.runMarket('nigeria', request, workflowInstanceId),
			),
			step.do('discovery:ghana', async () =>
				this.runMarket('ghana', request, workflowInstanceId),
			),
		]);

		await step.do('continue-pipeline', async () => {
			const flue = createFlueServiceClient(
				this.env.PUBLICATION_AGENT,
				this.env.RESEARCH_ADMIN_TOKEN,
			);
			await flue.continueMarketIntelligenceScan({
				request,
				discovery: {
					runKey: request.runKey,
					results: [nigeria, ghana],
				},
			});
			return { ok: true };
		});
	}

	private async runMarket(
		market: (typeof FOUNDATION_MARKETS)[number],
		request: DiscoveryRunRequest,
		workflowInstanceId: string,
	) {
		const stub = this.env.RESEARCH_RUN_STATE.get(
			this.env.RESEARCH_RUN_STATE.idFromName(request.runKey),
		) as DurableObjectStub<ResearchRunState>;
		const store = createMarketDiscoveryStoreFromStub(stub);
		const flue = createFlueServiceClient(
			this.env.PUBLICATION_AGENT,
			this.env.RESEARCH_ADMIN_TOKEN,
		);
		return runMarketDiscoveryLoop({
			request,
			market,
			workflowInstanceId,
			maxRequests: maxDiscoveryRequests(request),
			store,
			flue,
		});
	}
}

function createMarketDiscoveryStoreFromStub(
	stub: DurableObjectStub<ResearchRunState>,
): MarketDiscoveryStore {
	return {
		initMarket: (input) => stub.initMarket(input),
		getCheckpoint: (runKey, market) => stub.getCheckpoint(runKey, market),
		saveCheckpoint: (checkpoint, expectedRevision) =>
			stub.saveCheckpoint(checkpoint, expectedRevision),
		reserveProviderAction: (scope, pending) => stub.reserveProviderAction(scope, pending),
		saveObservation: (scope, actionId, payload) =>
			stub.saveObservation(scope, actionId, payload),
		getObservation: (scope, actionId) => stub.getObservation(scope, actionId),
		getSelectedSources: (scope) => stub.getSelectedSources(scope),
		getRetainedArtifacts: (scope) => stub.getRetainedArtifacts(scope),
	};
}
