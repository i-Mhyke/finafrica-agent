import { researchOnlySandbox } from '../../sandboxes/research-only';
import { model, researchModelRoles } from '../../models';
import { briefValidator } from './brief-validator';
import { briefRefiner } from './brief-refiner';
import { discoveryResearcherProfiles } from './discovery-orchestrator';
import { discoveryDecision } from './discovery-decision';
import { discoveryFinalizer } from './discovery-finalizer';
import { regionResearcherProfiles } from './region-researcher';
import { researchReviewer } from './research-reviewer';
import { structuralAnalyst } from './structural-analyst';
import { configureResearchEnvironment, type ResearchEnv } from '../../research/runtime';

export interface ResearchWorkerEnv extends ResearchEnv, Record<string, unknown> {
	RESEARCH_ADMIN_TOKEN?: string;
}

export function createCoordinatorRuntimeConfig(env: ResearchWorkerEnv) {
	configureResearchEnvironment(env);
	return {
		model: model(researchModelRoles.coordinator),
		sandbox: researchOnlySandbox(),
		instructions:
			'Coordinate foundational research pipeline stages. Delegate to subagents; do not publish.',
		subagents: [
			...discoveryResearcherProfiles,
			discoveryDecision,
			discoveryFinalizer,
			briefValidator,
			briefRefiner,
			...regionResearcherProfiles,
			structuralAnalyst,
			researchReviewer,
		],
	};
}
