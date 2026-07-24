#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareReports, runSuite, sha256File } from '../evals/research/runner.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const defaultSuite = 'evals/research/cases/suite.json';

function printJson(value) {
	console.log(JSON.stringify(value, null, 2));
}

function parseArgs(argv) {
	const args = { command: argv[0] };
	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		switch (token) {
			case '--suite':
				args.suite = argv[++index];
				break;
			case '--out':
				args.out = argv[++index];
				break;
			case '--json':
				args.json = true;
				break;
			case '--baseline':
				args.baseline = argv[++index];
				break;
			case '--candidate':
				args.candidate = argv[++index];
				break;
			default:
				throw new Error(`unknown flag: ${token}`);
		}
	}
	return args;
}

function relativeSuitePath(suitePath) {
	return suitePath.startsWith(root) ? suitePath.slice(root.length + 1) : suitePath;
}

function renderMarkdown(report) {
	const lines = [
		'# Research Evaluation Report',
		'',
		`- Evaluator version: ${report.evaluatorVersion}`,
		`- Generated at: ${report.generatedAt}`,
		`- Suite: ${report.suitePath}`,
		`- Passed: ${report.passed}`,
		'',
		'## Cases',
		'',
	];
	for (const item of report.cases) {
		lines.push(
			`- ${item.caseId} (${item.kind}): ${item.passed ? 'PASS' : 'FAIL'}`,
			`  - failures: ${item.failures.join(', ') || 'none'}`,
			`  - observations: ${item.observations.join(', ') || 'none'}`,
		);
	}
	lines.push('', '## Hard Gates', '');
	if (report.hardGateFailures.length === 0) {
		lines.push('- none');
	} else {
		for (const failure of report.hardGateFailures) {
			lines.push(`- ${failure}`);
		}
	}
	return `${lines.join('\n')}\n`;
}

function resolveOutDir(out) {
	if (!out) return null;
	return out.startsWith('/') ? out : join(root, out);
}

function writeRunOutputs(report, outDir, suitePath) {
	mkdirSync(outDir, { recursive: true });
	const reportPath = join(outDir, 'report.json');
	const markdownPath = join(outDir, 'report.md');
	const manifestPath = join(outDir, 'manifest.json');
	const suiteDir = dirname(join(root, suitePath));
	const caseFiles = report.cases.map((item) => `${item.caseId}.json`);

	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(markdownPath, renderMarkdown(report));
	writeFileSync(
		manifestPath,
		`${JSON.stringify(
			{
				evaluatorVersion: report.evaluatorVersion,
				suitePath: relativeSuitePath(suitePath),
				caseIds: report.cases.map((item) => item.caseId),
				caseFileSha256: Object.fromEntries(
					caseFiles.map((file) => [file, sha256File(join(suiteDir, file))]),
				),
				generatedAt: report.generatedAt,
			},
			null,
			2,
		)}\n`,
	);
}

function runCommand(args) {
	const suitePath = join(root, args.suite ?? defaultSuite);
	const report = runSuite({
		suitePath,
		generatedAt: new Date().toISOString(),
	});
	report.suitePath = relativeSuitePath(suitePath);

	if (args.out) {
		writeRunOutputs(report, resolveOutDir(args.out), relativeSuitePath(suitePath));
	}

	if (args.json || !args.out) {
		printJson(report);
	}

	process.exit(report.passed ? 0 : 1);
}

function compareCommand(args) {
	if (!args.baseline || !args.candidate) {
		throw new Error('compare requires --baseline and --candidate');
	}
	const baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
	const candidate = JSON.parse(readFileSync(args.candidate, 'utf8'));
	const comparison = compareReports(baseline, candidate);
	printJson(comparison);
	process.exit(0);
}

function main() {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.command === 'run') {
			runCommand(args);
			return;
		}
		if (args.command === 'compare') {
			compareCommand(args);
			return;
		}
		throw new Error(`unknown command: ${args.command ?? '(missing)'}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}
}

main();
