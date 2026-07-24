import { defineAgentProfile } from '@flue/runtime';
import validateResearchBriefs from '../../skills/validate-research-briefs/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import briefValidatorPrompt from '../../research/prompts/brief-validator.md' with { type: 'markdown' };

export const briefValidator = defineAgentProfile({
	name: 'brief_validator',
	description: 'Validates one proposed article brief independently.',
	instructions: briefValidatorPrompt,
	model: model(researchModelRoles.briefValidator),
	skills: [validateResearchBriefs],
});
