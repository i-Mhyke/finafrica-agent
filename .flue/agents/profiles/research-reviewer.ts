import { defineAgentProfile } from '@flue/runtime';
import reviewResearchPackets from '../../skills/review-research-packets/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import researchReviewerPrompt from '../../research/prompts/research-reviewer.md' with { type: 'markdown' };

export const researchReviewer = defineAgentProfile({
	name: 'research_reviewer',
	description: 'Reviews article research packet against the reviewer rubric.',
	instructions: researchReviewerPrompt,
	model: model(researchModelRoles.researchReviewer),
	skills: [reviewResearchPackets],
});
