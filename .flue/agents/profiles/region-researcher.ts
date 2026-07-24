import { defineAgentProfile } from '@flue/runtime';
import researchRegionalEvidence from '../../skills/research-regional-evidence/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import type { Market } from '../../research/schemas';
import regionResearcherPrompt from '../../research/prompts/region-researcher.md' with { type: 'markdown' };

const MARKET_LABELS: Record<Market, string> = {
	nigeria: 'Nigeria',
	kenya: 'Kenya',
	ghana: 'Ghana',
	'south-africa': 'South Africa',
	egypt: 'Egypt',
};

function createRegionProfile(market: Market, name: string) {
	return defineAgentProfile({
		name,
		description: `Deep-research specialist for ${MARKET_LABELS[market]}.`,
		instructions: `${regionResearcherPrompt}\n\nAssigned market: ${MARKET_LABELS[market]}. You may only research within this market.`,
		model: model(researchModelRoles.regionResearcher),
		skills: [researchRegionalEvidence],
	});
}

export const researchNigeria = createRegionProfile('nigeria', 'research_nigeria');
export const researchKenya = createRegionProfile('kenya', 'research_kenya');
export const researchGhana = createRegionProfile('ghana', 'research_ghana');
export const researchSouthAfrica = createRegionProfile('south-africa', 'research_south_africa');
export const researchEgypt = createRegionProfile('egypt', 'research_egypt');

export const regionResearchers = {
	nigeria: researchNigeria,
	kenya: researchKenya,
	ghana: researchGhana,
	'south-africa': researchSouthAfrica,
	egypt: researchEgypt,
} as const;

export const regionResearcherProfiles = Object.values(regionResearchers);
