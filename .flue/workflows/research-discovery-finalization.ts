import { defineAgent, defineWorkflow } from '@flue/runtime';
import { runDiscoveryFinalization } from '../actions/run-discovery-finalization';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: runDiscoveryFinalization,
});
