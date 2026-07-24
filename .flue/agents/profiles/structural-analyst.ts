import { defineAgentProfile } from '@flue/runtime';
import analyzeFinancialStructure from '../../skills/analyze-financial-structure/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import structuralAnalystPrompt from '../../research/prompts/structural-analyst.md' with { type: 'markdown' };

export const structuralAnalyst = defineAgentProfile({
	name: 'structural_analyst',
	description: 'Builds structural analysis packet from normalized evidence.',
	instructions: structuralAnalystPrompt,
	model: model(researchModelRoles.structuralAnalyst),
	skills: [analyzeFinancialStructure],
});
