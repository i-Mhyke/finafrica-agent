import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	discoveryResearchers,
	discoveryResearcherProfiles,
} from '../../.flue/agents/profiles/discovery-orchestrator';
import { briefValidator as validator } from '../../.flue/agents/profiles/brief-validator';
import { briefRefiner as refiner } from '../../.flue/agents/profiles/brief-refiner';
import {
	regionResearchers,
	regionResearcherProfiles,
} from '../../.flue/agents/profiles/region-researcher';
import { researchReviewer } from '../../.flue/agents/profiles/research-reviewer';
import { structuralAnalyst } from '../../.flue/agents/profiles/structural-analyst';
import { createCoordinatorRuntimeConfig } from '../../.flue/agents/profiles/coordinator';
import { models, researchModelRoles } from '../../.flue/models';

describe('agent profiles', () => {
	it('declares five uniquely named region profiles', () => {
		const names = regionResearcherProfiles.map((p) => p.name);
		expect(names).toHaveLength(5);
		expect(new Set(names).size).toBe(5);
		expect(names).toContain('research_nigeria');
		expect(names).toContain('research_kenya');
		expect(names).toContain('research_ghana');
		expect(names).toContain('research_south_africa');
		expect(names).toContain('research_egypt');
	});

	it('registers the pipeline skill on every research profile', () => {
		const profiles = [
			...discoveryResearcherProfiles,
			validator,
			refiner,
			...regionResearcherProfiles,
			structuralAnalyst,
			researchReviewer,
		];
		for (const profile of profiles) {
			expect(profile.skills?.length).toBeGreaterThan(0);
		}
	});

	it('gives every worker a stage-scoped skill instead of the end-to-end pipeline skill', () => {
		const expectedSkills = {
			'discovery-orchestrator.ts': 'scan-market-signals',
			'brief-validator.ts': 'validate-research-briefs',
			'brief-refiner.ts': 'refine-research-briefs',
			'region-researcher.ts': 'research-regional-evidence',
			'structural-analyst.ts': 'analyze-financial-structure',
			'research-reviewer.ts': 'review-research-packets',
		};

		for (const [file, skill] of Object.entries(expectedSkills)) {
			const source = readFileSync(
				join(process.cwd(), '.flue/agents/profiles', file),
				'utf8',
			);
			expect(source).toContain(`/skills/${skill}/SKILL.md`);
			expect(source).not.toContain(
				'/skills/african-financial-intelligence-pipeline/SKILL.md',
			);
		}
	});

	it('gives breadth tools to discovery and scoped tools to validators and region profiles', () => {
		// Tools are bound at runtime via tool factories, not on static profiles
		expect(discoveryResearchers.nigeria.name).toBe('discovery_nigeria');
		expect(discoveryResearchers.ghana.name).toBe('discovery_ghana');
		expect(validator.name).toBe('brief_validator');
		expect(refiner.name).toBe('brief_refiner');
		expect(regionResearchers.nigeria.name).toBe('research_nigeria');
	});

	it('prevents discovery from validating its own briefs', () => {
		for (const profile of discoveryResearcherProfiles) {
			expect(profile.name).not.toBe('brief_validator');
		}
	});

	it('does not register the writer, EmDash CLI, or publish capability', () => {
		const profiles = [
			...discoveryResearcherProfiles,
			validator,
			refiner,
			...regionResearcherProfiles,
			structuralAnalyst,
			researchReviewer,
		];
		for (const profile of profiles) {
			expect(profile.skills?.length).toBe(1);
		}
		expect(profiles.map((p) => p.name)).not.toContain('article_writer');
		expect(profiles.map((p) => p.name)).not.toContain('publisher');
	});

	it('uses model roles from models.ts', () => {
		expect(createCoordinatorRuntimeConfig({}).model).toBe(models[researchModelRoles.coordinator]);
		for (const profile of discoveryResearcherProfiles) {
			expect(profile.model).toBe(models[researchModelRoles.discovery]);
		}
		for (const profile of regionResearcherProfiles) {
			expect(profile.model).toBe(models[researchModelRoles.regionResearcher]);
		}
		expect(validator.model).toBe(models[researchModelRoles.briefValidator]);
		expect(refiner.model).toBe(models[researchModelRoles.briefRefiner]);
		expect(structuralAnalyst.model).toBe(models[researchModelRoles.structuralAnalyst]);
		expect(researchReviewer.model).toBe(models[researchModelRoles.researchReviewer]);
	});

	it('requires evidence contract fields in discovery, validator, and region prompts', () => {
		const promptDir = join(process.cwd(), '.flue/research/prompts');
		const discovery = readFileSync(join(promptDir, 'discovery-orchestrator.md'), 'utf8');
		const validatorPrompt = readFileSync(join(promptDir, 'brief-validator.md'), 'utf8');
		const refinerPrompt = readFileSync(join(promptDir, 'brief-refiner.md'), 'utf8');
		const region = readFileSync(join(promptDir, 'region-researcher.md'), 'utf8');
		for (const field of [
			'evidenceRequirements',
			'requirementId',
			'sourceRule',
			'targetDomains',
			'anchors',
			'recencyRule',
		]) {
			expect(discovery).toContain(field);
			expect(validatorPrompt).toContain(field);
		}
		for (const field of [
			'evidenceRequirements',
			'requirementId',
			'sourceRule',
			'targetDomains',
			'anchors',
			'recencyRule',
			'requirementIds',
		]) {
			expect(region).toContain(field);
		}
		expect(region).toContain('remediationBrief');
		expect(region).toContain('remediationBrief.requirements');
		expect(refinerPrompt).toContain('Do not call any tool');
		expect(refinerPrompt).toContain('Apply only `validation.requiredChanges`');
		const forbiddenSection =
			validatorPrompt.split('## Forbidden')[1]?.split('##')[0] ?? '';
		expect(forbiddenSection).toContain('activate_skill');
		expect(forbiddenSection).toMatch(/Do not call/);
		expect(validatorPrompt).toContain('Return `ACCEPT` only when:');
	});

	it('documents the expanded regional research allowances', () => {
		const documents = [
			readFileSync(
				join(process.cwd(), '.flue/research/prompts/region-researcher.md'),
				'utf8',
			),
			readFileSync(
				join(
					process.cwd(),
					'.flue/skills/research-regional-evidence/SKILL.md',
				),
				'utf8',
			),
		];
		for (const document of documents) {
			expect(document).toMatch(
				/Deep research permits at most (12|twelve) searches and (16|sixteen) source attempts/i,
			);
			expect(document).toMatch(
				/Remediation permits at most (6|six) searches and (10|ten) source attempts/i,
			);
		}
	});

	it('states discovery terminal rules and exact recency enum values', () => {
		const prompt = readFileSync(
			join(process.cwd(), '.flue/research/prompts/discovery-orchestrator.md'),
			'utf8',
		);
		const skill = readFileSync(
			join(process.cwd(), '.flue/skills/scan-market-signals/SKILL.md'),
			'utf8',
		);
		for (const text of [prompt, skill]) {
			expect(text).toContain('`none`');
			expect(text).toContain('`source-published-in-window`');
			expect(text).toContain('`event-occurred-in-window`');
			expect(text).toContain('`briefs: []`');
			expect(text).toContain('Absence of search results is not an article signal');
			expect(text).toContain('Do not call `search_web` after two searches');
			expect(text).toContain(
				'Do not pass more source IDs than the remaining fetch allowance',
			);
		}
	});
});
