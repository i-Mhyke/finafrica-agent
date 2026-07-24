import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	createAuditProjection,
	redactAuditValue,
	renderAuditMarkdown,
	resolveSafeOutputDir,
	stripGeneratedAt,
	SUPPORTED_FLUE_EVENT_VERSION,
} from '../../scripts/lib/research-audit-projection.mjs';
import fixtureEvents from '../fixtures/research/flue-run-events.json';
import productionShapeEvents from '../fixtures/research/flue-run-events-production-shape.json';

const SECRET = 'sk-live-secret-token-abc123';

describe('research audit projection', () => {
	function project(events = fixtureEvents, runId = 'run_fixture_1') {
		const projection = createAuditProjection({ runId, secrets: [SECRET] });
		for (const event of events) projection.ingest(event);
		return projection.finalize({ status: 'complete', result: events.at(-1)?.result });
	}

	it('counts terminal turn and tool events once', () => {
		const report = project();
		expect(report.efficiency.model.turnCount).toBe(2);
		expect(report.efficiency.model.inputTokens).toBe(55188 + 23214);
		expect(report.efficiency.model.outputTokens).toBe(134 + 88);
		expect(report.efficiency.model.costUsd).toBeCloseTo(0.0012, 4);
		expect(report.efficiency.tools).toHaveLength(1);
		expect(report.efficiency.tools[0].toolName).toBe('search_web');
	});

	it('tracks active turns until their terminal event arrives', () => {
		const projection = createAuditProjection({ runId: 'run_fixture_1', secrets: [] });
		for (const event of fixtureEvents.slice(0, 4)) projection.ingest(event);

		const active = projection.snapshot().activeTurns;
		expect(active).toHaveLength(1);
		expect(active[0]).toEqual(
			expect.objectContaining({
				turnId: 'turn_1',
				phase: 'discovery',
				agent: 'discovery_orchestrator',
				modelRole: 'fast',
				status: 'active',
			}),
		);

		projection.ingest(fixtureEvents[4]);
		expect(projection.snapshot().activeTurns).toHaveLength(0);
	});

	it('aggregates repeated calls of the same tool', () => {
		const duplicateTool = {
			...fixtureEvents.find((event) => event.type === 'tool'),
			eventIndex: 100,
			toolCallId: 'tool_2',
			durationMs: 200,
			isError: true,
		};
		const report = project([...fixtureEvents, duplicateTool]);
		expect(report.efficiency.tools).toEqual([
			{
				toolName: 'search_web',
				callCount: 2,
				errorCount: 1,
				blockedCount: 0,
				statusCounts: {},
				totalDurationMs: 2000,
			},
		]);
	});

	it('counts locally blocked tools separately from provider attempts', () => {
		const tool = fixtureEvents.find((event) => event.type === 'tool');
		const blockedTool = {
			...tool,
			eventIndex: 103,
			toolCallId: 'tool_limit',
			result: {
				details: {
					output: {
						status: 'limit-reached',
					},
				},
			},
		};
		const report = project([...fixtureEvents, blockedTool]);
		const search = report.efficiency.tools.find(
			(entry) => entry.toolName === 'search_web',
		);

		expect(search).toEqual(
			expect.objectContaining({
				callCount: 2,
				blockedCount: 1,
				statusCounts: { 'limit-reached': 1 },
			}),
		);
		expect(report.efficiency.provider.attemptCount).toBe(2);
		expect(renderAuditMarkdown(report)).toContain(
			'search_web: 2 calls, 1 blocked',
		);
	});

	it('counts budget rejections separately from admitted provider attempts', () => {
		const providerStart = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditEvent === 'provider_attempt_started',
		);
		const budgetRejection = {
			...providerStart,
			eventIndex: 101,
			attributes: {
				...providerStart.attributes,
				auditEvent: 'budget_admission_rejected',
				auditId: 'budget:call_rejected:1',
				status: 'failed',
				errorClass: 'budget_exhausted',
			},
		};
		const report = project([...fixtureEvents, budgetRejection]);
		expect(report.efficiency.provider.attemptCount).toBe(2);
		expect(report.efficiency.provider.budgetRejectionCount).toBe(1);
	});

	it('counts provider request-limit rejections without inflating provider attempts', () => {
		const providerStart = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditEvent === 'provider_attempt_started',
		);
		const requestRejection = {
			...providerStart,
			eventIndex: 102,
			attributes: {
				...providerStart.attributes,
				auditEvent: 'provider_admission_rejected',
				auditId: 'provider-admission:call_rejected:1',
				status: 'failed',
				errorClass: 'provider_request_limit',
			},
		};
		const report = project([...fixtureEvents, requestRejection]);
		expect(report.efficiency.provider.attemptCount).toBe(2);
		expect(report.efficiency.provider.requestRejectionCount).toBe(1);
	});

	it('projects admitted run limits from pipeline start', () => {
		const events = fixtureEvents.map((event) =>
			event.type === 'log' && event.attributes?.auditEvent === 'pipeline_started'
				? {
						...event,
						attributes: {
							...event.attributes,
							counts: {
								maxDiscoveredBriefs: 3,
								maxAcceptedBriefs: 2,
								maxProviderRequests: 40,
								maxProviderCostUsd: 1,
							},
						},
					}
				: event,
		);
		const report = project(events);
		expect(report.run.limits).toEqual({
			maxDiscoveredBriefs: 3,
			maxAcceptedBriefs: 2,
			maxProviderRequests: 40,
			maxProviderCostUsd: 1,
		});
	});

	it('deduplicates replayed batches without changing totals', () => {
		const first = stripGeneratedAt(project());
		const replayed = stripGeneratedAt(project([...fixtureEvents, ...fixtureEvents]));
		expect(replayed.efficiency.model).toEqual(first.efficiency.model);
		expect(replayed.timeline).toHaveLength(first.timeline.length);
	});

	it('keeps artifact totals and decision summaries idempotent by audit id', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const artifact = {
			...baseLog,
			eventIndex: 110,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'artifact_recorded',
				auditId: 'artifact:scan-fixture:pipeline:none',
				phase: 'pipeline',
				stageId: null,
				status: 'succeeded',
				counts: { sources: 4, evidence: 6, claims: 2, providerReceipts: 3 },
			},
		};
		const decision = {
			...baseLog,
			eventIndex: 112,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'decision_recorded',
				auditId: 'decision:scan-fixture:brief-validation:brief_1',
				phase: 'brief-validation',
				stageId: null,
				briefId: 'brief_1',
				status: 'succeeded',
				decision: 'REFINE',
			},
		};
		const report = project([
			...fixtureEvents,
			artifact,
			{ ...artifact, eventIndex: 111 },
			decision,
			{
				...decision,
				eventIndex: 113,
				attributes: { ...decision.attributes, decision: 'ACCEPT' },
			},
		]);

		expect(report.artifacts).toEqual({
			sourceCount: 4,
			evidenceCount: 6,
			claimCount: 2,
			providerReceiptCount: 3,
		});
		expect(
			report.decisions.filter(
				(entry) => entry.auditId === 'decision:scan-fixture:brief-validation:brief_1',
			),
		).toEqual([
			expect.objectContaining({
				decision: 'ACCEPT',
			}),
		]);
	});

	it('keeps unknown provider cost separate from admitted estimate', () => {
		const report = project();
		expect(report.efficiency.provider.admittedEstimateUsd).toBeCloseTo(0.014, 3);
		expect(report.efficiency.provider.reportedCostUsd).toBe(0);
		expect(report.efficiency.provider.unpricedCalls).toBe(2);
	});

	it('marks unclosed stages interrupted after run end', () => {
		const report = project();
		const validationStage = report.stages.find((stage) => stage.phase === 'brief-validation');
		expect(validationStage?.status).toBe('interrupted');
		expect(report.warnings.some((warning) => warning.code === 'stage_unclosed')).toBe(true);
	});

	it('redacts configured secrets and excludes raw content fields', () => {
		const report = project();
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain(SECRET);
		expect(serialized).not.toContain('secret chain of thought');
		expect(serialized).not.toContain('prompt');
		expect(redactAuditValue('Bearer abc.def', [SECRET])).toBe('Bearer [REDACTED]');
	});

	it('rejects unsupported event versions before projection mutates state', () => {
		const projection = createAuditProjection({ runId: 'run_x' });
		expect(() =>
			projection.ingest({
				v: 2,
				eventIndex: 0,
				timestamp: '2026-07-23T10:00:00.000Z',
				type: 'run_start',
				runId: 'run_x',
				workflowName: 'market-intelligence-scan',
				startedAt: '2026-07-23T10:00:00.000Z',
				input: {},
			}),
		).toThrow(/Unsupported Flue event version/i);
	});

	it('keeps markdown totals aligned with json totals', () => {
		const report = project();
		const markdown = renderAuditMarkdown(report);
		expect(markdown).toContain(`$${report.efficiency.model.costUsd.toFixed(4)}`);
		expect(markdown).toContain(`Discovered: ${report.efficiency.outcomes.discovered}`);
		expect(markdown).toContain(`Accepted: ${report.efficiency.outcomes.accepted}`);
	});

	it('projects partial final results', () => {
		const report = project();
		expect(report.efficiency.outcomes.discovered).toBe(12);
		expect(report.efficiency.outcomes.accepted).toBe(1);
		expect(report.run.status).toBe('partial');
	});

	it('uses the run record status when no terminal run event was streamed', () => {
		const projection = createAuditProjection({ runId: 'run_failed', secrets: [] });
		projection.ingest({
			v: 3,
			eventIndex: 0,
			timestamp: '2026-07-23T10:00:00.000Z',
			type: 'run_start',
			runId: 'run_failed',
			workflowName: 'market-intelligence-scan',
			startedAt: '2026-07-23T10:00:00.000Z',
			input: { runKey: 'failed-run' },
		});
		const report = projection.finalize({ status: 'failed' });
		expect(report.run.status).toBe('failed');
	});

	it('projects 10,000 retained events within two seconds', () => {
		const baseTurn = fixtureEvents.find((event) => event.type === 'turn');
		const events = [
			{
				v: SUPPORTED_FLUE_EVENT_VERSION,
				eventIndex: 0,
				timestamp: '2026-07-23T10:00:00.000Z',
				type: 'run_start',
				runId: 'run_perf',
				workflowName: 'market-intelligence-scan',
				startedAt: '2026-07-23T10:00:00.000Z',
				input: { runKey: 'perf-run' },
			},
		];
		for (let i = 1; i < 10_000; i++) {
			events.push({
				...baseTurn,
				v: SUPPORTED_FLUE_EVENT_VERSION,
				eventIndex: i,
				turnId: `turn_${i}`,
				timestamp: `2026-07-23T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
			});
		}
		events.push({
			v: SUPPORTED_FLUE_EVENT_VERSION,
			eventIndex: 10_000,
			timestamp: '2026-07-23T10:10:00.000Z',
			type: 'run_end',
			runId: 'run_perf',
			isError: false,
			durationMs: 600_000,
			result: { status: 'complete', totals: { discovered: 0, accepted: 0, passed: 0 } },
		});

		const started = performance.now();
		const report = project(events, 'run_perf');
		const elapsed = performance.now() - started;
		expect(report.efficiency.model.turnCount).toBe(9999);
		expect(elapsed).toBeLessThan(2000);
	});

	it('rejects traversal output paths', () => {
		expect(() => resolveSafeOutputDir('/tmp/research-runs', '../escape')).toThrow(
			/Invalid run key segment/i,
		);
	});

	it('attributes turns by agent, brief, and market from audit session scopes', () => {
		const events = [
			...fixtureEvents,
			{
				v: 3,
				eventIndex: 18,
				timestamp: '2026-07-23T10:01:08.250Z',
				type: 'log',
				level: 'info',
				message: 'research.audit',
				attributes: {
					auditSchemaVersion: '1',
					auditEvent: 'stage_started',
					auditId: 'agent-task:scan-fixture:brief-validator:brief_1:1',
					runKey: 'scan-fixture',
					phase: 'brief-validation',
					stageId: 'agent-task:scan-fixture:brief-validator:brief_1:1',
					briefId: 'brief_1',
					market: null,
					agent: 'brief_validator',
					modelRole: 'default',
					sessionName: 'brief-validator:brief_1',
					attempt: 1,
					status: 'started',
					startedAt: '2026-07-23T10:01:08.250Z',
					completedAt: null,
					durationMs: null,
					provider: null,
					providerRequestId: null,
					operation: null,
					mode: null,
					admittedEstimateUsd: null,
					reportedCostUsd: null,
					decision: null,
					counts: {},
					errorClass: null,
					errorCode: null,
				},
			},
		];
		const report = project(events);
		expect(report.efficiency.byAgent.some((entry) => entry.key === 'brief_validator')).toBe(true);
		expect(report.efficiency.byBrief.some((entry) => entry.key === 'brief_1')).toBe(true);
	});

	it('correlates out-of-order terminal turn events by turn id', () => {
		const events = fixtureEvents.filter((event) => event.type !== 'turn' || event.turnId !== 'turn_2');
		events.push({
			v: 3,
			eventIndex: 99,
			timestamp: '2026-07-23T10:01:25.000Z',
			type: 'turn',
			runId: 'run_fixture_1',
			turnId: 'turn_2',
			purpose: 'agent',
			durationMs: 11700,
			isError: false,
			session: 'brief-validator:brief_1',
			request: {
				providerId: 'opencode-go',
				providerName: 'opencode-go',
				modelId: 'kimi-k2.6',
			},
			response: {
				usage: {
					input: 23214,
					output: 88,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 23302,
					cost: {
						input: 0.0009,
						output: 0.0001,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0.001,
					},
				},
			},
		});
		const report = project(events);
		expect(report.efficiency.model.turnCount).toBe(2);
		expect(report.efficiency.model.inputTokens).toBe(55188 + 23214);
	});

	it('treats thinking deltas as watcher activity without retaining content', () => {
		const projection = createAuditProjection({ runId: 'run_fixture_1', secrets: [] });
		const delta = fixtureEvents.find((event) => event.type === 'thinking_delta');
		const ingested = projection.ingest(delta);
		expect(ingested.activity).toBe(true);
		const report = projection.snapshot();
		expect(JSON.stringify(report)).not.toContain('secret chain of thought');
	});

	it('attributes production-shaped turns by agent, market, and requested model', () => {
		const report = project(productionShapeEvents, 'run_production_shape');
		expect(report.efficiency.byAgent).toContainEqual(
			expect.objectContaining({ key: 'discovery_nigeria' }),
		);
		expect(report.efficiency.byMarket).toContainEqual(
			expect.objectContaining({ key: 'nigeria' }),
		);
		expect(report.efficiency.byModel).toContainEqual(
			expect.objectContaining({ key: 'opencode-go/deepseek-v4-flash' }),
		);
		expect(report.run.durationMs).toBe(643274);
	});

	it('loads the sanitized fixture from disk', () => {
		const events = JSON.parse(
			readFileSync(join(process.cwd(), 'tests/fixtures/research/flue-run-events.json'), 'utf8'),
		);
		expect(events.length).toBeGreaterThan(10);
	});

	it('aggregates readiness by article from requirement and outcome decisions', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const requirement = {
			...baseLog,
			eventIndex: 120,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'decision_recorded',
				auditId: 'decision:scan-fixture:evidence-requirement:brief_1:req_1',
				phase: 'evidence-readiness',
				briefId: 'brief_1',
				market: 'nigeria',
				status: 'succeeded',
				decision: 'satisfied',
				entityId: 'req_1',
				reasonCodes: [],
			},
		};
		const requirementTwo = {
			...requirement,
			eventIndex: 121,
			attributes: {
				...requirement.attributes,
				auditId: 'decision:scan-fixture:evidence-requirement:brief_1:req_2',
				decision: 'weak',
				entityId: 'req_2',
				reasonCodes: ['requirement_missing_anchor'],
				market: 'ghana',
			},
		};
		const readiness = {
			...requirement,
			eventIndex: 122,
			attributes: {
				...requirement.attributes,
				auditId: 'decision:scan-fixture:evidence-readiness:brief_1',
				decision: 'blocked',
				entityId: 'brief_1',
				market: null,
				reasonCodes: [],
			},
		};
		const outcome = {
			...requirement,
			eventIndex: 123,
			attributes: {
				...requirement.attributes,
				auditId: 'decision:scan-fixture:article-outcome:brief_1',
				phase: 'article-outcome',
				decision: 'needs-more-research',
				entityId: 'brief_1',
				market: null,
			},
		};
		const analysisStage = {
			...baseLog,
			eventIndex: 124,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'stage_completed',
				auditId: 'stage:scan-fixture:structural-analysis:brief_1:none:1',
				phase: 'structural-analysis',
				stageId: 'stage:scan-fixture:structural-analysis:brief_1:none:1',
				briefId: 'brief_1',
				status: 'succeeded',
			},
		};
		const report = project([
			...fixtureEvents,
			requirement,
			requirementTwo,
			readiness,
			outcome,
			analysisStage,
		]);

		expect(report.readiness.byArticle.brief_1).toEqual({
			status: 'blocked',
			markets: ['nigeria', 'ghana'],
			outcomeStatus: 'needs-more-research',
			satisfied: 1,
			total: 2,
			remediationPasses: 0,
			analysisCalls: 1,
		});
		expect(
			report.decisions.find(
				(entry) => entry.auditId === 'decision:scan-fixture:evidence-requirement:brief_1:req_2',
			),
		).toEqual(
			expect.objectContaining({
				entityId: 'req_2',
				reasonCodes: ['requirement_missing_anchor'],
			}),
		);
	});

	it('retains pre- and post-remediation requirement decisions with distinct audit ids', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const beforeRemediation = {
			...baseLog,
			eventIndex: 130,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'decision_recorded',
				auditId: 'decision:scan-fixture:evidence-requirement:brief_1:req_1',
				phase: 'evidence-readiness',
				briefId: 'brief_1',
				market: 'nigeria',
				status: 'succeeded',
				decision: 'weak',
				entityId: 'req_1',
				reasonCodes: ['requirement_missing_anchor'],
				counts: { pass: 0 },
			},
		};
		const afterRemediation = {
			...beforeRemediation,
			eventIndex: 131,
			attributes: {
				...beforeRemediation.attributes,
				auditId: 'decision:scan-fixture:evidence-requirement:brief_1:req_1:pass1',
				decision: 'satisfied',
				reasonCodes: [],
				counts: { pass: 1 },
			},
		};
		const report = project([...fixtureEvents, beforeRemediation, afterRemediation]);
		const requirementDecisions = report.decisions.filter(
			(entry) => entry.auditId?.includes('evidence-requirement:brief_1:req_1'),
		);

		expect(requirementDecisions).toHaveLength(2);
		expect(requirementDecisions.map((entry) => entry.decision).sort()).toEqual([
			'satisfied',
			'weak',
		]);
	});

	it('counts only the latest remediation pass for readiness totals', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const requirementEvents = [];
		for (let index = 0; index < 9; index += 1) {
			const requirementId = `req_${index + 1}`;
			requirementEvents.push(
				{
					...baseLog,
					eventIndex: 200 + index,
					attributes: {
						...baseLog.attributes,
						auditEvent: 'decision_recorded',
						auditId: `decision:scan-fixture:evidence-requirement:brief_1:${requirementId}`,
						phase: 'evidence-readiness',
						briefId: 'brief_1',
						market: 'nigeria',
						status: 'succeeded',
						decision: 'weak',
						entityId: requirementId,
						reasonCodes: ['requirement_missing_anchor'],
						counts: { pass: 0 },
					},
				},
				{
					...baseLog,
					eventIndex: 300 + index,
					attributes: {
						...baseLog.attributes,
						auditEvent: 'decision_recorded',
						auditId: `decision:scan-fixture:evidence-requirement:brief_1:${requirementId}:pass1`,
						phase: 'evidence-readiness',
						briefId: 'brief_1',
						market: 'nigeria',
						status: 'succeeded',
						decision: index < 7 ? 'satisfied' : 'weak',
						entityId: requirementId,
						reasonCodes: index < 7 ? [] : ['requirement_missing_anchor'],
						counts: { pass: 1 },
					},
				},
			);
		}
		const report = project([...fixtureEvents, ...requirementEvents]);
		expect(report.readiness.byArticle.brief_1).toEqual(
			expect.objectContaining({
				total: 9,
				satisfied: 7,
				remediationPasses: 1,
			}),
		);
	});

	it('keeps deep-research and remediation region stages distinct', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const deepResearch = {
			...baseLog,
			eventIndex: 140,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'stage_completed',
				auditId: 'agent-task:scan-fixture:article:brief_1:region:nigeria:deep-research:1',
				phase: 'deep-research',
				stageId: 'agent-task:scan-fixture:article:brief_1:region:nigeria:deep-research:1',
				sessionName: 'article:brief_1:region:nigeria:deep-research',
				briefId: 'brief_1',
				market: 'nigeria',
				status: 'succeeded',
			},
		};
		const remediation = {
			...deepResearch,
			eventIndex: 141,
			attributes: {
				...deepResearch.attributes,
				auditEvent: 'stage_completed',
				auditId: 'agent-task:scan-fixture:article:brief_1:region:nigeria:remediation:1',
				phase: 'remediation',
				stageId: 'agent-task:scan-fixture:article:brief_1:region:nigeria:remediation:1',
				sessionName: 'article:brief_1:region:nigeria:remediation',
			},
		};
		const report = project([...fixtureEvents, deepResearch, remediation]);
		const stageIds = report.stages
			.filter((stage) => stage.sessionName?.includes('article:brief_1:region:nigeria'))
			.map((stage) => stage.stageId);
		expect(stageIds).toEqual(
			expect.arrayContaining([
				'agent-task:scan-fixture:article:brief_1:region:nigeria:deep-research:1',
				'agent-task:scan-fixture:article:brief_1:region:nigeria:remediation:1',
			]),
		);
	});

	it('projects terminal tool errors with structured limit reasons', () => {
		const tool = fixtureEvents.find((event) => event.type === 'tool');
		const terminalTool = {
			...tool,
			eventIndex: 150,
			toolCallId: 'tool_terminal',
			isError: true,
			result: {
				name: 'ResearchToolTerminalError',
				reason: 'limit-reached',
				message: 'fetch_sources returned limit-reached',
			},
		};
		const report = project([...fixtureEvents, terminalTool]);
		const fetchTool = report.efficiency.tools.find(
			(entry) => entry.toolName === terminalTool.toolName,
		);
		expect(fetchTool).toEqual(
			expect.objectContaining({
				callCount: 2,
				errorCount: 1,
				blockedCount: 1,
				statusCounts: { 'limit-reached': 1 },
			}),
		);
	});

	it('does not infer terminal tool status from unrelated prose', () => {
		const tool = fixtureEvents.find((event) => event.type === 'tool');
		const proseTool = {
			...tool,
			eventIndex: 151,
			toolCallId: 'tool_prose',
			isError: true,
			result: {
				message: 'The model mentioned budget-exhausted in its explanation.',
			},
		};
		const report = project([...fixtureEvents, proseTool]);
		const fetchTool = report.efficiency.tools.find(
			(entry) => entry.toolName === proseTool.toolName,
		);
		expect(fetchTool?.statusCounts?.['budget-exhausted']).toBeUndefined();
		expect(fetchTool?.statusCounts?.['limit-reached']).toBeUndefined();
	});

	it('records deduplicated final claim totals from artifact events', () => {
		const baseLog = fixtureEvents.find(
			(event) => event.type === 'log' && event.attributes?.auditSchemaVersion === '1',
		);
		const artifact = {
			...baseLog,
			eventIndex: 160,
			attributes: {
				...baseLog.attributes,
				auditEvent: 'artifact_recorded',
				auditId: 'artifact:scan-fixture:pipeline:none',
				phase: 'pipeline',
				status: 'succeeded',
				counts: { sources: 4, evidence: 6, claims: 4, providerReceipts: 3 },
			},
		};
		const report = project([...fixtureEvents, artifact]);
		expect(report.artifacts.claimCount).toBe(4);
	});
});
