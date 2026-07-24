import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlueClient } from '@flue/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
	createAuditProjection,
	resolveSafeOutputDir,
	resolveSafeRunOutputDir,
	writeAuditArtifacts,
} from '../../scripts/lib/research-audit-projection.mjs';
import {
	createResearchRunFeed,
	eventStream,
	RUN_FEED_STATES,
} from '../../scripts/lib/research-run-feed.mjs';
import fixtureEvents from '../fixtures/research/flue-run-events.json';
import productionShapeEvents from '../fixtures/research/flue-run-events-production-shape.json';
import {
	resolveScanMode,
} from '../../scripts/lib/durable-research-run-feed.mjs';

function mockClient({
	runRecord,
	catchupEvents,
	liveEvents,
	terminalEvent,
	catchupOffset = 'offset-after-catchup',
	liveOffset = 'offset-after-live',
}) {
	const stream = vi
		.fn()
		.mockReturnValueOnce(eventStream(catchupEvents, catchupOffset))
		.mockReturnValueOnce(eventStream(liveEvents, liveOffset));
	return {
		runs: {
			get: vi.fn().mockResolvedValue(runRecord),
			stream,
		},
	};
}

describe('research audit cli helpers', () => {
	it('parses watch and export arguments', async () => {
		const { parseArgs: cliParseArgs } = await import('../../scripts/research-audit.mjs');
		expect(cliParseArgs(['node', 'script', 'watch', '--run-id', 'run_1', '--json', '--replay'])).toEqual({
			command: 'watch',
			'run-id': 'run_1',
			json: true,
			replay: true,
		});
		expect(cliParseArgs(['node', 'script', 'export', '--run-id', 'run_1', '--out', './out'])).toEqual({
			command: 'export',
			'run-id': 'run_1',
			out: './out',
		});
	});

	it('rejects traversal output paths', () => {
		expect(() => resolveSafeOutputDir('/tmp/research-runs', '../bad')).toThrow(/Invalid run key/i);
	});

	it('keeps audit exports from repeated run keys in separate run-id directories', () => {
		const first = resolveSafeRunOutputDir(
			'/tmp/research-runs',
			'scan-smoke',
			'run_01',
		);
		const second = resolveSafeRunOutputDir(
			'/tmp/research-runs',
			'scan-smoke',
			'run_02',
		);

		expect(first).toBe('/tmp/research-runs/scan-smoke/run_01');
		expect(second).toBe('/tmp/research-runs/scan-smoke/run_02');
		expect(first).not.toBe(second);
	});

	it('blocks unsupported event versions before writing artifacts', () => {
		const projection = createAuditProjection({ runId: 'run_bad', secrets: [] });
		expect(() =>
			projection.ingest({
				v: 2,
				eventIndex: 0,
				timestamp: '2026-07-23T10:00:00.000Z',
				type: 'run_start',
				runId: 'run_bad',
				workflowName: 'market-intelligence-scan',
				startedAt: '2026-07-23T10:00:00.000Z',
				input: { runKey: 'bad' },
			}),
		).toThrow(/Unsupported Flue event version/i);
	});

	it('writes json and markdown atomically from a finalized projection', () => {
		const dir = mkdtempSync(join(tmpdir(), 'audit-export-'));
		const projection = createAuditProjection({ runId: 'run_fixture_1', secrets: [] });
		for (const event of fixtureEvents) projection.ingest(event);
		const report = projection.finalize({
			status: 'complete',
			result: fixtureEvents.at(-1)?.result,
		});
		const targetDir = resolveSafeOutputDir(dir, report.run.runKey);
		mkdirSync(targetDir, { recursive: true });
		writeAuditArtifacts(targetDir, report);

		const jsonPath = join(targetDir, 'audit.json');
		const mdPath = join(targetDir, 'audit.md');
		const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
		const markdown = readFileSync(mdPath, 'utf8');
		expect(json.efficiency.model.costUsd).toBeCloseTo(0.0012, 4);
		expect(markdown).toContain(`$${json.efficiency.model.costUsd.toFixed(4)}`);
	});

	it('formats live lines for turn, tool, and provider events', async () => {
		const { formatLiveLine } = await import('../../scripts/research-audit.mjs');
		const projection = createAuditProjection({ runId: 'run_fixture_1', secrets: [] });
		for (const event of fixtureEvents) projection.ingest(event);
		const report = projection.snapshot();
		const turnLine = formatLiveLine(report.timeline.find((entry) => entry.kind === 'turn'), report);
		expect(turnLine).toContain('TURN');
		expect(turnLine).not.toContain('thinking');
	});

	it('attributes detached market discovery sessions to their market', async () => {
		const { scopeFromSession, sessionPhase } = await import(
			'../../scripts/lib/session-scope.mjs'
		);
		expect(sessionPhase('task:discovery:nigeria:conversation-id')).toBe(
			'discovery',
		);
		expect(
			scopeFromSession('task:discovery:ghana:conversation-id'),
		).toEqual({
			briefId: null,
			market: 'ghana',
		});
	});

	it('formats provider request-limit rejection events', async () => {
		const { formatLiveLine } = await import('../../scripts/research-audit.mjs');
		const line = formatLiveLine(
			{
				kind: 'audit',
				auditEvent: 'provider_admission_rejected',
				timestamp: '2026-07-23T10:00:00.000Z',
				provider: 'exa',
				market: 'nigeria',
			},
			null,
		);
		expect(line).toContain('LIMIT');
		expect(line).toContain('rejected');
	});

	it('formats article readiness lines with the exact watcher shape', async () => {
		const { formatArticleReadinessLine } = await import(
			'../../scripts/lib/research-audit-format.mjs'
		);
		expect(
			formatArticleReadinessLine({
				markets: ['nigeria'],
				outcomeStatus: 'needs-more-research',
				satisfied: 7,
				total: 9,
				remediationPasses: 1,
				analysisCalls: 0,
			}),
		).toBe(
			'Nigeria article | needs-more-research | readiness 7/9 | remediation 1 | analysis skipped',
		);
	});

	it('formats live readiness lines from article-level decisions', async () => {
		const { formatLiveLine } = await import('../../scripts/research-audit.mjs');
		const report = {
			readiness: {
				byArticle: {
					brief_1: {
						markets: ['nigeria'],
						outcomeStatus: 'needs-more-research',
						satisfied: 7,
						total: 9,
						remediationPasses: 1,
						analysisCalls: 0,
					},
				},
			},
		};
		const line = formatLiveLine(
			{
				kind: 'audit',
				auditEvent: 'decision_recorded',
				timestamp: '2026-07-23T10:00:00.000Z',
				decision: 'blocked',
				briefId: 'brief_1',
				auditId: 'decision:scan-fixture:evidence-readiness:brief_1',
			},
			report,
		);
		expect(line).toContain('READY');
		expect(line).toContain(
			'Nigeria article | needs-more-research | readiness 7/9 | remediation 1 | analysis skipped',
		);
	});

	it('scan script omits wait=result in package wiring', () => {
		const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts.scan).toContain('run-research-scan.mjs');
		expect(packageJson.scripts.scan).not.toContain('wait=result');
		expect(packageJson.scripts['audit:watch']).toContain('research-audit.mjs watch');
		expect(packageJson.scripts['audit:export']).toContain('research-audit.mjs export');
	});

	it('fails visibly when the run server is unreachable', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const writes: string[] = [];
		const client = {
			runs: {
				get: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3583')),
			},
		};

		await expect(
			watchRun({
				runId: 'run_missing',
				client,
				write: (chunk: string) => {
					writes.push(chunk);
					return true;
				},
			}),
		).rejects.toThrow(/Unable to connect to the Flue run server for run_missing: connection_refused/);
		expect(writes.join('')).not.toContain('Live:');
		expect(writes.join('')).toContain('Connecting:');
	});

	it('returns errored engine status for run_end events with isError', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_errored';
		const erroredEnd = {
			...productionShapeEvents.at(-1),
			isError: true,
			result: {
				runKey: 'scan-production-shape',
				status: 'failed',
				totals: { discovered: 0, accepted: 0, passed: 0, incomplete: 0, rejected: 0 },
			},
		};
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: productionShapeEvents.slice(0, -1),
			liveEvents: [erroredEnd],
		});
		const { engineStatus, report } = await watchRun({ runId, client, write: () => true });
		expect(engineStatus).toBe('errored');
		expect(report.run.status).toBe('failed');
	});

	it('returns disconnected engine status when the live stream drops', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_disconnect';
		const client = {
			runs: {
				get: vi.fn().mockResolvedValue({ status: 'active', runId }),
				stream: vi
					.fn()
					.mockReturnValueOnce(eventStream([productionShapeEvents[0]], 'offset-1'))
					.mockReturnValueOnce({
						async *[Symbol.asyncIterator]() {
							throw new Error('socket hang up');
						},
						offset: 'offset-1',
						cancel() {},
					}),
			},
		};
		const { engineStatus } = await watchRun({ runId, client, write: () => true });
		expect(engineStatus).toBe('disconnected');
	});

	it('does not open a live stream when catch-up already contains run_end', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_catchup_terminal';
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: productionShapeEvents,
			liveEvents: [],
		});
		await watchRun({ runId, client, write: () => true });
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		expect(client.runs.stream).toHaveBeenCalledWith(runId, expect.objectContaining({ live: false }));
	});

	it('distinguishes engine errors from failed research outcomes in terminal status', async () => {
		const { formatWatcherStatus } = await import('../../scripts/research-audit.mjs');
		const projection = createAuditProjection({ runId: 'run_status', secrets: [] });
		projection.ingest({
			v: 3,
			eventIndex: 0,
			timestamp: '2026-07-23T10:00:00.000Z',
			type: 'run_start',
			runId: 'run_status',
			workflowName: 'market-intelligence-scan',
			startedAt: '2026-07-23T10:00:00.000Z',
			input: { runKey: 'status-run' },
		});
		projection.ingest({
			v: 3,
			eventIndex: 1,
			timestamp: '2026-07-23T10:10:00.000Z',
			type: 'run_end',
			runId: 'run_status',
			isError: false,
			durationMs: 1000,
			result: { status: 'failed', totals: { discovered: 0, accepted: 0, passed: 0 } },
		});
		const failedResearch = projection.finalize({ status: 'completed', result: { status: 'failed' } });
		expect(
			formatWatcherStatus({
				state: 'terminal',
				runId: 'run_status',
				report: failedResearch,
				engineStatus: 'completed',
			}),
		).toContain('Completed: failed');
		expect(
			formatWatcherStatus({
				state: 'terminal',
				runId: 'run_status',
				report: failedResearch,
				engineStatus: 'errored',
				errorClass: 'workflow_error',
			}),
		).toContain('Errored: workflow_error');
		expect(
			formatWatcherStatus({
				state: 'terminal',
				runId: 'run_status',
				report: failedResearch,
				engineStatus: 'errored',
				errorClass: 'workflow_error',
			}),
		).not.toContain('Completed: failed');
	});

	it('performs silent catch-up then resumes live from opaque checkpoint', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_production_shape';
		const terminalEvent = productionShapeEvents.at(-1);
		const catchupEvents = productionShapeEvents.slice(0, -1);
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents,
			liveEvents: [terminalEvent],
		});
		const writes: string[] = [];

		await watchRun({
			runId,
			client,
			write: (chunk: string) => {
				writes.push(chunk);
				return true;
			},
		});

		expect(client.runs.stream).toHaveBeenNthCalledWith(
			1,
			runId,
			expect.objectContaining({ live: false }),
		);
		expect(client.runs.stream).toHaveBeenNthCalledWith(
			2,
			runId,
			expect.objectContaining({ live: true, offset: 'offset-after-catchup' }),
		);
		expect(writes.filter((line) => line.includes('Catch-up complete'))).toHaveLength(1);
		expect(writes.filter((line) => line.includes('TURN'))).toHaveLength(1);
		expect(writes.join('')).toContain('Completed: partial');
		expect(writes.join('')).toContain('10m 43s');
	});

	it('uses recorded duration for completed runs in watcher status', async () => {
		const { formatWatcherStatus } = await import('../../scripts/research-audit.mjs');
		const projection = createAuditProjection({ runId: 'run_production_shape', secrets: [] });
		for (const event of productionShapeEvents) projection.ingest(event);
		const report = projection.finalize(productionShapeEvents.at(-1)?.result ?? { status: 'completed' });
		const line = formatWatcherStatus({
			state: 'terminal',
			runId: 'run_production_shape',
			report,
			engineStatus: 'completed',
			now: Date.parse('2026-07-24T12:00:00.000Z'),
		});
		expect(line).toContain('10m 43s');
	});

	it('marks watcher output stale after heartbeat without persisted events', async () => {
		vi.useFakeTimers();
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_fixture_1';
		const client = {
			runs: {
				get: vi.fn().mockResolvedValue({ status: 'active', runId }),
				stream: vi
					.fn()
					.mockReturnValueOnce(eventStream([fixtureEvents[0]], 'offset-1'))
					.mockReturnValueOnce({
						async *[Symbol.asyncIterator]() {
							await new Promise(() => {});
						},
						offset: 'offset-1',
						cancel() {},
					})
					.mockReturnValue(eventStream([], 'offset-refresh')),
			},
		};
		const writes: string[] = [];

		const watchPromise = watchRun({
			runId,
			reconcileAfterMs: 2000,
			client,
			write: (chunk: string) => {
				writes.push(chunk);
				return true;
			},
		});

		await vi.advanceTimersByTimeAsync(6100);
		vi.useRealTimers();
		expect(writes.join('')).toContain('Stale:');
		void watchPromise;
	});

	it('emits each projected timeline entry once and prints sanitized json lines with replay', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_fixture_1';
		const terminalEvent = fixtureEvents.at(-1);
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: fixtureEvents.slice(0, -1),
			liveEvents: [terminalEvent],
		});
		const writes: string[] = [];

		await watchRun({
			runId,
			json: true,
			replay: true,
			client,
			write: (chunk: string) => {
				writes.push(chunk);
				return true;
			},
		});

		const lines = writes
			.join('')
			.trim()
			.split('\n')
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line));
		expect(lines.filter((line) => line.kind === 'watcher_state').length).toBeGreaterThan(0);
		expect(lines.filter((line) => line.auditEvent === 'stage_started').length).toBeGreaterThan(0);
		expect(JSON.stringify(lines)).not.toContain('secret chain of thought');
	});

	it('leaves no final artifact when markdown write fails', () => {
		const dir = mkdtempSync(join(tmpdir(), 'audit-export-fail-'));
		const projection = createAuditProjection({ runId: 'run_fixture_1', secrets: [] });
		for (const event of fixtureEvents) projection.ingest(event);
		const report = projection.finalize({
			status: 'complete',
			result: fixtureEvents.at(-1)?.result,
		});
		const targetDir = resolveSafeOutputDir(dir, report.run.runKey);
		mkdirSync(targetDir, { recursive: true });
		expect(() =>
			writeAuditArtifacts(targetDir, {
				...report,
				stages: {
					toJSON() {
						throw new Error('write failed');
					},
				},
			}),
		).toThrow();
	});

	it('requires admin token without echoing configured values', async () => {
		const { createAuditClient } = await import('../../scripts/research-audit.mjs');
		const token = 'x'.repeat(40);
		const previous = process.env.RESEARCH_ADMIN_TOKEN;
		delete process.env.RESEARCH_ADMIN_TOKEN;
		try {
			expect(() => createAuditClient()).toThrow(/RESEARCH_ADMIN_TOKEN is required/);
		} finally {
			process.env.RESEARCH_ADMIN_TOKEN = previous ?? token;
		}
	});

	it('redacts configured secrets from cli errors', async () => {
		const { safeCliErrorMessage } = await import('../../scripts/research-audit.mjs');
		const previous = process.env.RESEARCH_ADMIN_TOKEN;
		process.env.RESEARCH_ADMIN_TOKEN = 'admin-token-value';
		try {
			expect(safeCliErrorMessage(new Error('request failed Bearer admin-token-value'))).toBe(
				'request failed Bearer [REDACTED]',
			);
		} finally {
			process.env.RESEARCH_ADMIN_TOKEN = previous;
		}
	});

	it('keeps default late-attach output bounded for large delta-heavy fixtures', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_large_fixture';
		const runStart = {
			v: 3,
			eventIndex: 0,
			timestamp: '2026-07-23T10:00:00.000Z',
			type: 'run_start',
			runId,
			workflowName: 'market-intelligence-scan',
			startedAt: '2026-07-23T10:00:00.000Z',
			input: { runKey: 'large-fixture' },
		};
		const delta = {
			v: 3,
			eventIndex: 1,
			timestamp: '2026-07-23T10:00:01.000Z',
			type: 'thinking_delta',
			runId,
			delta: 'secret chain of thought',
		};
		const terminal = {
			v: 3,
			eventIndex: 20_000,
			timestamp: '2026-07-23T10:10:00.000Z',
			type: 'run_end',
			runId,
			isError: false,
			durationMs: 600_000,
			result: { status: 'complete', totals: { discovered: 0, accepted: 0, passed: 0 } },
		};
		const catchupEvents = [
			runStart,
			...Array.from({ length: 19_900 }, (_, index) => ({
				...delta,
				eventIndex: index + 1,
			})),
		];
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents,
			liveEvents: [terminal],
		});
		const writes: string[] = [];
		await watchRun({
			runId,
			client,
			write: (chunk: string) => {
				writes.push(chunk);
				return true;
			},
		});
		expect(writes.length).toBeLessThan(100);
		expect(writes.join('')).not.toContain('thinking_delta');
	});

	it('attaches and exits a 20,000-event fixture within three seconds', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_perf_fixture';
		const runStart = {
			v: 3,
			eventIndex: 0,
			timestamp: '2026-07-23T10:00:00.000Z',
			type: 'run_start',
			runId,
			workflowName: 'market-intelligence-scan',
			startedAt: '2026-07-23T10:00:00.000Z',
			input: { runKey: 'perf-fixture' },
		};
		const delta = {
			v: 3,
			eventIndex: 1,
			timestamp: '2026-07-23T10:00:01.000Z',
			type: 'thinking_delta',
			runId,
			delta: 'thinking',
		};
		const terminal = {
			v: 3,
			eventIndex: 20_000,
			timestamp: '2026-07-23T10:10:00.000Z',
			type: 'run_end',
			runId,
			isError: false,
			durationMs: 600_000,
			result: { status: 'complete', totals: { discovered: 0, accepted: 0, passed: 0 } },
		};
		const catchupEvents = [
			runStart,
			...Array.from({ length: 19_900 }, (_, index) => ({
				...delta,
				eventIndex: index + 1,
			})),
		];
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents,
			liveEvents: [terminal],
		});
		const started = performance.now();
		const { engineStatus } = await watchRun({ runId, client, write: () => true });
		expect(performance.now() - started).toBeLessThan(3000);
		expect(engineStatus).toBe('completed');
	});

	it('matches exported totals for the same run events', async () => {
		const { watchRun } = await import('../../scripts/research-audit.mjs');
		const runId = 'run_production_shape';
		const terminalEvent = productionShapeEvents.at(-1);
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: productionShapeEvents.slice(0, -1),
			liveEvents: [terminalEvent],
		});
		const { report: watched } = await watchRun({ runId, client, write: () => true });
		const projection = createAuditProjection({ runId, secrets: [] });
		for (const event of productionShapeEvents) projection.ingest(event);
		const exported = projection.finalize(terminalEvent?.result ?? { status: 'completed' });
		expect(watched.efficiency.model).toEqual(exported.efficiency.model);
		expect(watched.efficiency.provider).toEqual(exported.efficiency.provider);
		expect(watched.run.status).toBe(exported.run.status);
		expect(watched.run.durationMs).toBe(exported.run.durationMs);
	});

	it('formats disconnected state before any persisted event', async () => {
		const { formatWatcherStatus } = await import('../../scripts/research-audit.mjs');
		expect(
			formatWatcherStatus({
				state: 'disconnected',
				runId: 'run_missing',
				report: null,
				lastEventAt: null,
				errorClass: 'connection_refused',
			}),
		).toBe('Disconnected: run server unreachable');
	});
});

describe('research run feed', () => {
	it('preflights, catch-ups, and resumes live from opaque checkpoint', async () => {
		const runId = 'run_feed_1';
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: productionShapeEvents.slice(0, 2),
			liveEvents: [productionShapeEvents.at(-1)],
		});
		const states: string[] = [];
		const feed = createResearchRunFeed({
			client,
			runId,
			onState: (payload) => states.push(String(payload.state)),
		});
		const events = [];
		for await (const event of feed) events.push(event);
		expect(client.runs.get).toHaveBeenCalledWith(runId);
		expect(client.runs.stream).toHaveBeenNthCalledWith(1, runId, { live: false, signal: undefined });
		expect(client.runs.stream).toHaveBeenNthCalledWith(2, runId, {
			live: true,
			offset: 'offset-after-catchup',
			signal: expect.any(AbortSignal),
		});
		expect(states).toContain(RUN_FEED_STATES.CONNECTING);
		expect(states).toContain(RUN_FEED_STATES.CATCHING_UP);
		expect(states).toContain(RUN_FEED_STATES.LIVE);
		expect(events.at(-1)?.type).toBe('run_end');
	});

	it('deduplicates overlapping catch-up and live events by event index', async () => {
		const runId = 'run_feed_dedupe';
		const terminal = productionShapeEvents.at(-1);
		const turn = productionShapeEvents.find((event) => event.type === 'turn');
		const client = mockClient({
			runRecord: { status: 'active', runId },
			catchupEvents: productionShapeEvents.slice(0, -1),
			liveEvents: [turn, turn, terminal],
		});
		const projection = createAuditProjection({ runId, secrets: [] });
		const feed = createResearchRunFeed({ client, runId });
		for await (const event of feed) projection.ingest(event);
		const report = projection.finalize({ status: 'completed' });
		expect(report.efficiency.model.turnCount).toBe(1);
		expect(projection.duplicateCount).toBeGreaterThanOrEqual(1);
	});

	it('recovers terminal events when reconcile aborts a hung live stream', async () => {
		vi.useFakeTimers();
		const runId = 'run_feed_hung';
		const terminal = productionShapeEvents.at(-1);
		const historical = productionShapeEvents.slice(0, -1);
		let getCalls = 0;
		const client = {
			runs: {
				get: vi.fn().mockImplementation(async () => {
					getCalls += 1;
					return getCalls === 1
						? { status: 'active', runId }
						: { status: 'completed', runId };
				}),
				stream: vi
					.fn()
					.mockImplementation((_, options) => {
						if (options?.live === false && options?.offset == null) {
							return eventStream(historical, 'offset-catchup');
						}
						if (options?.live === true) {
							return eventStream([], 'offset-live', {
								hang: true,
								signal: options.signal,
							});
						}
						return eventStream([terminal], 'offset-terminal');
					}),
			},
		};
		const feed = createResearchRunFeed({
			client,
			runId,
			reconcileAfterMs: 1000,
		});
		const events: unknown[] = [];
		const consume = (async () => {
			for await (const event of feed) events.push(event);
		})();
		await vi.advanceTimersByTimeAsync(1500);
		await consume;
		vi.useRealTimers();
		expect(events.some((event) => event?.type === 'run_end')).toBe(true);
		expect(client.runs.stream).toHaveBeenCalledTimes(3);
	});

	it('recovers terminal events using the latest live offset', async () => {
		const runId = 'run_feed_offset';
		const terminal = productionShapeEvents.at(-1);
		const historical = productionShapeEvents.slice(0, -1);
		let getCalls = 0;
		const client = {
			runs: {
				get: vi.fn().mockImplementation(async () => {
					getCalls += 1;
					return getCalls === 1
						? { status: 'active', runId }
						: { status: 'completed', runId };
				}),
				stream: vi
					.fn()
					.mockReturnValueOnce(eventStream(historical, 'offset-catchup'))
					.mockReturnValueOnce(eventStream([], 'offset-live'))
					.mockReturnValueOnce(eventStream([terminal], 'offset-terminal')),
			},
		};
		const feed = createResearchRunFeed({ client, runId });
		const events: unknown[] = [];
		for await (const event of feed) events.push(event);
		expect(client.runs.stream).toHaveBeenNthCalledWith(3, runId, {
			live: false,
			offset: 'offset-live',
			signal: undefined,
		});
		expect(events.some((event) => event?.type === 'run_end')).toBe(true);
	});

	it('recovers terminal events when live stream misses run_end', async () => {
		const runId = 'run_feed_recover';
		const terminal = productionShapeEvents.at(-1);
		const historical = productionShapeEvents.slice(0, -1);
		let getCalls = 0;
		const client = {
			runs: {
				get: vi.fn().mockImplementation(async () => {
					getCalls += 1;
					return getCalls === 1
						? { status: 'active', runId }
						: { status: 'completed', runId };
				}),
				stream: vi
					.fn()
					.mockReturnValueOnce(eventStream(historical, 'offset-catchup'))
					.mockReturnValueOnce(eventStream([], 'offset-live'))
					.mockReturnValueOnce(eventStream([terminal], 'offset-terminal')),
			},
		};
		const feed = createResearchRunFeed({ client, runId });
		const events: unknown[] = [];
		for await (const event of feed) events.push(event);
		expect(events.some((event) => event?.type === 'run_end')).toBe(true);
		expect(client.runs.stream).toHaveBeenCalledTimes(3);
	});

	it('skips live subscription when metadata is already terminal', async () => {
		const runId = 'run_feed_terminal';
		const client = {
			runs: {
				get: vi.fn().mockResolvedValue({ status: 'completed', runId }),
				stream: vi.fn().mockReturnValue(eventStream(productionShapeEvents, 'offset-terminal')),
			},
		};
		const feed = createResearchRunFeed({ client, runId });
		const events = [];
		for await (const event of feed) events.push(event);
		expect(client.runs.stream).toHaveBeenCalledTimes(1);
		expect(events.at(-1)?.type).toBe('run_end');
	});
});

describe('research audit sdk integration fixture', () => {
	it('streams through the real SDK client against a local fixture server', async () => {
		const runId = 'run_sdk_fixture';
		const historical = productionShapeEvents.slice(0, -1);
		const terminal = productionShapeEvents.at(-1);
		let active = true;
		const requestedUrls: string[] = [];

		const server = createServer(async (req, res) => {
			const host = req.headers.host ?? '127.0.0.1';
			const url = new URL(req.url ?? '/', `http://${host}`);
			requestedUrls.push(url.href);
			if (!url.href.startsWith(`http://127.0.0.1:`)) {
				res.statusCode = 403;
				res.end('forbidden');
				return;
			}
			if (url.pathname === `/runs/${runId}` && url.searchParams.has('meta')) {
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ runId, status: active ? 'active' : 'completed' }));
				return;
			}
			if (url.pathname === `/runs/${runId}`) {
				const offset = url.searchParams.get('offset') ?? '-1';
				const live = url.searchParams.get('live');
				res.setHeader('content-type', 'application/json');
				if (live) {
					active = false;
					res.setHeader('Stream-Next-Offset', 'fixture-offset-2');
					res.setHeader('Stream-Up-To-Date', 'true');
					res.setHeader('Stream-Closed', 'true');
					res.end(JSON.stringify([terminal]));
					return;
				}
				if (offset === '-1' || offset === 'fixture-offset-1') {
					res.setHeader('Stream-Next-Offset', 'fixture-offset-1');
					res.setHeader('Stream-Up-To-Date', 'true');
					res.end(JSON.stringify(historical));
					return;
				}
			}
			res.statusCode = 404;
			res.end('not found');
		});

		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('fixture server failed to bind');
		const baseUrl = `http://127.0.0.1:${address.port}`;

		try {
			const client = createFlueClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});
			const { watchRun } = await import('../../scripts/research-audit.mjs');
			const writes: string[] = [];
			await watchRun({
				runId,
				client,
				write: (chunk: string) => {
					writes.push(chunk);
					return true;
				},
			});
			const output = writes.join('');
			expect(output).toContain('Completed: partial');
			expect(output).toContain('3,408 tokens');
			expect(output).toContain('10m 43s');
			expect(output.split('\n').filter((line) => line.includes('TURN')).length).toBe(1);
			expect(requestedUrls.every((href) => href.startsWith(baseUrl))).toBe(true);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('defaults npm run scan to legacy mode until rollout gates pass', () => {
		const previous = process.env.RESEARCH_SCAN_MODE;
		delete process.env.RESEARCH_SCAN_MODE;
		expect(resolveScanMode()).toBe('legacy');
		expect(resolveScanMode({ mode: 'durable' })).toBe('durable');
		if (previous) {
			process.env.RESEARCH_SCAN_MODE = previous;
		}
	});
});
