import { defineAgentProfile } from '@flue/runtime';
import { model, researchModelRoles } from '../../models';
import discoveryFinalizerPrompt from '../../research/prompts/discovery-finalizer.md' with { type: 'markdown' };

export const discoveryFinalizer = defineAgentProfile({
	name: 'discovery_finalizer',
	description: 'Repairs or emits one terminal discovery result with no tools.',
	instructions: discoveryFinalizerPrompt,
	model: model(researchModelRoles.discoveryFinalizer),
});
