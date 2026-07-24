import { defineAgent, defineWorkflow } from '@flue/runtime';
import { runDiscoveryProviderAction } from '../actions/run-discovery-provider-action';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: runDiscoveryProviderAction,
});
