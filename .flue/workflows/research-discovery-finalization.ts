import { defineAgent, defineWorkflow } from '@flue/runtime';
import { runDiscoveryFinalization } from '../actions/run-discovery-finalization';
import { researchAdminFromEnv } from '../auth/research-admin';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

export const route = researchAdminFromEnv;
export const runs = researchAdminFromEnv;

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: runDiscoveryFinalization,
});
