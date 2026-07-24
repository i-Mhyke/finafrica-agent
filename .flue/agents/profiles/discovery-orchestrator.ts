import { defineAgentProfile } from '@flue/runtime';
import scanMarketSignals from '../../skills/scan-market-signals/SKILL.md' with { type: 'skill' };
import { model, researchModelRoles } from '../../models';
import type { Market } from '../../research/schemas';
import discoveryPrompt from '../../research/prompts/discovery-orchestrator.md' with { type: 'markdown' };

const MARKET_LABELS: Record<Market, string> = {
	nigeria: 'Nigeria',
	kenya: 'Kenya',
	ghana: 'Ghana',
	'south-africa': 'South Africa',
	egypt: 'Egypt',
};

function createDiscoveryProfile(market: Market, name: string) {
	return defineAgentProfile({
		name,
		description: `Source-first discovery researcher for ${MARKET_LABELS[market]}.`,
		instructions: `${discoveryPrompt}\n\nAssigned market: ${MARKET_LABELS[market]}. Research and return coverage only for this market.`,
		model: model(researchModelRoles.discovery),
		skills: [scanMarketSignals],
	});
}

export const discoveryNigeria = createDiscoveryProfile(
	'nigeria',
	'discovery_nigeria',
);
export const discoveryGhana = createDiscoveryProfile('ghana', 'discovery_ghana');

export const discoveryResearchers = {
	nigeria: discoveryNigeria,
	ghana: discoveryGhana,
} as const;

export const discoveryResearcherProfiles = Object.values(discoveryResearchers);
