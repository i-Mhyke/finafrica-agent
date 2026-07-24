#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pollDurableScan } from './lib/durable-research-run-feed.mjs';

const baseUrl = process.env.RESEARCH_CONTROL_PLANE_URL ?? 'http://127.0.0.1:8787';
const token = process.env.RESEARCH_ADMIN_TOKEN;
const flueLogPath = process.env.FLUE_LOG_PATH ?? '/tmp/flue-durability.log';
const scanPath = process.argv[2] ?? 'scan.json';

if (!process.env.RESEARCH_ADMIN_TOKEN) {
	throw new Error('RESEARCH_ADMIN_TOKEN is required');
}

function readLog(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

function countProviderCompletions(log) {
	return [...log.matchAll(/provider-action@[^\s]+ completed/g)].length;
}

async function admitScan(input) {
	const response = await fetch(`${baseUrl}/v1/research/scans`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(`Admission failed: ${response.status}`);
	}
	return response.json();
}

async function restartFlue() {
	spawn('pkill', ['-f', 'flue dev --target cloudflare'], { stdio: 'ignore' });
	await sleep(2_000);
	const out = await import('node:fs').then((fs) =>
		fs.openSync(flueLogPath, 'a'),
	);
	const child = spawn('npm', ['run', 'dev'], {
		cwd: process.cwd(),
		detached: true,
		stdio: ['ignore', out, out],
		env: process.env,
	});
	child.unref();
	await sleep(12_000);
}

const input = JSON.parse(readFileSync(scanPath, 'utf8'));
const baseline = countProviderCompletions(readLog(flueLogPath));
const admission = await admitScan(input);
const workflowInstanceId = admission.workflowInstanceId;
process.stdout.write(`workflowInstanceId=${workflowInstanceId}\n`);

let killed = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
	const log = readLog(flueLogPath);
	const completedSinceStart = countProviderCompletions(log) - baseline;
	const status = await pollDurableScan(workflowInstanceId, { baseUrl, token });
	process.stdout.write(
		`poll=${attempt + 1} status=${status.status} provider_completed_since_start=${completedSinceStart}\n`,
	);

	if (!killed && completedSinceStart >= 2) {
		process.stdout.write('killing flue\n');
		await restartFlue();
		killed = true;
	}

	if (['complete', 'errored', 'terminated', 'failed'].includes(status.status)) {
		process.stdout.write(`final_status=${JSON.stringify(status)}\n`);
		process.stdout.write(
			`final_provider_completed_since_start=${countProviderCompletions(readLog(flueLogPath)) - baseline}\n`,
		);
		process.exit(status.status === 'complete' ? 0 : 1);
	}

	await sleep(2_000);
}

throw new Error('Durability test timed out');
