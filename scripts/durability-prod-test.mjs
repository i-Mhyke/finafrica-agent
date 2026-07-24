#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pollDurableScan } from './lib/durable-research-run-feed.mjs';

const baseUrl =
	process.env.RESEARCH_CONTROL_PLANE_URL ??
	'https://research-control-plane.ihunayamadu.workers.dev';
const token = process.env.RESEARCH_ADMIN_TOKEN;
const injectAfterPolls = Number(process.env.DURABILITY_INJECT_AFTER_POLLS ?? 20);

if (!token) {
	throw new Error('RESEARCH_ADMIN_TOKEN is required');
}

const input = {
	runKey: `scan-prod-durability-${new Date().toISOString().slice(0, 10)}-002`,
	trigger: 'manual',
	window: {
		start: '2026-07-22T00:00:00Z',
		end: '2026-07-23T00:00:00Z',
	},
	focus: null,
	maxDiscoveredBriefs: 2,
	maxAcceptedBriefs: 1,
	maxProviderCostUsd: 1,
	maxProviderRequests: 40,
};

async function admitScan() {
	const response = await fetch(`${baseUrl}/v1/research/scans`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(`Admission failed: ${response.status} ${await response.text()}`);
	}
	return response.json();
}

function redeployControlPlane() {
	process.stdout.write('injecting control-plane redeploy\n');
	execSync(
		'npx wrangler deploy --config workers/research-control-plane/wrangler.jsonc',
		{
			cwd: process.cwd(),
			stdio: 'inherit',
		},
	);
}

const admission = await admitScan();
const workflowInstanceId = admission.workflowInstanceId;
process.stdout.write(`runKey=${input.runKey}\nworkflowInstanceId=${workflowInstanceId}\n`);

let injected = false;
const startedAt = Date.now();

for (let attempt = 0; attempt < 300; attempt += 1) {
	const status = await pollDurableScan(workflowInstanceId, { baseUrl, token });
	const elapsed = Math.round((Date.now() - startedAt) / 1000);
	process.stdout.write(`poll=${attempt + 1} elapsed=${elapsed}s status=${status.status}\n`);

	if (!injected && attempt + 1 >= injectAfterPolls && status.status === 'running') {
		redeployControlPlane();
		injected = true;
	}

	if (['complete', 'completed', 'errored', 'terminated', 'failed'].includes(status.status)) {
		process.stdout.write(`final_status=${JSON.stringify(status)}\n`);
		process.stdout.write(`injected=${injected}\n`);
		process.exit(['complete', 'completed'].includes(status.status) ? 0 : 1);
	}

	await sleep(2_000);
}

throw new Error('Prod durability test timed out');
