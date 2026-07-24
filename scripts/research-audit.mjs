#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createFlueClient } from '@flue/sdk';
import {
	formatCatchupSummary,
	formatLiveLine,
	formatWatcherStateJson,
	formatWatcherStatus,
} from './lib/research-audit-format.mjs';
import {
	createAuditProjection,
	redactAuditValue,
	resolveSafeRunOutputDir,
	stripGeneratedAt,
	writeAuditArtifacts,
} from './lib/research-audit-projection.mjs';
import {
	createResearchRunFeed,
	engineStatusFromRunEnd,
	RunFeedConnectionError,
	RunFeedDisconnectedError,
	RUN_FEED_STATES,
} from './lib/research-run-feed.mjs';
import { sessionPhase } from './lib/session-scope.mjs';

export {
	formatCatchupSummary,
	formatLiveLine,
	formatWatcherStateJson,
	formatWatcherStatus,
};
export { sessionPhase };

export function parseArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const args = { command: argv[2] };
	for (let i = 3; i < argv.length; i++) {
		const token = argv[i];
		if (token === '--json') {
			args.json = true;
			continue;
		}
		if (token === '--replay') {
			args.replay = true;
			continue;
		}
		if (token.startsWith('--')) {
			const key = token.slice(2);
			const value = argv[i + 1];
			if (!value || value.startsWith('--')) {
				throw new Error(`Missing value for --${key}`);
			}
			args[key] = value;
			i++;
		}
	}
	return args;
}

export function createAuditClient() {
	const token = process.env.RESEARCH_ADMIN_TOKEN;
	if (!token) {
		throw new Error('RESEARCH_ADMIN_TOKEN is required');
	}
	return createFlueClient({
		baseUrl: process.env.FLUE_BASE_URL || 'http://127.0.0.1:3583',
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
}

export function configuredSecrets() {
	return [
		process.env.RESEARCH_ADMIN_TOKEN,
		process.env.EXA_API_KEY,
		process.env.APIFY_API_TOKEN,
		process.env.OPENCODE_API_KEY,
		process.env.OPENAI_API_KEY,
	].filter((value) => typeof value === 'string' && value.length > 0);
}

export function safeCliErrorMessage(error) {
	const message = error instanceof Error ? error.message : 'Audit command failed';
	return String(redactAuditValue(message, configuredSecrets()));
}

function finalizeWatchResult(projection, feed, engineStatus, runRecordOverride) {
	const resolvedEngineStatus =
		engineStatus ?? String(runRecordOverride?.status ?? feed.runRecord?.status ?? 'active');
	return {
		report: projection.finalize(runRecordOverride ?? feed.runRecord ?? { status: resolvedEngineStatus }),
		engineStatus: resolvedEngineStatus,
	};
}

export async function watchRun({
	runId,
	json = false,
	replay = false,
	onEvent,
	staleMs = 60000,
	reconcileAfterMs = staleMs,
	client,
	write = (chunk) => process.stdout.write(chunk),
}) {
	const resolvedClient = client ?? createAuditClient();
	const projection = createAuditProjection({
		runId,
		secrets: configuredSecrets(),
	});

	let feedState = RUN_FEED_STATES.CONNECTING;
	let lastPersistedEventAt = null;
	let lastStatusLine = '';
	let catchingUp = true;
	let engineStatus = null;
	let errorClass = null;
	const renderedTimelineEntries = new Set();
	let replayPrinted = false;

	const emitStatus = (overrides = {}) => {
		const report = projection.snapshot();
		const line = formatWatcherStatus({
			state: feedState,
			runId,
			report: feedState === RUN_FEED_STATES.CONNECTING ? null : report,
			lastEventAt: lastPersistedEventAt,
			errorClass,
			engineStatus,
			...overrides,
		});
		if (!line || line === lastStatusLine) return report;
		if (json) {
			write(`${formatWatcherStateJson({
				state: overrides.state ?? feedState,
				runId,
				lastEventAt: lastPersistedEventAt,
				errorClass,
				engineStatus,
			})}\n`);
		} else {
			write(`\n${line}\n`);
		}
		lastStatusLine = line;
		return report;
	};

	const renderTimelineEntry = (timelineEntry, report, sourceEvent) => {
		const timelineKey = `${timelineEntry.eventIndex}:${timelineEntry.kind}:${timelineEntry.auditId ?? timelineEntry.turnId ?? timelineEntry.toolCallId ?? ''}`;
		if (renderedTimelineEntries.has(timelineKey)) return;
		renderedTimelineEntries.add(timelineKey);
		const line = formatLiveLine(timelineEntry, report);
		if (json) {
			write(`${JSON.stringify(timelineEntry)}\n`);
		} else if (line) {
			write(`${line}\n`);
		}
		onEvent?.({ event: sourceEvent, report, line, timelineEntry });
	};

	const feed = createResearchRunFeed({
		client: resolvedClient,
		runId,
		reconcileAfterMs,
		onState: (payload) => {
			feedState = payload.state;
			if (payload.runRecord?.status) engineStatus = String(payload.runRecord.status);
			if (payload.errorClass) errorClass = String(payload.errorClass);
			if (payload.lastEventAt) lastPersistedEventAt = String(payload.lastEventAt);
			emitStatus();
		},
	});

	emitStatus();

	try {
		for await (const event of feed) {
			const ingested = projection.ingest(event);
			if (ingested.activity && event.timestamp) {
				lastPersistedEventAt = event.timestamp;
			}

			const report = projection.snapshot();

			if (catchingUp && feedState === RUN_FEED_STATES.LIVE) {
				catchingUp = false;
				if (!json) write(`\n${formatCatchupSummary(report, lastPersistedEventAt)}\n`);
				if (replay && !replayPrinted) {
					for (const timelineEntry of report.timeline) {
						renderTimelineEntry(timelineEntry, report, event);
					}
					replayPrinted = true;
				}
			}

			if (!catchingUp) {
				emitStatus();
				const timelineEntry = report.timeline.at(-1);
				if (timelineEntry) {
					renderTimelineEntry(timelineEntry, report, event);
				}
			}

			if (event.type === 'run_end') {
				feedState = RUN_FEED_STATES.TERMINAL;
				engineStatus = engineStatusFromRunEnd(event);
				emitStatus();
				return finalizeWatchResult(projection, feed, engineStatus, {
					status: engineStatus,
					result: event.result,
					isError: event.isError,
				});
			}
		}

		if (feedState === RUN_FEED_STATES.TERMINAL) {
			emitStatus();
			return finalizeWatchResult(projection, feed, engineStatus);
		}

		return finalizeWatchResult(projection, feed, engineStatus, { status: 'active' });
	} catch (error) {
		if (error instanceof RunFeedConnectionError) {
			errorClass = error.errorClass;
			feedState = RUN_FEED_STATES.DISCONNECTED;
			emitStatus();
			throw error;
		}
		if (error instanceof RunFeedDisconnectedError) {
			errorClass = error.errorClass;
			feedState = RUN_FEED_STATES.DISCONNECTED;
			if (error.lastPersistedEventAt) lastPersistedEventAt = error.lastPersistedEventAt;
			emitStatus();
			return finalizeWatchResult(projection, feed, 'disconnected');
		}
		throw error;
	}
}

export async function exportRun({ runId, outDir }) {
	const client = createAuditClient();
	const events = await client.runs.events(runId);
	const projection = createAuditProjection({
		runId,
		secrets: configuredSecrets(),
	});
	for (const event of events) {
		try {
			projection.ingest(event);
		} catch (error) {
			if (error?.name === 'UnsupportedFlueEventVersionError') {
				throw new Error(`Unsupported Flue event version: ${String(error.received)}`);
			}
			throw error;
		}
	}
	const runRecord = await client.runs.get(runId).catch(() => null);
	const report = projection.finalize(runRecord ?? { status: 'complete' });
	const runKey = report.run.runKey;
	if (!runKey) throw new Error('Run key missing from projection');
	const targetDir = resolveSafeRunOutputDir(outDir, runKey, runId);
	mkdirSync(targetDir, { recursive: true });
	const { jsonPath, mdPath } = writeAuditArtifacts(targetDir, report);
	return { jsonPath, mdPath, report: stripGeneratedAt(report) };
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.command === 'watch') {
		if (!args['run-id']) throw new Error('--run-id is required');
		const { engineStatus } = await watchRun({
			runId: String(args['run-id']),
			json: Boolean(args.json),
			replay: Boolean(args.replay),
		});
		if (engineStatus === 'errored' || engineStatus === 'disconnected') process.exit(1);
		return;
	}
	if (args.command === 'export') {
		if (!args['run-id']) throw new Error('--run-id is required');
		const outDir = String(args.out || './research-runs');
		const result = await exportRun({ runId: String(args['run-id']), outDir });
		process.stdout.write(`${result.jsonPath}\n${result.mdPath}\n`);
		return;
	}
	throw new Error('Usage: research-audit.mjs <watch|export> --run-id <id> [--out dir] [--json] [--replay]');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((error) => {
		process.stderr.write(`${safeCliErrorMessage(error)}\n`);
		process.exit(1);
	});
}
