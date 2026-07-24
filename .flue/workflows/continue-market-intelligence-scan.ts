import { defineAgent, defineWorkflow } from '@flue/runtime';
import { continueFoundationalResearch } from '../actions/continue-foundational-research';
import { researchAdminFromEnv } from '../auth/research-admin';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

export const route = researchAdminFromEnv;
export const runs = researchAdminFromEnv;

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: continueFoundationalResearch,
});
