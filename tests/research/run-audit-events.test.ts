import { describe, expect, it, vi } from 'vitest';
import { ValiError } from 'valibot';
import type { FlueLogger } from '@flue/runtime';
import {
	classifyAuditError,
	createResearchAuditEmitter,
	deriveDecisionAuditId,
	deriveStageId,
	RESEARCH_AUDIT_LOG_MESSAGE,
} from '../../.flue/research/run-audit';

function createMockLog() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as FlueLogger & {
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
	};
}

function auditAttributes(log: ReturnType<typeof createMockLog>) {
	return [...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]
		.filter(([message]) => message === RESEARCH_AUDIT_LOG_MESSAGE)
		.map(([, attrs]) => attrs as Record<string, unknown>);
}

describe('research audit emitter', () => {
	const runKey = 'scan-test';
	const clock = () => '2026-07-23T10:00:00.000Z';

	it('uses stable stage ids for paired start and completion events', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		const stage = audit.startStage({
			phase: 'discovery',
			agent: 'discovery_orchestrator',
			modelRole: 'fast',
		});
		stage.complete({ briefs: 12 });

		const events = auditAttributes(log);
		const started = events.find((e) => e.auditEvent === 'stage_started');
		const completed = events.find((e) => e.auditEvent === 'stage_completed');
		expect(started?.stageId).toBe(deriveStageId(runKey, 'discovery', null, null));
		expect(completed?.stageId).toBe(started?.stageId);
		expect(completed?.status).toBe('succeeded');
		expect(completed?.counts).toEqual({ briefs: 12 });
	});

	it('keeps concurrent stages independent', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		const nigeria = audit.startStage({
			phase: 'deep-research',
			briefId: 'brief_1',
			market: 'nigeria',
		});
		const kenya = audit.startStage({
			phase: 'deep-research',
			briefId: 'brief_1',
			market: 'kenya',
		});
		nigeria.complete();
		kenya.fail('provider_error', '503');

		const completed = auditAttributes(log).filter((e) => e.auditEvent === 'stage_completed');
		const failed = auditAttributes(log).filter((e) => e.auditEvent === 'stage_failed');
		expect(completed).toHaveLength(1);
		expect(failed).toHaveLength(1);
		expect(completed[0].market).toBe('nigeria');
		expect(failed[0].market).toBe('kenya');
	});

	it('records decision events with brief scope', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		audit.recordDecision({
			kind: 'brief-validation',
			decision: 'ACCEPT',
			briefId: 'brief_1',
			phase: 'brief-validation',
		});

		const decision = auditAttributes(log).find((e) => e.auditEvent === 'decision_recorded');
		expect(decision?.briefId).toBe('brief_1');
		expect(decision?.decision).toBe('ACCEPT');
		expect(decision?.auditId).toBe(`decision:${runKey}:brief-validation:brief_1`);
	});

	it('records requirement-level decisions with entityId and reasonCodes', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		audit.recordDecision({
			kind: 'evidence-requirement',
			decision: 'weak',
			briefId: 'brief_1',
			market: 'nigeria',
			entityId: 'req_1',
			reasonCodes: ['requirement_missing_anchor'],
			phase: 'evidence-readiness',
		});

		const decision = auditAttributes(log).find((e) => e.auditEvent === 'decision_recorded');
		expect(decision?.entityId).toBe('req_1');
		expect(decision?.reasonCodes).toEqual(['requirement_missing_anchor']);
		expect(decision?.auditId).toBe(
			deriveDecisionAuditId(runKey, 'evidence-requirement', 'brief_1', 'req_1'),
		);
	});

	it('preserves legacy decision ids when entityId is omitted', () => {
		expect(deriveDecisionAuditId(runKey, 'brief-validation', 'brief_1')).toBe(
			`decision:${runKey}:brief-validation:brief_1`,
		);
		expect(deriveDecisionAuditId(runKey, 'brief-validation', 'brief_1', null)).toBe(
			`decision:${runKey}:brief-validation:brief_1`,
		);
	});

	it('appends remediation pass to decision ids after the first evaluation', () => {
		expect(
			deriveDecisionAuditId(runKey, 'evidence-requirement', 'brief_1', 'req_1', 1),
		).toBe(`decision:${runKey}:evidence-requirement:brief_1:req_1:pass1`);
		expect(
			deriveDecisionAuditId(runKey, 'evidence-readiness', 'brief_1', 'brief_1', 1),
		).toBe(`decision:${runKey}:evidence-readiness:brief_1:brief_1:pass1`);
		expect(deriveDecisionAuditId(runKey, 'evidence-requirement', 'brief_1', 'req_1', 0)).toBe(
			`decision:${runKey}:evidence-requirement:brief_1:req_1`,
		);
	});

	it('records distinct provider attempts per retry', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		const attempt1 = audit.startProviderAttempt({
			callKey: 'call_1',
			provider: 'exa',
			phase: 'discovery',
			market: 'nigeria',
			operation: 'search',
			mode: 'search',
			attempt: 1,
			admittedEstimateUsd: 0.007,
		});
		attempt1.fail('provider_rate_limit', '429');
		const attempt2 = audit.startProviderAttempt({
			callKey: 'call_1',
			provider: 'exa',
			phase: 'discovery',
			market: 'nigeria',
			operation: 'search',
			mode: 'search',
			attempt: 2,
			admittedEstimateUsd: 0.007,
		});
		attempt2.complete({ reportedCostUsd: 0.007 });

		const providerEvents = auditAttributes(log).filter((e) =>
			String(e.auditEvent).startsWith('provider_attempt_'),
		);
		expect(providerEvents).toHaveLength(4);
		expect(new Set(providerEvents.map((e) => e.auditId)).size).toBe(2);
	});

	it('records budget rejection without a provider attempt start', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		audit.recordBudgetRejection({
			callKey: 'call_budget',
			provider: 'exa',
			phase: 'discovery',
			market: 'nigeria',
			operation: 'search',
			mode: 'search',
			admittedEstimateUsd: 0.007,
		});

		const events = auditAttributes(log);
		expect(events.some((e) => e.auditEvent === 'budget_admission_rejected')).toBe(true);
		expect(events.some((e) => e.auditEvent === 'provider_attempt_started')).toBe(false);
	});

	it('does not throw when the logger throws', () => {
		const log = createMockLog();
		log.info.mockImplementation(() => {
			throw new Error('logger failed');
		});
		const audit = createResearchAuditEmitter(log, runKey, clock);
		expect(() => audit.startStage({ phase: 'discovery' }).complete()).not.toThrow();
	});

	it('emits agent-task stages with stable session-scoped ids', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		const stage = audit.startAgentTask({
			phase: 'brief-validation',
			briefId: 'brief_1',
			agent: 'brief_validator',
			modelRole: 'default',
			sessionName: 'brief-validator:brief_1',
		});
		stage.complete({ inputTokens: 10, outputTokens: 2 });

		const events = auditAttributes(log);
		const started = events.find((e) => e.auditEvent === 'stage_started');
		expect(started?.stageId).toBe('agent-task:scan-test:brief-validator:brief_1:1');
		expect(started?.sessionName).toBe('brief-validator:brief_1');
	});

	it('classifies provider errors without leaking message content', () => {
		const classified = classifyAuditError({
			name: 'ProviderError',
			statusCode: 401,
			message: 'Bearer sk-secret-key-invalid',
		});
		expect(classified.errorClass).toBe('provider_auth');
		expect(JSON.stringify(classified)).not.toContain('sk-secret');
	});

	it('classifies an incomplete model stream as an interrupted model task', () => {
		const classified = classifyAuditError(
			new Error('prompt failed: Stream ended without finish_reason'),
		);

		expect(classified).toEqual({
			errorClass: 'model_stream_interrupted',
			errorCode: 'missing_finish_reason',
		});
	});

	it('classifies AbortSignal timeout before generic abort cancellation', () => {
		const classified = classifyAuditError(
			new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
		);

		expect(classified).toEqual({
			errorClass: 'provider_timeout',
			errorCode: null,
		});
	});

	it('never classifies discovery decision timeouts as provider timeouts', () => {
		const classified = classifyAuditError(
			new Error('Discovery decision timed out for market nigeria'),
		);
		expect(classified).toEqual({
			errorClass: 'agent_task_timeout',
			errorCode: null,
		});

		const named = classifyAuditError({
			name: 'DiscoveryAgentTaskTimeoutError',
			message: 'Discovery decision timed out for market nigeria',
		});
		expect(named.errorClass).toBe('agent_task_timeout');
	});

	it('classifies valibot finish validation failures', () => {
		const classified = classifyAuditError(
			new ValiError([
				{
					kind: 'validation',
					type: 'check',
					input: {},
					expected: 'valid',
					received: 'invalid',
					message: 'Region evidence must include claim candidates linked to material requirements',
				},
			]),
		);
		expect(classified).toEqual({
			errorClass: 'validation_error',
			errorCode: 'valibot',
		});
	});

	it('emits one terminal pipeline event with elapsed time', () => {
		const log = createMockLog();
		const timestamps = [
			'2026-07-23T10:00:00.000Z',
			'2026-07-23T10:00:05.000Z',
			'2026-07-23T10:00:06.000Z',
		];
		const audit = createResearchAuditEmitter(log, runKey, () => timestamps.shift()!);
		audit.startPipeline();
		audit.completePipeline({ passed: 1 });
		audit.failPipeline('pipeline_failed');

		const terminal = auditAttributes(log).filter((event) =>
			['pipeline_completed', 'pipeline_failed'].includes(String(event.auditEvent)),
		);
		expect(terminal).toHaveLength(1);
		expect(terminal[0]).toEqual(
			expect.objectContaining({
				auditEvent: 'pipeline_completed',
				durationMs: 5000,
				startedAt: '2026-07-23T10:00:00.000Z',
				completedAt: '2026-07-23T10:00:05.000Z',
			}),
		);
	});

	it('emits one terminal event per provider attempt handle', () => {
		const log = createMockLog();
		const audit = createResearchAuditEmitter(log, runKey, clock);
		const attempt = audit.startProviderAttempt({
			callKey: 'call_once',
			provider: 'exa',
			phase: 'discovery',
			operation: 'search',
			mode: 'search',
			attempt: 1,
			admittedEstimateUsd: 0.02,
		});
		attempt.complete({ reportedCostUsd: 0.01 });
		attempt.fail('provider_error', '500');

		const terminal = auditAttributes(log).filter((event) =>
			['provider_attempt_completed', 'provider_attempt_failed'].includes(String(event.auditEvent)),
		);
		expect(terminal).toHaveLength(1);
	});
});
