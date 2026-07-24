export class ProviderError extends Error {
	readonly retryable: boolean;
	readonly statusCode: number | null;
	readonly provider: string;
	readonly retryAfterMs: number | null;

	constructor(
		message: string,
		options: {
			retryable: boolean;
			statusCode?: number | null;
			provider: string;
			cause?: unknown;
			retryAfterMs?: number | null;
		},
	) {
		super(message, { cause: options.cause });
		this.name = 'ProviderError';
		this.retryable = options.retryable;
		this.statusCode = options.statusCode ?? null;
		this.provider = options.provider;
		this.retryAfterMs = options.retryAfterMs ?? null;
	}
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	if (!Number.isFinite(date)) return null;
	return Math.max(0, date - nowMs);
}

export class UrlPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UrlPolicyError';
	}
}

export class BudgetExhaustedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BudgetExhaustedError';
	}
}

export class ProviderRequestLimitError extends Error {
	constructor(message = 'Provider request limit reached') {
		super(message);
		this.name = 'ProviderRequestLimitError';
	}
}

export class DuplicateCallKeyError extends Error {
	constructor(callKey: string) {
		super(`Duplicate provider callKey: ${callKey}`);
		this.name = 'DuplicateCallKeyError';
	}
}

export function redactSecrets(text: string, secrets: string[]): string {
	let result = text;
	for (const secret of secrets) {
		if (secret.length > 0) {
			result = result.replaceAll(secret, '[REDACTED]');
		}
	}
	return result;
}

export function classifyHttpError(status: number): { retryable: boolean; terminal: boolean } {
	if (status === 429) return { retryable: true, terminal: false };
	if (status >= 500) return { retryable: true, terminal: false };
	if (status === 400 || status === 401 || status === 403) return { retryable: false, terminal: true };
	return { retryable: false, terminal: true };
}
