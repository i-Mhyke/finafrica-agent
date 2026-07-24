import { defineAgent, defineWorkflow } from '@flue/runtime';
import { runDiscoveryDecision } from '../actions/run-discovery-decision';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: runDiscoveryDecision,
});
