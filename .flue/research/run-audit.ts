import type { FlueLogger } from '@flue/runtime';
import { ToolOutputValidationError } from '@flue/runtime';
import { ValiError } from 'valibot';
import type { Market } from './schemas';

export const RESEARCH_AUDIT_LOG_MESSAGE = 'research.audit';
export const RESEARCH_AUDIT_SCHEMA_VERSION = '1' as const;

export type ResearchAuditEventName =
	| 'pipeline_started'
	| 'pipeline_completed'
	| 'pipeline_failed'
	| 'stage_started'
	| 'stage_completed'
	| 'stage_failed'
	| 'provider_attempt_started'
	| 'provider_attempt_completed'
	| 'provider_attempt_failed'
	| 'provider_admission_rejected'
	| 'budget_admission_rejected'
	| 'decision_recorded'
	| 'artifact_recorded';

export type ResearchAuditStatus =
	| 'started'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'interrupted';

export interface ResearchAuditAttributes {
	auditSchemaVersion: typeof RESEARCH_AUDIT_SCHEMA_VERSION;
	auditEvent: ResearchAuditEventName;
	auditId: string;
	runKey: string;
	phase: string;
	stageId: string | null;
	briefId: string | null;
	market: Market | null;
	agent: string | null;
	modelRole: string | null;
	modelId: string | null;
	sessionName: string | null;
	attempt: number | null;
	status: ResearchAuditStatus;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
	provider: 'exa' | 'apify' | null;
	providerRequestId: string | null;
	operation: string | null;
	mode: string | null;
	admittedEstimateUsd: number | null;
	reportedCostUsd: number | null;
	decision: string | null;
	counts: Record<string, number>;
	errorClass: string | null;
	errorCode: string | null;
	entityId: string | null;
	reasonCodes: string[];
}

export interface StageScope {
	phase: string;
	briefId?: string | null;
	market?: Market | null;
	agent?: string | null;
	modelRole?: string | null;
	modelId?: string | null;
	sessionName?: string | null;
	attempt?: number;
}

export interface ProviderAttemptScope {
	callKey: string;
	provider: 'exa' | 'apify';
	phase: string;
	briefId?: string | null;
	market?: Market | null;
	operation: string;
	mode: string;
	attempt: number;
	admittedEstimateUsd: number;
}

export interface StageHandle {
	readonly stageId: string;
	complete(counts?: Record<string, number>): void;
	fail(errorClass?: string | null, errorCode?: string | null): void;
	cancel(): void;
}

export interface ProviderAttemptHandle {
	complete(params: {
		reportedCostUsd: number | null;
		providerRequestId?: string | null;
		durationMs?: number | null;
	}): void;
	fail(errorClass?: string | null, errorCode?: string | null): void;
}

export interface ResearchAuditEmitter {
	readonly runKey: string;
	startPipeline(counts?: Record<string, number>): void;
	completePipeline(counts?: Record<string, number>): void;
	failPipeline(errorClass?: string | null, errorCode?: string | null): void;
	startStage(scope: StageScope): StageHandle;
	startAgentTask(scope: StageScope & { sessionName: string }): StageHandle;
	recordDecision(params: {
		kind: string;
		decision: string;
		briefId?: string | null;
		market?: Market | null;
		entityId?: string | null;
		reasonCodes?: string[];
		phase?: string;
		counts?: Record<string, number>;
	}): void;
	recordArtifact(params: {
		phase: string;
		counts: Record<string, number>;
		briefId?: string | null;
	}): void;
	startProviderAttempt(scope: ProviderAttemptScope): ProviderAttemptHandle;
	recordBudgetRejection(scope: Omit<ProviderAttemptScope, 'attempt'> & { attempt?: number }): void;
	recordProviderRejection(scope: Omit<ProviderAttemptScope, 'attempt'> & { attempt?: number }): void;
}

const ALLOWED_ERROR_CLASSES = new Set([
	'provider_error',
	'provider_auth',
	'provider_rate_limit',
	'provider_timeout',
	'provider_cancelled',
	'budget_exhausted',
	'provider_request_limit',
	'duplicate_call',
	'validation_error',
	'agent_task_failed',
	'agent_task_timeout',
	'provider_outcome_unknown',
	'model_stream_interrupted',
	'pipeline_failed',
	'unknown',
]);

export function classifyAuditError(error: unknown): { errorClass: string; errorCode: string | null } {
	if (error instanceof ValiError) {
		return { errorClass: 'validation_error', errorCode: 'valibot' };
	}
	if (error instanceof ToolOutputValidationError) {
		const meta = error.meta as { tool?: string } | undefined;
		return { errorClass: 'validation_error', errorCode: meta?.tool ?? null };
	}
	if (error && typeof error === 'object') {
		const record = error as Record<string, unknown>;
		const name = typeof record.name === 'string' ? record.name : null;
		const code =
			typeof record.code === 'string'
				? record.code
				: typeof record.statusCode === 'number'
					? String(record.statusCode)
					: null;

		if (name === 'BudgetExhaustedError') {
			return { errorClass: 'budget_exhausted', errorCode: code };
		}
		if (name === 'ProviderRequestLimitError') {
			return { errorClass: 'provider_request_limit', errorCode: code };
		}
		if (name === 'DuplicateCallKeyError') {
			return { errorClass: 'duplicate_call', errorCode: code };
		}
		if (name === 'DiscoveryAgentTaskTimeoutError') {
			return { errorClass: 'agent_task_timeout', errorCode: code };
		}
		if (name === 'ProviderError') {
			if (record.statusCode === 401 || record.statusCode === 403) {
				return { errorClass: 'provider_auth', errorCode: code };
			}
			if (record.statusCode === 429) {
				return { errorClass: 'provider_rate_limit', errorCode: code };
			}
			return { errorClass: 'provider_error', errorCode: code };
		}
	}

	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	if (message.includes('validation') || message.includes('invalid type')) {
		return { errorClass: 'validation_error', errorCode: null };
	}
	if (message.includes('stream ended without finish_reason')) {
		return {
			errorClass: 'model_stream_interrupted',
			errorCode: 'missing_finish_reason',
		};
	}
	if (message.includes('discovery decision timed out') || message.includes('discovery finalization timed out')) {
		return { errorClass: 'agent_task_timeout', errorCode: null };
	}
	if (message.includes('timeout')) {
		return { errorClass: 'provider_timeout', errorCode: null };
	}
	if (message.includes('abort') || message.includes('cancel')) {
		return { errorClass: 'provider_cancelled', errorCode: null };
	}
	if (message.includes('budget')) {
		return { errorClass: 'budget_exhausted', errorCode: null };
	}
	return { errorClass: 'unknown', errorCode: null };
}

export function extractValidationReasonCodes(error: unknown): string[] {
	if (error instanceof ValiError) {
		return error.issues.map((issue) => {
			const path = issue.path
				?.map((part: { key: string | number | symbol }) => String(part.key))
				.join('.') ?? 'result';
			return `${path}:${issue.message}`;
		});
	}
	if (error instanceof ToolOutputValidationError) {
		const meta = error.meta as
			| { issues?: Array<{ path?: string; message: string }> }
			| undefined;
		return (meta?.issues ?? []).map((issue) => `${issue.path ?? 'result'}:${issue.message}`);
	}
	if (error instanceof Error && error.message) {
		return [error.message.slice(0, 240)];
	}
	return ['validation_error'];
}

export function sanitizeErrorClass(errorClass: string | null | undefined): string | null {
	if (!errorClass) return null;
	return ALLOWED_ERROR_CLASSES.has(errorClass) ? errorClass : 'unknown';
}

export function deriveStageId(
	runKey: string,
	phase: string,
	briefId: string | null,
	market: Market | null,
	attempt = 1,
): string {
	return `stage:${runKey}:${phase}:${briefId ?? 'none'}:${market ?? 'none'}:${attempt}`;
}

export function deriveProviderAuditId(callKey: string, attempt: number): string {
	return `provider:${callKey}:${attempt}`;
}

export function deriveBudgetAuditId(callKey: string, attempt: number): string {
	return `budget:${callKey}:${attempt}`;
}

export function deriveDecisionAuditId(
	runKey: string,
	kind: string,
	briefId: string | null,
	entityId?: string | null,
	remediationPass?: number,
): string {
	const base = `decision:${runKey}:${kind}:${briefId ?? 'none'}`;
	const withEntity = entityId ? `${base}:${entityId}` : base;
	if (remediationPass != null && remediationPass > 0) {
		return `${withEntity}:pass${remediationPass}`;
	}
	return withEntity;
}

export function deriveAgentTaskStageId(
	runKey: string,
	sessionName: string,
	attempt = 1,
): string {
	return `agent-task:${runKey}:${sessionName}:${attempt}`;
}

export async function withAuditStage<T>(
	audit: ResearchAuditEmitter | undefined,
	scope: StageScope,
	fn: () => Promise<T>,
	onSuccess?: (result: T) => Record<string, number> | void,
): Promise<T> {
	const stage = audit?.startStage(scope);
	try {
		const result = await fn();
		stage?.complete(onSuccess?.(result) ?? {});
		return result;
	} catch (error) {
		const classified = classifyAuditError(error);
		stage?.fail(classified.errorClass, classified.errorCode);
		throw error;
	}
}

export function createResearchAuditEmitter(
	log: FlueLogger,
	runKey: string,
	clock: () => string = () => new Date().toISOString(),
): ResearchAuditEmitter {
	const activeStages = new Map<string, { startedAt: string; scope: StageScope }>();
	let pipelineStartedAt: string | null = null;
	let pipelineTerminal = false;

	function elapsedMs(startedAt: string, completedAt: string): number | null {
		const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
		return Number.isFinite(durationMs) ? durationMs : null;
	}

	function emit(
		level: 'info' | 'warn' | 'error',
		attributes: ResearchAuditAttributes,
	): void {
		try {
			log[level](RESEARCH_AUDIT_LOG_MESSAGE, attributes as unknown as Record<string, unknown>);
		} catch {
			// Audit emission must never fail the research workflow.
		}
	}

	function baseAttributes(
		auditEvent: ResearchAuditEventName,
		auditId: string,
		scope: Partial<StageScope> & { phase: string },
		overrides: Partial<ResearchAuditAttributes> = {},
	): ResearchAuditAttributes {
		const briefId = scope.briefId ?? null;
		const market = scope.market ?? null;
		const attempt = scope.attempt ?? 1;
		return {
			auditSchemaVersion: RESEARCH_AUDIT_SCHEMA_VERSION,
			auditEvent,
			auditId,
			runKey,
			phase: scope.phase,
			stageId: deriveStageId(runKey, scope.phase, briefId, market, attempt),
			briefId,
			market,
			agent: scope.agent ?? null,
			modelRole: scope.modelRole ?? null,
			modelId: scope.modelId ?? null,
			sessionName: scope.sessionName ?? null,
			attempt: scope.attempt ?? null,
			status: 'started',
			startedAt: null,
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
			entityId: null,
			reasonCodes: [],
			...overrides,
		};
	}

	function terminalStage(
		stageId: string,
		auditEvent: ResearchAuditEventName,
		status: ResearchAuditStatus,
		errorClass?: string | null,
		errorCode?: string | null,
		counts: Record<string, number> = {},
	): void {
		const active = activeStages.get(stageId);
		if (!active) return;
		const completedAt = clock();
		const durationMs = elapsedMs(active.startedAt, completedAt);
		const { scope } = active;
		const briefId = scope.briefId ?? null;
		const market = scope.market ?? null;
		const attempt = scope.attempt ?? 1;
		emit(status === 'failed' ? 'warn' : 'info', baseAttributes(auditEvent, stageId, scope, {
			status,
			startedAt: active.startedAt,
			completedAt,
			durationMs,
			counts,
			errorClass: sanitizeErrorClass(errorClass),
			errorCode: errorCode ?? null,
			stageId,
			auditId: stageId,
			attempt,
		}));
		activeStages.delete(stageId);
	}

	function startTrackedStage(scope: StageScope, stageId: string): StageHandle {
		const startedAt = clock();
		activeStages.set(stageId, { startedAt, scope });
		emit('info', baseAttributes('stage_started', stageId, scope, {
			status: 'started',
			startedAt,
			stageId,
			auditId: stageId,
			attempt: scope.attempt ?? 1,
		}));
		return {
			stageId,
			complete(counts = {}) {
				terminalStage(stageId, 'stage_completed', 'succeeded', null, null, counts);
			},
			fail(errorClass, errorCode) {
				terminalStage(stageId, 'stage_failed', 'failed', errorClass, errorCode);
			},
			cancel() {
				terminalStage(stageId, 'stage_failed', 'cancelled');
			},
		};
	}

	return {
		runKey,
		startPipeline(counts = {}) {
			if (pipelineStartedAt || pipelineTerminal) return;
			const startedAt = clock();
			pipelineStartedAt = startedAt;
			emit('info', baseAttributes('pipeline_started', `pipeline:${runKey}`, { phase: 'pipeline' }, {
				status: 'started',
				startedAt,
				counts,
				stageId: deriveStageId(runKey, 'pipeline', null, null),
				auditId: `pipeline:${runKey}`,
			}));
		},
		completePipeline(counts = {}) {
			if (pipelineTerminal) return;
			const completedAt = clock();
			pipelineTerminal = true;
			emit('info', baseAttributes('pipeline_completed', `pipeline:${runKey}`, { phase: 'pipeline' }, {
				status: 'succeeded',
				startedAt: pipelineStartedAt,
				completedAt,
				durationMs: pipelineStartedAt ? elapsedMs(pipelineStartedAt, completedAt) : null,
				counts,
				stageId: deriveStageId(runKey, 'pipeline', null, null),
				auditId: `pipeline:${runKey}`,
			}));
		},
		failPipeline(errorClass, errorCode) {
			if (pipelineTerminal) return;
			const completedAt = clock();
			pipelineTerminal = true;
			emit('error', baseAttributes('pipeline_failed', `pipeline:${runKey}`, { phase: 'pipeline' }, {
				status: 'failed',
				startedAt: pipelineStartedAt,
				completedAt,
				durationMs: pipelineStartedAt ? elapsedMs(pipelineStartedAt, completedAt) : null,
				errorClass: sanitizeErrorClass(errorClass),
				errorCode: errorCode ?? null,
				stageId: deriveStageId(runKey, 'pipeline', null, null),
				auditId: `pipeline:${runKey}`,
			}));
		},
		startStage(scope) {
			return startTrackedStage(scope, deriveStageId(
				runKey,
				scope.phase,
				scope.briefId ?? null,
				scope.market ?? null,
				scope.attempt ?? 1,
			));
		},
		startAgentTask(scope) {
			return startTrackedStage(scope, deriveAgentTaskStageId(
				runKey,
				scope.sessionName,
				scope.attempt ?? 1,
			));
		},
		recordDecision({
			kind,
			decision,
			briefId = null,
			market = null,
			entityId = null,
			reasonCodes = [],
			phase = 'decision',
			counts = {},
		}) {
			const remediationPass =
				typeof counts.pass === 'number' ? counts.pass : undefined;
			const auditId = deriveDecisionAuditId(
				runKey,
				kind,
				briefId,
				entityId,
				remediationPass,
			);
			emit('info', baseAttributes('decision_recorded', auditId, { phase, briefId, market }, {
				status: 'succeeded',
				decision,
				entityId,
				reasonCodes,
				counts,
				completedAt: clock(),
				stageId: null,
			}));
		},
		recordArtifact({ phase, counts, briefId = null }) {
			const auditId = `artifact:${runKey}:${phase}:${briefId ?? 'none'}`;
			emit('info', baseAttributes('artifact_recorded', auditId, { phase, briefId }, {
				status: 'succeeded',
				counts,
				completedAt: clock(),
				stageId: null,
			}));
		},
		startProviderAttempt(scope) {
			const auditId = deriveProviderAuditId(scope.callKey, scope.attempt);
			const startedAt = clock();
			let terminal = false;
			const stageScope: StageScope = {
				phase: scope.phase,
				briefId: scope.briefId ?? null,
				market: scope.market ?? null,
				attempt: scope.attempt,
			};
			emit('info', baseAttributes('provider_attempt_started', auditId, stageScope, {
				status: 'started',
				startedAt,
				provider: scope.provider,
				operation: scope.operation,
				mode: scope.mode,
				admittedEstimateUsd: scope.admittedEstimateUsd,
				stageId: null,
			}));

			return {
				complete({ reportedCostUsd, providerRequestId = null, durationMs = null }) {
					if (terminal) return;
					terminal = true;
					const completedAt = clock();
					emit('info', baseAttributes('provider_attempt_completed', auditId, stageScope, {
						status: 'succeeded',
						startedAt,
						completedAt,
						durationMs: durationMs ?? elapsedMs(startedAt, completedAt),
						provider: scope.provider,
						providerRequestId,
						operation: scope.operation,
						mode: scope.mode,
						admittedEstimateUsd: scope.admittedEstimateUsd,
						reportedCostUsd,
						stageId: null,
					}));
				},
				fail(errorClass, errorCode) {
					if (terminal) return;
					terminal = true;
					const completedAt = clock();
					emit('warn', baseAttributes('provider_attempt_failed', auditId, stageScope, {
						status: 'failed',
						startedAt,
						completedAt,
						durationMs: elapsedMs(startedAt, completedAt),
						provider: scope.provider,
						operation: scope.operation,
						mode: scope.mode,
						admittedEstimateUsd: scope.admittedEstimateUsd,
						reportedCostUsd: null,
						errorClass: sanitizeErrorClass(errorClass),
						errorCode: errorCode ?? null,
						stageId: null,
					}));
				},
			};
		},
		recordBudgetRejection(scope) {
			const attempt = scope.attempt ?? 1;
			const auditId = deriveBudgetAuditId(scope.callKey, attempt);
			emit('warn', baseAttributes('budget_admission_rejected', auditId, {
				phase: scope.phase,
				briefId: scope.briefId ?? null,
				market: scope.market ?? null,
				attempt,
			}, {
				status: 'failed',
				completedAt: clock(),
				provider: scope.provider,
				operation: scope.operation,
				mode: scope.mode,
				admittedEstimateUsd: scope.admittedEstimateUsd,
				errorClass: 'budget_exhausted',
				stageId: null,
			}));
		},
		recordProviderRejection(scope) {
			const attempt = scope.attempt ?? 1;
			const auditId = `provider-admission:${scope.callKey}:${attempt}`;
			emit('warn', baseAttributes('provider_admission_rejected', auditId, {
				phase: scope.phase,
				briefId: scope.briefId ?? null,
				market: scope.market ?? null,
				attempt,
			}, {
				status: 'failed',
				completedAt: clock(),
				provider: scope.provider,
				operation: scope.operation,
				mode: scope.mode,
				admittedEstimateUsd: scope.admittedEstimateUsd,
				errorClass: 'provider_request_limit',
				stageId: null,
			}));
		},
	};
}
