import africanFinancialIntelligencePipeline from './african-financial-intelligence-pipeline/SKILL.md' with { type: 'skill' };
import buildingEmdashSite from './building-emdash-site/SKILL.md' with { type: 'skill' };
import creatingPlugins from './creating-plugins/SKILL.md' with { type: 'skill' };
import emdashCli from './emdash-cli/SKILL.md' with { type: 'skill' };
import emmaFinanceArticleWriter from './emma-finance-article-writer/SKILL.md' with { type: 'skill' };
import scanMarketSignals from './scan-market-signals/SKILL.md' with { type: 'skill' };
import validateResearchBriefs from './validate-research-briefs/SKILL.md' with { type: 'skill' };
import researchRegionalEvidence from './research-regional-evidence/SKILL.md' with { type: 'skill' };
import analyzeFinancialStructure from './analyze-financial-structure/SKILL.md' with { type: 'skill' };
import reviewResearchPackets from './review-research-packets/SKILL.md' with { type: 'skill' };

/** Application-owned skills available for explicit agent registration. */
export const publicationSkills = {
	africanFinancialIntelligencePipeline,
	buildingEmdashSite,
	creatingPlugins,
	emdashCli,
	emmaFinanceArticleWriter,
	scanMarketSignals,
	validateResearchBriefs,
	researchRegionalEvidence,
	analyzeFinancialStructure,
	reviewResearchPackets,
} as const;

export {
	africanFinancialIntelligencePipeline,
	buildingEmdashSite,
	creatingPlugins,
	emdashCli,
	emmaFinanceArticleWriter,
	scanMarketSignals,
	validateResearchBriefs,
	researchRegionalEvidence,
	analyzeFinancialStructure,
	reviewResearchPackets,
};
