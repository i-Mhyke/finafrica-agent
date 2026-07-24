#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	createAuditClient,
	exportRun,
	parseArgs,
	safeCliErrorMessage,
	watchRun,
} from './research-audit.mjs';
import {
	invokeDurableScan,
	isSuccessfulDurableScanStatus,
	isTerminalDurableScanStatus,
	pollDurableScan,
	resolveDurableScanPollConfig,
	resolveScanMode,
} from './lib/durable-research-run-feed.mjs';

export async function invokeScan(input, options = {}) {
	const mode = resolveScanMode(options);
	if (mode === 'durable') {
		return invokeDurableScan(input, options);
	}
	const client = createAuditClient();
	const invokeOptions = {
		input,
		...(options.waitResult ? { wait: 'result' } : {}),
	};
	const result = await client.workflows.invoke('market-intelligence-scan', invokeOptions);
	return result;
}

export async function watchScan(admission, options = {}) {
	const mode = resolveScanMode(options);
	if (mode === 'durable') {
		const workflowInstanceId = admission.workflowInstanceId ?? admission.id;
		if (!workflowInstanceId) {
			throw new Error('Durable workflow admission did not return workflowInstanceId');
		}
		const { maxAttempts, pollIntervalMs } = resolveDurableScanPollConfig(options);
		const poll = options.pollDurableScan ?? pollDurableScan;
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const status = await poll(String(workflowInstanceId), options);
			if (isTerminalDurableScanStatus(status.status)) {
				if (!isSuccessfulDurableScanStatus(status.status)) {
					const error = new Error(`Durable scan ended with status: ${status.status}`);
					error.report = status;
					throw error;
				}
				return { report: status };
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new Error(
			`Durable scan polling timed out after ${Math.round((maxAttempts * pollIntervalMs) / 1000)}s`,
		);
	}
	const runId = admission.runId ?? admission.id;
	if (!runId) throw new Error('Workflow admission did not return runId');
	return watchRun({ runId: String(runId) });
}

export function loadScanInput(path) {
	const raw = readFileSync(path, 'utf8');
	return JSON.parse(raw);
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.command !== 'scan') {
		throw new Error('Usage: run-research-scan.mjs scan --input <path> [--out dir]');
	}
	if (!args.input) throw new Error('--input is required');
	const input = loadScanInput(String(args.input));
	const mode = resolveScanMode({ mode: args.mode });
	process.stdout.write(`scanMode=${mode}\n`);
	process.stdout.write(`requestedInput=${JSON.stringify(input)}\n`);
	const admission = await invokeScan(input, { mode });
	const runId = admission.workflowInstanceId ?? admission.runId ?? admission.id;
	if (!runId) throw new Error('Workflow admission did not return run id');
	process.stdout.write(`runId=${runId}\n`);
	const { report } = await watchScan(admission, { mode });
	if (args.out) {
		const exported = await exportRun({ runId: String(runId), outDir: String(args.out) });
		process.stdout.write(`${exported.jsonPath}\n${exported.mdPath}\n`);
	}
	return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((error) => {
		process.stderr.write(`${safeCliErrorMessage(error)}\n`);
		process.exit(1);
	});
}
