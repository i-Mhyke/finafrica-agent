import {
	instrument,
	type FlueExecutionContext,
	type FlueExecutionInterceptor,
	type FlueExecutionOperation,
} from '@flue/runtime';

const POLICY_KEY = Symbol.for('publication-agent.research-delegation-policy.v1');

export class ResearchDelegationDeniedError extends Error {
	readonly code = 'research_nested_delegation_denied';

	constructor(session: string | undefined) {
		super(
			`Research workers cannot delegate tasks${session ? ` from session ${session}` : ''}`,
		);
		this.name = 'ResearchDelegationDeniedError';
	}
}

function isDelegatedSession(session: string | undefined): boolean {
	return session?.startsWith('task:') ?? false;
}

function isNestedTaskSession(session: string | undefined): boolean {
	return session?.startsWith('task:task:') ?? false;
}

export const researchDelegationInterceptor: FlueExecutionInterceptor = async <T>(
	operation: FlueExecutionOperation,
	ctx: FlueExecutionContext,
	next: () => Promise<T>,
): Promise<T> => {
	if (
		operation.type === 'tool' &&
		operation.toolName === 'task' &&
		isDelegatedSession(ctx.session)
	) {
		throw new ResearchDelegationDeniedError(ctx.session);
	}

	if (operation.type === 'task' && isNestedTaskSession(ctx.session)) {
		throw new ResearchDelegationDeniedError(ctx.session);
	}

	return next();
};

let registered = false;

export function registerResearchDelegationPolicy(): void {
	if (registered) return;

	instrument({
		key: POLICY_KEY,
		observe: () => undefined,
		interceptor: researchDelegationInterceptor,
		dispose: () => {
			registered = false;
		},
	});
	registered = true;
}
