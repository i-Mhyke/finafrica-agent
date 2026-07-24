import { defineAgentProfile } from '@flue/runtime';
import { model, researchModelRoles } from '../../models';
import discoveryDecisionPrompt from '../../research/prompts/discovery-decision.md' with { type: 'markdown' };

export const discoveryDecision = defineAgentProfile({
	name: 'discovery_decision',
	description: 'Returns one supervised discovery action with no tools.',
	instructions: discoveryDecisionPrompt,
	model: model(researchModelRoles.discoveryDecision),
});
