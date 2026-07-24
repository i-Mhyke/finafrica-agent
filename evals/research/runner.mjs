import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { evaluateDiscoveryCase } from './discovery-evaluator.mjs';
import { evaluateEfficiencyCase } from './efficiency-evaluator.mjs';
import { evaluateEvidenceCase } from './evidence-evaluator.mjs';
import { parseEvalCase, parseEvalReport, parseEvalSuite } from './schema.mjs';
import { evaluateReviewCase } from './review-evaluator.mjs';

const EVALUATOR_VERSION = 1;

const evaluators = {
	discovery: evaluateDiscoveryCase,
	evidence: evaluateEvidenceCase,
	review: evaluateReviewCase,
	efficiency: evaluateEfficiencyCase,
};

const hardGateReasons = new Set([
	'unsupported_material_claim_escape',
	'dangling_evidence_reference',
	'dangling_source_reference',
	'cross_market_contamination',
	'review_pass_with_readiness_blocked',
	'review_pass_below_required_score',
	'dangling_evidence_count_mismatch',
	'dangling_source_count_mismatch',
	'cross_market_contamination_count_mismatch',
	'publication_eligibility_mismatch',
]);

const POSITIVE_CONTROLS = new Set(['evidence-clean', 'discovery-market-clean']);

export function loadSuite(suitePath) {
	const suiteDir = dirname(suitePath);
	const suite = parseEvalSuite(JSON.parse(readFileSync(suitePath, 'utf8')));
	return suite.cases.map((caseFile) => {
		const casePath = join(suiteDir, caseFile);
		return parseEvalCase(JSON.parse(readFileSync(casePath, 'utf8')));
	});
}

function collectHardGateFailures(caseResult, evalCase) {
	const gates = [];
	if (!evalCase.enforceHardGates) {
		return gates;
	}

	for (const failure of caseResult.failures) {
		if (hardGateReasons.has(failure)) {
			gates.push(`${evalCase.caseId}:${failure}`);
		}
	}
	for (const observation of caseResult.observations) {
		if (hardGateReasons.has(observation)) {
			gates.push(`${evalCase.caseId}:${observation}`);
		}
	}
	if (!caseResult.passed && POSITIVE_CONTROLS.has(evalCase.caseId)) {
		gates.push(`${evalCase.caseId}:positive_control_failed`);
	}
	return gates;
}

function aggregateMetrics(caseResults) {
	const totals = {};
	for (const result of caseResults) {
		for (const [key, value] of Object.entries(result.metrics)) {
			totals[key] = (totals[key] ?? 0) + value;
		}
	}
	return totals;
}

export function runSuite({ suitePath, generatedAt = new Date().toISOString() }) {
	const cases = loadSuite(suitePath);
	const caseResults = cases.map((evalCase) => {
		const evaluator = evaluators[evalCase.kind];
		const result = evaluator(evalCase);
		return {
			caseId: evalCase.caseId,
			kind: evalCase.kind,
			...result,
		};
	});

	const hardGateFailures = [];
	for (let index = 0; index < cases.length; index += 1) {
		hardGateFailures.push(...collectHardGateFailures(caseResults[index], cases[index]));
	}

	const report = {
		evaluatorVersion: EVALUATOR_VERSION,
		generatedAt,
		suitePath,
		cases: caseResults,
		metrics: aggregateMetrics(caseResults),
		hardGateFailures,
		passed: hardGateFailures.length === 0 && caseResults.every((item) => item.passed),
	};

	return parseEvalReport(report);
}

export function compareReports(baseline, candidate) {
	if (baseline.evaluatorVersion !== candidate.evaluatorVersion) {
		throw new Error('evaluatorVersion mismatch');
	}
	const base = parseEvalReport(baseline);
	const next = parseEvalReport(candidate);

	const baseById = new Map(base.cases.map((item) => [item.caseId, item]));
	const nextById = new Map(next.cases.map((item) => [item.caseId, item]));

	const addedCases = [...nextById.keys()].filter((caseId) => !baseById.has(caseId));
	const removedCases = [...baseById.keys()].filter((caseId) => !nextById.has(caseId));

	const regressions = [];
	const improvements = [];
	const unchangedFailures = [];

	for (const [caseId, baseCase] of baseById) {
		const nextCase = nextById.get(caseId);
		if (!nextCase) continue;
		if (baseCase.passed && !nextCase.passed) {
			regressions.push(caseId);
		} else if (!baseCase.passed && nextCase.passed) {
			improvements.push(caseId);
		} else if (!baseCase.passed && !nextCase.passed) {
			unchangedFailures.push(caseId);
		}
	}

	return {
		regressions,
		improvements,
		unchangedFailures,
		addedCases,
		removedCases,
	};
}

export function sha256File(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
