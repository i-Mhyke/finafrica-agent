import { defineAgent, defineWorkflow } from '@flue/runtime';
import { runFoundationalResearch } from '../actions/run-foundational-research';
import { researchAdminFromEnv } from '../auth/research-admin';
import {
	createCoordinatorRuntimeConfig,
	type ResearchWorkerEnv,
} from '../agents/profiles/coordinator';
import { registerModelStreamRecovery } from '../providers/model-stream-recovery';
import { registerResearchDelegationPolicy } from '../research/delegation-policy';

registerModelStreamRecovery();
registerResearchDelegationPolicy();

export const route = researchAdminFromEnv;
export const runs = researchAdminFromEnv;

const coordinatorAgent = defineAgent<ResearchWorkerEnv>(({ env }) =>
	createCoordinatorRuntimeConfig(env),
);

export default defineWorkflow({
	agent: coordinatorAgent,
	action: runFoundationalResearch,
});
