#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');

const SECRET_KEYS = new Set([
	'x-api-key',
	'api-key',
	'apikey',
	'authorization',
	'secret',
	'access_token',
	'refresh_token',
	'id_token',
]);

function isSecretKey(key) {
	return SECRET_KEYS.has(String(key).toLowerCase());
}

export function resolveOutputPath(rootDir, outPath) {
	return isAbsolute(outPath) ? outPath : join(rootDir, outPath);
}

export function writeCanaryOutput(rootDir, outPath, value) {
	const resolved = resolveOutputPath(rootDir, outPath);
	mkdirSync(dirname(resolved), { recursive: true });
	writeFileSync(resolved, `${JSON.stringify(sanitizeOutput(value), null, 2)}\n`);
}

function redactString(value) {
	return value
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
		.replace(/sk-[A-Za-z0-9]+/g, 'sk-[REDACTED]')
		.replace(/apify_api_[A-Za-z0-9]+/g, 'apify_api_[REDACTED]');
}

function sanitizeValue(value) {
	if (value == null || typeof value !== 'object') {
		return typeof value === 'string' ? redactString(value) : value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item));
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			isSecretKey(key) ? '[REDACTED]' : sanitizeValue(item),
		]),
	);
}

export function sanitizeOutput(value) {
	return sanitizeValue(value);
}

export function parseCanaryArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		switch (token) {
			case '--live':
				args.live = true;
				break;
			case '--run-key':
				args.runKey = argv[++index];
				break;
			case '--window-start':
				args.windowStart = argv[++index];
				break;
			case '--window-end':
				args.windowEnd = argv[++index];
				break;
			case '--out':
				args.out = argv[++index];
				break;
			case '--base-url':
				args.baseUrl = argv[++index];
				break;
			default:
				throw new Error(`unknown flag: ${token}`);
		}
	}
	return args;
}

export function buildCanaryRequest(args) {
	return {
		runKey: args.runKey,
		trigger: 'manual',
		window: {
			start: args.windowStart,
			end: args.windowEnd,
		},
		focus: null,
		maxDiscoveredBriefs: 2,
		maxAcceptedBriefs: 1,
		maxProviderRequests: 30,
		maxProviderCostUsd: 0.25,
	};
}

export function printCanaryPreflight() {
	console.log('LIVE PAID CANARY');
	console.log('markets: nigeria, ghana');
	console.log('max briefs: 2 discovered, 1 accepted');
	console.log('provider ceiling: $0.25');
	console.log('provider attempts: 30');
}

export async function runCanary(args, { fetchImpl = fetch, rootDir = root } = {}) {
	if (!args.live) {
		throw new Error('--live is required for paid canary execution');
	}
	if (!args.runKey || !args.windowStart || !args.windowEnd || !args.out) {
		throw new Error('missing required flag');
	}

	const baseUrl = args.baseUrl ?? 'http://localhost:3583';
	const body = buildCanaryRequest(args);

	printCanaryPreflight();

	const response = await fetchImpl(
		`${baseUrl}/workflows/market-intelligence-scan?wait=true`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		},
	);

	const text = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		writeCanaryOutput(rootDir, args.out, { status: 'invalid-response' });
		return 1;
	}

	if (!response.ok) {
		writeCanaryOutput(rootDir, args.out, {
			status: 'error',
			httpStatus: response.status,
			body: parsed,
		});
		return 1;
	}

	writeCanaryOutput(rootDir, args.out, parsed);
	return 0;
}

async function main() {
	try {
		const exitCode = await runCanary(parseCanaryArgs(process.argv.slice(2)));
		process.exit(exitCode);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	await main();
}
