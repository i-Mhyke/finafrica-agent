import { enrichTurnScope, resolveTurnModelId, scopeFromSession, sessionPhase } from './session-scope.mjs';

export {
	renderAuditMarkdown,
	resolveSafeOutputDir,
	resolveSafeRunOutputDir,
	stripGeneratedAt,
	validateRunKeySegment,
	writeAuditArtifacts,
} from './research-audit-report.mjs';

/** @typedef {import('@flue/sdk').FlueEvent} FlueEvent */

export const SUPPORTED_FLUE_EVENT_VERSION = 3;
export const AUDIT_SCHEMA_VERSION = '1';
export const RESEARCH_AUDIT_LOG_MESSAGE = 'research.audit';

const IGNORED_EVENT_TYPES = new Set([
	'turn_request',
	'turn_messages',
	'message_start',
	'message_end',
	'text_delta',
	'thinking_start',
	'thinking_delta',
	'thinking_end',
	'agent_start',
	'agent_end',
	'idle',
]);

const RETAINED_EVENT_TYPES = new Set([
	'run_start',
	'run_resume',
	'run_end',
	'operation_start',
	'operation',
	'task_start',
	'task',
	'turn_start',
	'turn',
	'tool_start',
	'tool',
	'compaction_start',
	'compaction',
	'log',
	'submission_settled',
]);

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const API_KEY_PATTERN = /x-api-key['":\s]+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_PREFIX_PATTERN = /\b(sk|pk|api|token|secret)[-_][A-Za-z0-9._~+/=-]{8,}\b/gi;

/**
 * @param {unknown} value
 * @param {string[]} secrets
 */
export function redactAuditValue(value, secrets = []) {
	if (value == null) return value;
	if (typeof value === 'string') {
		let redacted = value;
		for (const secret of secrets) {
			if (secret && redacted.includes(secret)) {
				redacted = redacted.split(secret).join('[REDACTED]');
			}
		}
		redacted = redacted.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
		redacted = redacted.replace(API_KEY_PATTERN, 'x-api-key [REDACTED]');
		redacted = redacted.replace(SECRET_PREFIX_PATTERN, '[REDACTED]');
		return redacted;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactAuditValue(item, secrets));
	}
	if (typeof value === 'object') {
		/** @type {Record<string, unknown>} */
		const output = {};
		for (const [key, nested] of Object.entries(value)) {
			if (['prompt', 'thinking', 'result', 'args', 'messages', 'content', 'text', 'delta'].includes(key)) {
				continue;
			}
			output[key] = redactAuditValue(nested, secrets);
		}
		return output;
	}
	return value;
}

function emptyUsage() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		turnCount: 0,
		failedTurnCount: 0,
	};
}

/**
 * @param {{ runId: string, secrets?: string[], now?: () => string }} options
 */
export function createAuditProjection({ runId, secrets = [], now = () => new Date().toISOString() }) {
	const seen = new Set();
	let ignoredCount = 0;
	let duplicateCount = 0;
	let runStart = null;
	let runEnd = null;
	let runKey = null;
	let workflowName = null;
	/** @type {Map<string, any>} */
	const sessionScopes = new Map();
	/** @type {Map<string, any>} */
	const stages = new Map();
	/** @type {Map<string, any>} */
	const turns = new Map();
	/** @type {Map<string, any>} */
	const activeTurns = new Map();
	/** @type {Map<string, any>} */
	const tools = new Map();
	/** @type {Map<string, any>} */
	const providerAttempts = new Map();
	/** @type {Map<string, any>} */
	const decisions = new Map();
	/** @type {any[]} */
	const timeline = [];
	/** @type {any[]} */
	const warnings = [];
	/** @type {Map<string, Record<string, number>>} */
	const artifactEvents = new Map();
	let finalResult = null;
	let runClosed = false;
	let runRecordStatus = null;
	let runLimits = null;

	function eventIdentity(event) {
		const index = event.eventIndex ?? 'unknown';
		return `${runId}:${index}`;
	}

	function assertVersion(event) {
		if (event.v !== SUPPORTED_FLUE_EVENT_VERSION) {
			const error = new Error(`Unsupported Flue event version: ${String(event.v)}`);
			error.name = 'UnsupportedFlueEventVersionError';
			error.received = event.v;
			throw error;
		}
	}

	function pushTimeline(entry) {
		timeline.push(redactAuditValue(entry, secrets));
	}

	function upsertStage(attrs) {
		const stageId = attrs.stageId;
		if (!stageId) return;
		const existing = stages.get(stageId) ?? {
			stageId,
			phase: attrs.phase,
			briefId: attrs.briefId,
			market: attrs.market,
			agent: attrs.agent,
			modelRole: attrs.modelRole,
			modelId: attrs.modelId,
			sessionName: attrs.sessionName,
			status: 'planned',
			startedAt: null,
			completedAt: null,
			durationMs: null,
			counts: {},
		};
		if (attrs.auditEvent === 'stage_started') {
			existing.status = 'active';
			existing.startedAt = attrs.startedAt;
			existing.agent = attrs.agent ?? existing.agent;
			existing.modelRole = attrs.modelRole ?? existing.modelRole;
			existing.modelId = attrs.modelId ?? existing.modelId;
			existing.sessionName = attrs.sessionName ?? existing.sessionName;
		}
		if (attrs.auditEvent === 'stage_completed') {
			existing.status = 'succeeded';
			existing.completedAt = attrs.completedAt;
			existing.durationMs = attrs.durationMs;
			existing.counts = attrs.counts ?? {};
		}
		if (attrs.auditEvent === 'stage_failed') {
			existing.status = attrs.status === 'cancelled' ? 'cancelled' : 'failed';
			existing.completedAt = attrs.completedAt;
			existing.durationMs = attrs.durationMs;
		}
		stages.set(stageId, existing);
	}

	function ingestAuditLog(event) {
		const attrs = redactAuditValue(event.attributes ?? {}, secrets);
		if (attrs.auditSchemaVersion !== AUDIT_SCHEMA_VERSION) return;
		if (!runKey && attrs.runKey) runKey = attrs.runKey;
		if (attrs.auditEvent === 'pipeline_started') {
			runLimits = attrs.counts ?? null;
		}

		if (attrs.auditEvent?.startsWith('stage_')) {
			upsertStage(attrs);
			if (attrs.sessionName && attrs.auditEvent === 'stage_started') {
				sessionScopes.set(attrs.sessionName, {
					agent: attrs.agent,
					briefId: attrs.briefId,
					market: attrs.market,
					phase: attrs.phase,
					modelRole: attrs.modelRole,
					modelId: attrs.modelId,
				});
			}
		}
		if (attrs.auditEvent === 'decision_recorded') {
			decisions.set(attrs.auditId, {
				auditId: attrs.auditId,
				kind: attrs.auditId?.split(':')[2] ?? 'decision',
				decision: attrs.decision,
				briefId: attrs.briefId,
				market: attrs.market,
				entityId: attrs.entityId ?? null,
				reasonCodes: attrs.reasonCodes ?? [],
				phase: attrs.phase,
				completedAt: attrs.completedAt,
				counts: attrs.counts ?? {},
			});
		}
		if (attrs.auditEvent === 'artifact_recorded') {
			artifactEvents.set(attrs.auditId, attrs.counts ?? {});
		}
		if (
			attrs.auditEvent?.startsWith('provider_attempt_') ||
			attrs.auditEvent === 'budget_admission_rejected' ||
			attrs.auditEvent === 'provider_admission_rejected'
		) {
			const attemptId = attrs.auditId;
			const existing = providerAttempts.get(attemptId) ?? {
				auditId: attemptId,
				provider: attrs.provider,
				phase: attrs.phase,
				briefId: attrs.briefId,
				market: attrs.market,
				operation: attrs.operation,
				mode: attrs.mode,
				attempt: attrs.attempt,
				admittedEstimateUsd: attrs.admittedEstimateUsd,
				reportedCostUsd: null,
				status: 'started',
				errorClass: null,
			};
			if (attrs.auditEvent === 'provider_attempt_started') existing.status = 'started';
			if (attrs.auditEvent === 'provider_attempt_completed') {
				existing.status = 'succeeded';
				existing.reportedCostUsd = attrs.reportedCostUsd;
				existing.providerRequestId = attrs.providerRequestId;
				existing.durationMs = attrs.durationMs;
			}
			if (
				attrs.auditEvent === 'provider_attempt_failed' ||
				attrs.auditEvent === 'budget_admission_rejected' ||
				attrs.auditEvent === 'provider_admission_rejected'
			) {
				existing.status = 'failed';
				existing.errorClass = attrs.errorClass;
				existing.reportedCostUsd = null;
			}
			existing.auditEvent = attrs.auditEvent;
			providerAttempts.set(attemptId, existing);
		}

		pushTimeline({
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
			kind: 'audit',
			auditId: attrs.auditId,
			auditEvent: attrs.auditEvent,
			stageId: attrs.stageId,
			phase: attrs.phase,
			agent: attrs.agent,
			modelRole: attrs.modelRole,
			modelId: attrs.modelId,
			sessionName: attrs.sessionName,
			briefId: attrs.briefId,
			market: attrs.market,
			status: attrs.status,
			counts: attrs.counts,
			provider: attrs.provider,
			admittedEstimateUsd: attrs.admittedEstimateUsd,
			reportedCostUsd: attrs.reportedCostUsd,
			durationMs: attrs.durationMs,
			operation: attrs.operation,
			mode: attrs.mode,
			errorClass: attrs.errorClass,
			decision: attrs.decision,
		});
	}

	function enrichTurn(event) {
		const session = event.session ?? null;
		const parentSession = event.parentSession ?? null;
		return enrichTurnScope(session, parentSession, sessionScopes);
	}

	function ingestTurnStart(event) {
		if (event.type !== 'turn_start' || event.purpose !== 'agent') return;
		const session = event.session ?? null;
		const scope = enrichTurn(event);
		const record = {
			turnId: event.turnId,
			session: session ?? event.parentSession ?? null,
			agent: scope.agent,
			briefId: scope.briefId,
			market: scope.market,
			phase: scope.phase,
			modelRole: scope.modelRole,
			modelId: scope.modelId ?? resolveTurnModelId(event.request),
			status: 'active',
			startedAt: event.timestamp,
			eventIndex: event.eventIndex,
		};
		activeTurns.set(event.turnId, record);
		pushTimeline({
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
			kind: 'turn_start',
			...record,
		});
	}

	function ingestTurn(event) {
		if (event.type !== 'turn') return;
		if (event.purpose !== 'agent') return;
		const usage = event.response?.usage;
		const inputTokens = usage?.input ?? 0;
		const outputTokens = usage?.output ?? 0;
		const costUsd = usage?.cost?.total ?? 0;
		const session = event.session ?? null;
		const scope = enrichTurn(event);
		const modelId = resolveTurnModelId(event.request) ?? scope.modelId;
		const record = {
			turnId: event.turnId,
			session: session ?? event.parentSession ?? null,
			modelId,
			providerName: event.request?.providerName ?? null,
			agent: scope.agent,
			briefId: scope.briefId,
			market: scope.market,
			phase: scope.phase,
			modelRole: scope.modelRole,
			inputTokens,
			outputTokens,
			costUsd,
			durationMs: event.durationMs ?? null,
			isError: Boolean(event.isError),
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
		};
		activeTurns.delete(event.turnId);
		turns.set(event.turnId, record);
		pushTimeline({
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
			kind: 'turn',
			session: record.session,
			modelId: record.modelId,
			agent: record.agent,
			briefId: record.briefId,
			market: record.market,
			phase: record.phase,
			modelRole: record.modelRole,
			inputTokens,
			outputTokens,
			costUsd,
			durationMs: record.durationMs,
			isError: record.isError,
		});
	}

	function parseTerminalToolStatus(event) {
		if (!event.isError) return null;
		const reason =
			event.error?.reason ??
			event.result?.reason ??
			event.result?.details?.reason ??
			event.result?.details?.terminalReason ??
			null;
		if (reason === 'limit-reached' || reason === 'budget-exhausted') {
			return reason;
		}
		if (
			event.error?.name === 'ResearchToolTerminalError' ||
			event.result?.name === 'ResearchToolTerminalError'
		) {
			const structuredReason = event.error?.reason ?? event.result?.reason;
			if (structuredReason === 'limit-reached' || structuredReason === 'budget-exhausted') {
				return structuredReason;
			}
		}
		return null;
	}

	function ingestTool(event) {
		if (event.type !== 'tool') return;
		const terminalStatus = parseTerminalToolStatus(event);
		const status =
			terminalStatus ?? event.result?.details?.output?.status ?? null;
		const record = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			session: event.session ?? event.parentSession ?? null,
			durationMs: event.durationMs ?? null,
			isError: Boolean(event.isError),
			status,
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
		};
		tools.set(event.toolCallId, record);
		pushTimeline({
			timestamp: event.timestamp,
			eventIndex: event.eventIndex,
			kind: 'tool',
			toolName: record.toolName,
			session: record.session,
			durationMs: record.durationMs,
			isError: record.isError,
			status: record.status,
		});
	}

	return {
		get duplicateCount() {
			return duplicateCount;
		},
		get ignoredCount() {
			return ignoredCount;
		},
		ingest(event) {
			assertVersion(event);
			const identity = eventIdentity(event);
			if (seen.has(identity)) {
				duplicateCount++;
				return { activity: false };
			}
			seen.add(identity);

			if (IGNORED_EVENT_TYPES.has(event.type)) {
				ignoredCount++;
				return { activity: event.type === 'thinking_delta' };
			}
			if (!RETAINED_EVENT_TYPES.has(event.type)) {
				ignoredCount++;
				return { activity: false };
			}

			if (event.type === 'run_start') {
				runStart = event;
				runKey = runKey ?? event.input?.runKey ?? null;
				workflowName = event.workflowName;
			}
			if (event.type === 'run_end') {
				runEnd = event;
				runClosed = true;
				finalResult = event.result ?? null;
			}
			if (event.type === 'run_resume') {
				runClosed = false;
			}
			if (event.type === 'log' && event.message === RESEARCH_AUDIT_LOG_MESSAGE) {
				ingestAuditLog(event);
			}
			if (event.type === 'turn_start') ingestTurnStart(event);
			if (event.type === 'turn') ingestTurn(event);
			if (event.type === 'tool') ingestTool(event);
			return { activity: true };
		},
		snapshot() {
			return buildReport({
				generatedAt: now(),
				runId,
				runKey,
				workflowName,
				runStart,
				runEnd,
				runClosed,
				stages,
				turns,
				activeTurns,
				tools,
				providerAttempts,
				decisions,
				timeline,
				warnings,
				artifactEvents,
				finalResult,
				runRecordStatus,
				runLimits,
				secrets,
				interrupted: false,
			});
		},
		finalize(runRecord) {
			if (runRecord?.result) finalResult = runRecord.result;
			if (runRecord?.status) {
				runRecordStatus = runRecord.status;
				runClosed = runRecord.status !== 'active';
			}
			for (const stage of stages.values()) {
				if (stage.status === 'active') {
					stage.status = runClosed ? 'interrupted' : 'active';
					if (!warnings.some((warning) => warning.code === 'stage_unclosed' && warning.stageId === stage.stageId)) {
						warnings.push({
							code: 'stage_unclosed',
							stageId: stage.stageId,
							message: `Stage ${stage.phase} remained unclosed at export`,
						});
					}
				}
			}
			if (runClosed) {
				for (const turn of activeTurns.values()) {
					turn.status = 'interrupted';
				}
			}
			return buildReport({
				generatedAt: now(),
				runId,
				runKey,
				workflowName,
				runStart,
				runEnd,
				runClosed,
				stages,
				turns,
				activeTurns,
				tools,
				providerAttempts,
				decisions,
				timeline,
				warnings,
				artifactEvents,
				finalResult,
				runRecordStatus,
				runLimits,
				secrets,
				interrupted: runClosed,
			});
		},
	};
}

function buildReport(ctx) {
	const turns = [...ctx.turns.values()];
	const activeTurns = [...ctx.activeTurns.values()].sort((a, b) =>
		String(a.startedAt).localeCompare(String(b.startedAt)),
	);
	const tools = [...ctx.tools.values()];
	const providerAttempts = [...ctx.providerAttempts.values()];
	const stages = [...ctx.stages.values()].sort((a, b) =>
		String(a.stageId).localeCompare(String(b.stageId)),
	);
	const timeline = [...ctx.timeline].sort((a, b) => {
		const byIndex = (a.eventIndex ?? 0) - (b.eventIndex ?? 0);
		if (byIndex !== 0) return byIndex;
		return String(a.timestamp).localeCompare(String(b.timestamp));
	});

	const modelUsage = emptyUsage();
	for (const turn of turns) {
		modelUsage.inputTokens += turn.inputTokens;
		modelUsage.outputTokens += turn.outputTokens;
		modelUsage.costUsd += turn.costUsd;
		modelUsage.turnCount += 1;
		if (turn.isError) modelUsage.failedTurnCount += 1;
	}

	let providerAdmittedEstimateUsd = 0;
	let providerReportedCostUsd = 0;
	let providerUnpricedCalls = 0;
	let budgetRejectionCount = 0;
	let requestRejectionCount = 0;
	const seenProviderAttempts = new Set();
	for (const attempt of providerAttempts) {
		if (attempt.auditEvent === 'budget_admission_rejected') {
			budgetRejectionCount++;
			continue;
		}
		if (attempt.auditEvent === 'provider_admission_rejected') {
			requestRejectionCount++;
			continue;
		}
		if (seenProviderAttempts.has(attempt.auditId)) continue;
		seenProviderAttempts.add(attempt.auditId);
		providerAdmittedEstimateUsd += attempt.admittedEstimateUsd ?? 0;
		if (attempt.status === 'succeeded' || attempt.status === 'failed') {
			if (attempt.reportedCostUsd == null) {
				providerUnpricedCalls += 1;
			}
			if (attempt.reportedCostUsd != null) providerReportedCostUsd += attempt.reportedCostUsd;
		}
	}

	const outcomes = ctx.finalResult?.totals ?? {
		discovered: 0,
		accepted: 0,
		passed: 0,
		incomplete: 0,
		rejected: 0,
	};
	const knownTotalCostUsd = modelUsage.costUsd + providerReportedCostUsd;
	const outcomeEfficiency = {
		discovered: outcomes.discovered ?? 0,
		accepted: outcomes.accepted ?? 0,
		passed: outcomes.passed ?? 0,
		incomplete: outcomes.incomplete ?? 0,
		rejected: outcomes.rejected ?? 0,
		knownTotalCostUsd,
		costPerAcceptedBrief:
			outcomes.accepted > 0 ? knownTotalCostUsd / outcomes.accepted : null,
		costPerPassedArticle: outcomes.passed > 0 ? knownTotalCostUsd / outcomes.passed : null,
		acceptanceRate:
			outcomes.discovered > 0 ? outcomes.accepted / outcomes.discovered : null,
		passRate: outcomes.accepted > 0 ? outcomes.passed / outcomes.accepted : null,
		contextAmplification:
			modelUsage.outputTokens > 0
				? modelUsage.inputTokens / Math.max(modelUsage.outputTokens, 1)
				: null,
	};

	const bottlenecks = stages
		.filter((stage) => stage.durationMs != null)
		.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
		.slice(0, 3)
		.map((stage) => ({
			stageId: stage.stageId,
			phase: stage.phase,
			durationMs: stage.durationMs,
		}));

	const readinessByArticle = buildReadinessByArticle([...ctx.decisions.values()], stages);

	const activeStage =
		stages
			.filter((stage) => stage.status === 'active')
			.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] ?? null;
	const runStatus = ctx.runEnd?.isError
		? 'failed'
		: ctx.finalResult?.status ?? ctx.runRecordStatus ?? (ctx.runClosed ? 'complete' : 'active');

	return redactAuditValue(
		{
			auditSchemaVersion: AUDIT_SCHEMA_VERSION,
			generatedAt: ctx.generatedAt,
			run: {
				runId: ctx.runId,
				runKey: ctx.runKey ?? ctx.finalResult?.runKey ?? null,
				workflowName: ctx.workflowName ?? 'market-intelligence-scan',
				status: runStatus,
				startedAt: ctx.runStart?.startedAt ?? ctx.runStart?.timestamp ?? null,
				endedAt: ctx.runEnd?.timestamp ?? null,
				durationMs: ctx.runEnd?.durationMs ?? null,
				limits: ctx.runLimits,
			},
			currentStage: activeStage,
			activeTurns,
			timeline,
			stages,
			efficiency: {
				model: modelUsage,
				provider: {
					admittedEstimateUsd: providerAdmittedEstimateUsd,
					reportedCostUsd: providerReportedCostUsd,
					unpricedCalls: providerUnpricedCalls,
					attemptCount:
						providerAttempts.length -
						budgetRejectionCount -
						requestRejectionCount,
					budgetRejectionCount,
					requestRejectionCount,
				},
				byPhase: aggregateBy(turns, (turn) => turn.phase ?? sessionPhase(turn.session)),
				byAgent: aggregateBy(turns, (turn) => turn.agent ?? 'unknown'),
				byModel: aggregateBy(turns, (turn) => turn.modelId ?? 'unknown'),
				byBrief: aggregateBy(turns, (turn) => turn.briefId ?? 'none'),
				byMarket: aggregateBy(turns, (turn) => turn.market ?? 'none'),
				tools: aggregateTools(tools),
				outcomes: outcomeEfficiency,
			},
			artifacts: aggregateArtifactEvents(ctx.artifactEvents),
			decisions: [...ctx.decisions.values()].sort((a, b) => String(a.auditId).localeCompare(String(b.auditId))),
			readiness: { byArticle: readinessByArticle },
			bottlenecks,
			warnings: ctx.warnings,
		},
		ctx.secrets,
	);
}

export { enrichTurnScope, resolveTurnModelId, sessionPhase };

function aggregateBy(turns, keyFn) {
	/** @type {Map<string, ReturnType<typeof emptyUsage>>} */
	const groups = new Map();
	for (const turn of turns) {
		const key = keyFn(turn) ?? 'unknown';
		const usage = groups.get(key) ?? emptyUsage();
		usage.inputTokens += turn.inputTokens;
		usage.outputTokens += turn.outputTokens;
		usage.costUsd += turn.costUsd;
		usage.turnCount += 1;
		if (turn.isError) usage.failedTurnCount += 1;
		groups.set(key, usage);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, usage]) => ({ key, ...usage }));
}

function aggregateTools(tools) {
	const groups = new Map();
	for (const tool of tools) {
		const current = groups.get(tool.toolName) ?? {
			toolName: tool.toolName,
			callCount: 0,
			errorCount: 0,
			blockedCount: 0,
			statusCounts: {},
			totalDurationMs: 0,
		};
		current.callCount++;
		if (tool.isError) current.errorCount++;
		if (tool.status && tool.status !== 'ok') {
			current.blockedCount++;
			current.statusCounts[tool.status] =
				(current.statusCounts[tool.status] ?? 0) + 1;
		}
		current.totalDurationMs += tool.durationMs ?? 0;
		groups.set(tool.toolName, current);
	}
	return [...groups.values()].sort((a, b) => a.toolName.localeCompare(b.toolName));
}

function aggregateArtifactEvents(artifactEvents) {
	const totals = {
		sourceCount: 0,
		evidenceCount: 0,
		claimCount: 0,
		providerReceiptCount: 0,
	};
	for (const counts of artifactEvents.values()) {
		totals.sourceCount += counts.sources ?? 0;
		totals.evidenceCount += counts.evidence ?? 0;
		totals.claimCount += counts.claims ?? 0;
		totals.providerReceiptCount += counts.providerReceipts ?? 0;
	}
	return totals;
}

function buildReadinessByArticle(decisions, stages) {
	/** @type {Record<string, any>} */
	const byArticle = {};

	const latestRequirementByEntity = new Map();
	for (const decision of decisions) {
		if (decision.kind !== 'evidence-requirement' || !decision.briefId || !decision.entityId) {
			continue;
		}
		const key = `${decision.briefId}:${decision.entityId}`;
		const existing = latestRequirementByEntity.get(key);
		const pass = decision.counts?.pass ?? 0;
		const existingPass = existing?.counts?.pass ?? 0;
		if (!existing || pass > existingPass) {
			latestRequirementByEntity.set(key, decision);
		}
	}

	const latestReadinessByBrief = new Map();
	for (const decision of decisions) {
		if (decision.kind !== 'evidence-readiness' || !decision.briefId) continue;
		const pass = decision.counts?.pass ?? 0;
		const existing = latestReadinessByBrief.get(decision.briefId);
		const existingPass = existing?.counts?.pass ?? 0;
		if (!existing || pass > existingPass) {
			latestReadinessByBrief.set(decision.briefId, decision);
		}
	}

	for (const [briefId, decision] of latestReadinessByBrief) {
		byArticle[briefId] = {
			status: decision.decision === 'passed' ? 'passed' : 'blocked',
			markets: byArticle[briefId]?.markets ?? [],
			outcomeStatus: byArticle[briefId]?.outcomeStatus ?? null,
			satisfied: byArticle[briefId]?.satisfied ?? 0,
			total: byArticle[briefId]?.total ?? 0,
			remediationPasses: decision.counts?.pass ?? 0,
			analysisCalls: byArticle[briefId]?.analysisCalls ?? 0,
		};
	}

	for (const decision of latestRequirementByEntity.values()) {
		const article = byArticle[decision.briefId] ?? {
			status: 'blocked',
			markets: [],
			outcomeStatus: null,
			satisfied: 0,
			total: 0,
			remediationPasses: 0,
			analysisCalls: 0,
		};
		article.total += 1;
		if (decision.decision === 'satisfied') article.satisfied += 1;
		if (decision.market && !article.markets.includes(decision.market)) {
			article.markets.push(decision.market);
		}
		const pass = decision.counts?.pass ?? 0;
		if (pass > article.remediationPasses) article.remediationPasses = pass;
		byArticle[decision.briefId] = article;
	}

	for (const decision of decisions) {
		if (decision.kind === 'article-outcome' && decision.briefId) {
			const article = byArticle[decision.briefId] ?? {
				status: 'blocked',
				markets: [],
				outcomeStatus: null,
				satisfied: 0,
				total: 0,
				remediationPasses: 0,
				analysisCalls: 0,
			};
			article.outcomeStatus = decision.decision;
			byArticle[decision.briefId] = article;
		}
	}
	for (const stage of stages) {
		if (stage.phase === 'structural-analysis' && stage.briefId && stage.status === 'succeeded') {
			const article = byArticle[stage.briefId] ?? {
				status: 'blocked',
				markets: [],
				outcomeStatus: null,
				satisfied: 0,
				total: 0,
				remediationPasses: 0,
				analysisCalls: 0,
			};
			article.analysisCalls += 1;
			byArticle[stage.briefId] = article;
		}
	}
	return byArticle;
}
