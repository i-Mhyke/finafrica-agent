import { defineAgent, defineWorkflow } from '@flue/runtime';
import { continueFoundationalResearch } from '../actions/continue-foundational-research';
import { createCoordinatorRuntimeConfig, type ResearchWorkerEnv } from '../agents/profiles/coordinator';

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: continueFoundationalResearch,
});
