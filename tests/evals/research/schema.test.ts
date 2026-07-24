import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseEvalCase, parseEvalReport, parseEvalSuite } from '../../../evals/research/schema.mjs';

const discoveryCase = {
	caseId: 'discovery-market-clean',
	caseVersion: 1,
	kind: 'discovery',
	market: 'nigeria',
	input: {
		portfolio: {
			briefs: [
				{
					briefId: 'brief_accept',
					markets: ['nigeria'],
					discoverySourceIds: ['src_1'],
					evidenceRequirements: [
						{
							requirementId: 'req_accept_high',
							sourceRule: 'primary',
							targetDomains: ['cbn.gov.ng'],
							anchors: ['15%'],
						},
					],
				},
			],
			sources: [
				{
					sourceId: 'src_1',
					canonicalUrl: 'https://cbn.gov.ng/documents/circular-2026',
					publisher: 'CBN',
					market: 'nigeria',
					tier: 1,
					sourceType: 'primary',
				},
			],
			evidence: [
				{
					evidenceId: 'ev_1',
					sourceId: 'src_1',
					text: 'CBN raised capital requirements to 15%',
				},
			],
		},
	},
	expected: {
		relevantBriefIds: ['brief_accept'],
		irrelevantBriefIds: [],
		expectedMarketSourceIds: ['src_1'],
		crossMarketContaminationCount: 0,
	},
	rationale: 'valid discovery case',
	sourceOfTruth: 'editor-reviewed',
	enforceHardGates: true,
};

const evidenceCase = {
	caseId: 'evidence-clean',
	caseVersion: 1,
	kind: 'evidence',
	market: 'nigeria',
	input: {
		brief: discoveryCase.input.portfolio.briefs[0],
		sourceAudit: {
			sources: discoveryCase.input.portfolio.sources,
			evidence: discoveryCase.input.portfolio.evidence,
			claims: [
				{
					claimId: 'claim_1',
					kind: 'fact',
					materiality: 'high',
					requirementIds: ['req_accept_high'],
					supportingEvidenceIds: ['ev_1'],
					status: 'supported',
				},
			],
		},
		readiness: {
			ready: true,
			unsupportedMaterialClaimIds: [],
			unsubstantiatedMaterialClaimIds: [],
		},
		finalDecision: 'PASS',
	},
	expected: {
		unsupportedMaterialClaimIds: [],
		unsubstantiatedMaterialClaimIds: [],
		readinessReady: true,
		materialAnchorCoverage: 1,
		primaryRequirementSatisfactionRate: 1,
		socialOnlyMaterialSupportCount: 0,
		danglingEvidenceReferenceCount: 0,
		danglingSourceReferenceCount: 0,
		unsupportedMaterialClaimEscapeCount: 0,
	},
	rationale: 'valid evidence case',
	sourceOfTruth: 'editor-reviewed',
	enforceHardGates: true,
};

describe('research eval schema', () => {
	it('accepts a valid discovery evaluation case', () => {
		expect(parseEvalCase(discoveryCase).caseId).toBe('discovery-market-clean');
	});

	it('accepts a valid evidence evaluation case', () => {
		expect(parseEvalCase(evidenceCase).caseId).toBe('evidence-clean');
	});

	it('accepts the recapitalisation evidence regression case', () => {
		const recapCase = JSON.parse(
			readFileSync(
				join(process.cwd(), 'evals/research/cases/recapitalisation-evidence-contract.json'),
				'utf8',
			),
		);
		expect(parseEvalCase(recapCase).caseId).toBe('recapitalisation-evidence-contract');
	});

	it('accepts the corrected recapitalisation regression case', () => {
		const recapCase = JSON.parse(
			readFileSync(
				join(process.cwd(), 'evals/research/cases/recapitalisation-evidence-corrected.json'),
				'utf8',
			),
		);
		expect(parseEvalCase(recapCase).caseId).toBe('recapitalisation-evidence-corrected');
	});

	it('rejects an unsupported case kind', () => {
		expect(() =>
			parseEvalCase({
				...discoveryCase,
				kind: 'unknown',
			}),
		).toThrow();
	});

	it('rejects an unsupported market', () => {
		expect(() =>
			parseEvalCase({
				...discoveryCase,
				market: 'kenya',
			}),
		).toThrow();
	});

	it('rejects duplicate case IDs in one suite', () => {
		expect(() =>
			parseEvalSuite({
				suiteVersion: 1,
				cases: ['a.json', 'a.json'],
			}),
		).toThrow();
	});

	it('rejects absolute input artifact paths', () => {
		expect(() =>
			parseEvalSuite({
				suiteVersion: 1,
				cases: ['/tmp/a.json'],
			}),
		).toThrow();
	});

	it('requires expected labels and rationale', () => {
		const { rationale: _rationale, ...withoutRationale } = discoveryCase;
		expect(() => parseEvalCase(withoutRationale)).toThrow();
	});
});

describe('research eval report schema', () => {
	it('requires passed to match hard gates and case outcomes', () => {
		expect(() =>
			parseEvalReport({
				evaluatorVersion: 1,
				generatedAt: '2026-07-23T00:00:00.000Z',
				suitePath: 'evals/research/cases/suite.json',
				cases: [
					{
						caseId: 'evidence-clean',
						kind: 'evidence',
						passed: false,
						failures: ['readiness_mismatch'],
						observations: [],
						metrics: {},
					},
				],
				metrics: {},
				hardGateFailures: [],
				passed: true,
			}),
		).toThrow();
	});
});
