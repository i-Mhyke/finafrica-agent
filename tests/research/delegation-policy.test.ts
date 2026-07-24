import { describe, expect, it, vi } from 'vitest';
import {
	ResearchDelegationDeniedError,
	researchDelegationInterceptor,
} from '../../.flue/research/delegation-policy';

describe('research delegation policy', () => {
	it('allows application-controlled top-level task execution', async () => {
		const next = vi.fn().mockResolvedValue('completed');

		await expect(
			researchDelegationInterceptor(
				{ type: 'task', taskId: 'task_1' },
				{
					session: 'task:brief-validator:brief_1:conversation_1',
					runId: 'run_1',
				},
				next,
			),
		).resolves.toBe('completed');

		expect(next).toHaveBeenCalledOnce();
	});

	it('blocks the task tool inside a delegated research worker', async () => {
		const next = vi.fn().mockResolvedValue('must not execute');

		await expect(
			researchDelegationInterceptor(
				{
					type: 'tool',
					toolCallId: 'call_1',
					toolName: 'task',
				},
				{
					session: 'task:brief-refiner:brief_1:conversation_1',
					runId: 'run_1',
				},
				next,
			),
		).rejects.toBeInstanceOf(ResearchDelegationDeniedError);

		expect(next).not.toHaveBeenCalled();
	});

	it('blocks a nested task boundary if a task tool bypasses the first guard', async () => {
		const next = vi.fn().mockResolvedValue('must not execute');

		await expect(
			researchDelegationInterceptor(
				{ type: 'task', taskId: 'task_2' },
				{
					session:
						'task:task:brief-refiner:brief_1:conversation_1:conversation_2',
					runId: 'run_1',
				},
				next,
			),
		).rejects.toBeInstanceOf(ResearchDelegationDeniedError);

		expect(next).not.toHaveBeenCalled();
	});

	it('does not block an approved research tool', async () => {
		const next = vi.fn().mockResolvedValue('searched');

		await expect(
			researchDelegationInterceptor(
				{
					type: 'tool',
					toolCallId: 'call_2',
					toolName: 'search_web',
				},
				{
					session: 'task:research-nigeria:brief_1:conversation_1',
					runId: 'run_1',
				},
				next,
			),
		).resolves.toBe('searched');

		expect(next).toHaveBeenCalledOnce();
	});
});
