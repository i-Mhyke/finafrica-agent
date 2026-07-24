import { defineAgentProfile } from '@flue/runtime';
import refineResearchBriefs from '../../skills/refine-research-briefs/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import briefRefinerPrompt from '../../research/prompts/brief-refiner.md' with { type: 'markdown' };

export const briefRefiner = defineAgentProfile({
	name: 'brief_refiner',
	description:
		'Applies one validator change set to one research brief without gathering evidence.',
	instructions: briefRefinerPrompt,
	model: model(researchModelRoles.briefRefiner),
	skills: [refineResearchBriefs],
});
