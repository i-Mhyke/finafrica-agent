import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateEvidenceReadiness } from '../../../.flue/research/evidence-readiness';
import { evaluateEvidenceCase } from '../../../evals/research/evidence-evaluator.mjs';
import { parseEvalCase } from '../../../evals/research/schema.mjs';

const casesDir = join(process.cwd(), 'evals/research/cases');
const recapWindow = {
	start: '2026-07-22T00:00:00Z',
	end: '2026-07-24T00:00:00Z',
};

function loadCase(fileName: string) {
	return parseEvalCase(JSON.parse(readFileSync(join(casesDir, fileName), 'utf8')));
}

function recapReadinessBrief(evalCase: ReturnType<typeof loadCase>) {
	return {
		...evalCase.input.brief,
		evidenceRequirements: evalCase.input.brief.evidenceRequirements.map((requirement) => ({
			market: evalCase.market,
			question: requirement.requirementId,
			materiality: 'high' as const,
			recencyRule: 'none' as const,
			...requirement,
		})),
	};
}

function recapReadinessAudit(evalCase: ReturnType<typeof loadCase>) {
	const { sourceAudit } = evalCase.input;
	return {
		briefId: evalCase.input.brief.briefId,
		gaps: [],
		duplicateSourceIds: [],
		staleSourceIds: [],
		sources: sourceAudit.sources.map((source) => ({
			retrievedAt: '2026-07-23T00:00:00Z',
			receiptIds: [],
			contentHash: null,
			rightsNote: null,
			author: null,
			publishedAt: null,
			publisher: source.publisher ?? null,
			...source,
		})),
		evidence: sourceAudit.evidence.map((item) => ({
			supports: [],
			capturedAt: '2026-07-23T00:00:00Z',
			...item,
		})),
		claims: sourceAudit.claims.map((claim) => ({
			statement: claim.claimId,
			contradictingEvidenceIds: [],
			...claim,
		})),
	};
}

function expectRequirementStates(
	evalCase: ReturnType<typeof loadCase>,
	expected: Record<string, string>,
) {
	const report = evaluateEvidenceReadiness(
		recapReadinessBrief(evalCase),
		recapReadinessAudit(evalCase),
		recapWindow,
	);
	for (const [requirementId, status] of Object.entries(expected)) {
		expect(
			report.requirements.find((item) => item.requirementId === requirementId)?.status,
		).toBe(status);
	}
}

describe('evidence evaluator', () => {
	it('passes the clean evidence control', () => {
		const result = evaluateEvidenceCase(loadCase('evidence-clean.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual([]);
	});

	it('flags a missing material anchor', () => {
		const result = evaluateEvidenceCase(loadCase('evidence-anchor-missing.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual(['material_anchor_missing']);
	});

	it('flags a missing primary source', () => {
		const result = evaluateEvidenceCase(loadCase('evidence-primary-missing.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual(['primary_source_rule_failed']);
	});

	it('flags social-only material support', () => {
		const result = evaluateEvidenceCase(loadCase('evidence-social-only.json'));
		expect(result.passed).toBe(true);
		expect(result.observations).toEqual(['social_only_material_support']);
	});

	it('includes medium-materiality factual claims in material metrics', () => {
		const evalCase = loadCase('evidence-clean.json');
		const mediumClaim = {
			claimId: 'claim_medium',
			kind: 'fact',
			materiality: 'medium',
			requirementIds: ['req_accept_high'],
			supportingEvidenceIds: ['ev_1'],
			status: 'unsupported',
		};
		const result = evaluateEvidenceCase({
			...evalCase,
			input: {
				...evalCase.input,
				sourceAudit: {
					...evalCase.input.sourceAudit,
					claims: [...evalCase.input.sourceAudit.claims, mediumClaim],
				},
			},
		});

		expect(result.metrics.materialClaimSupportRate).toBe(0.5);
	});

	it('rejects the recapitalisation before-state contract', () => {
		const evalCase = loadCase('recapitalisation-evidence-contract.json');
		const result = evaluateEvidenceCase(evalCase);
		expect(result.passed).toBe(true);
		expect(result.failures).toEqual([]);
		expectRequirementStates(evalCase, evalCase.expected.requirementStates!);
	});

	it('blocks corrected recapitalisation evidence while claim_37 stays unsupported', () => {
		const evalCase = loadCase('recapitalisation-evidence-corrected.json');
		const result = evaluateEvidenceCase(evalCase);
		expect(result.passed).toBe(true);
		expect(result.failures).toEqual([]);
		expectRequirementStates(evalCase, evalCase.expected.requirementStates!);
		expect(result.metrics.materialClaimSupportRate).toBe(0.8);
	});
});
