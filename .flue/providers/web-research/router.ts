import {
	deriveProviderAttemptCallKey,
	deriveReceiptId,
} from '../../research/ids';
import type { ProviderCallReceipt } from '../../research/schemas';
import type { ResearchAuditEmitter } from '../../research/run-audit';
import { classifyAuditError } from '../../research/run-audit';
import {
	MAX_CONCURRENT_APIFY_RUNS,
	MAX_CONCURRENT_PROVIDER_CALLS,
	RESEARCH_PROVIDER_DEFAULT_REQUEST_LIMIT,
} from '../../research/schemas';
import type { ApifyWebExtractionProvider } from './apify';
import { isUsableExtraction } from './extraction-quality';
import type { ExaWebResearchProvider } from './exa';
import {
	BudgetExhaustedError,
	DuplicateCallKeyError,
	ProviderError,
	ProviderRequestLimitError,
} from './provider-errors';
import {
	ADMISSION_ESTIMATES_USD,
	type FetchMode,
	type WebFetchInput,
	type WebFetchResponse,
	type WebResearchProvider,
	type WebSearchInput,
	type WebSearchResponse,
} from './provider';

export interface BudgetTracker {
	readonly remainingUsd: number;
	readonly phaseRemainingUsd: number;
	canAdmit(estimateUsd: number): boolean;
	reserve(estimateUsd: number): boolean;
	settle(estimateUsd: number, actualUsd: number | null): void;
	readonly receipts: ProviderCallReceipt[];
	readonly unpricedCallCount: number;
	readonly actualCostUsd: number;
	readonly admittedEstimateUsd: number;
	readonly overrunUsd: number;
	readonly exhausted: boolean;
}

export function createBudgetTracker(
	totalUsd: number,
	phaseUsd: number,
): BudgetTracker & { receipts: ProviderCallReceipt[] } {
	let remainingUsd = totalUsd;
	let phaseRemainingUsd = phaseUsd;
	let actualCostUsd = 0;
	let admittedEstimateUsd = 0;
	let unpricedCallCount = 0;
	let overrunUsd = 0;
	let exhausted = false;
	const receipts: ProviderCallReceipt[] = [];

	return {
		get remainingUsd() {
			return remainingUsd;
		},
		get phaseRemainingUsd() {
			return phaseRemainingUsd;
		},
		get receipts() {
			return receipts;
		},
		get unpricedCallCount() {
			return unpricedCallCount;
		},
		get actualCostUsd() {
			return actualCostUsd;
		},
		get admittedEstimateUsd() {
			return admittedEstimateUsd;
		},
		get overrunUsd() {
			return overrunUsd;
		},
		get exhausted() {
			return exhausted;
		},
		canAdmit(estimateUsd: number): boolean {
			return !exhausted && estimateUsd <= phaseRemainingUsd && estimateUsd <= remainingUsd;
		},
		reserve(estimateUsd: number): boolean {
			if (!this.canAdmit(estimateUsd)) return false;
			admittedEstimateUsd += estimateUsd;
			remainingUsd -= estimateUsd;
			phaseRemainingUsd -= estimateUsd;
			exhausted = remainingUsd <= 0 || phaseRemainingUsd <= 0;
			return true;
		},
		settle(estimateUsd: number, actualUsd: number | null): void {
			const chargeAmount = actualUsd ?? estimateUsd;
			if (actualUsd === null) unpricedCallCount++;
			actualCostUsd += chargeAmount;
			remainingUsd -= chargeAmount - estimateUsd;
			phaseRemainingUsd -= chargeAmount - estimateUsd;
			if (actualUsd !== null && actualUsd > estimateUsd) {
				overrunUsd += actualUsd - estimateUsd;
				exhausted = true;
			} else {
				exhausted = remainingUsd <= 0 || phaseRemainingUsd <= 0;
			}
		},
	};
}

class AdjustableSemaphore {
	#active = 0;
	#limit: number;
	readonly #waiters: Array<() => void> = [];

	constructor(limit: number) {
		this.#limit = limit;
	}

	setLimit(limit: number): void {
		this.#limit = Math.max(1, limit);
		this.#drain();
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		await this.#acquire();
		try {
			return await operation();
		} finally {
			this.#active--;
			this.#drain();
		}
	}

	async #acquire(): Promise<void> {
		if (this.#active < this.#limit) {
			this.#active++;
			return;
		}
		await new Promise<void>((resolve) => this.#waiters.push(resolve));
	}

	#drain(): void {
		while (this.#active < this.#limit && this.#waiters.length > 0) {
			this.#active++;
			this.#waiters.shift()?.();
		}
	}
}

export interface RouterConfig {
	exa: ExaWebResearchProvider;
	apify: ApifyWebExtractionProvider | null;
	apifyFallbackEnabled: boolean;
	budget: BudgetTracker;
	audit?: ResearchAuditEmitter;
	sleep?: (milliseconds: number) => Promise<void>;
	random?: () => number;
	maxProviderRequests?: number;
	maxExaAttempts?: number;
}

type ProviderName = 'exa' | 'apify';
type AttemptInput = WebSearchInput | WebFetchInput;

export class CostAwareWebResearchRouter implements WebResearchProvider {
	readonly #exa: ExaWebResearchProvider;
	readonly #apify: ApifyWebExtractionProvider | null;
	readonly #apifyFallbackEnabled: boolean;
	readonly #budget: BudgetTracker;
	readonly #audit?: ResearchAuditEmitter;
	readonly #executedCallKeys = new Set<string>();
	readonly #providerSemaphore = new AdjustableSemaphore(MAX_CONCURRENT_PROVIDER_CALLS);
	readonly #apifySemaphore = new AdjustableSemaphore(MAX_CONCURRENT_APIFY_RUNS);
	readonly #sleep: (milliseconds: number) => Promise<void>;
	readonly #random: () => number;
	readonly #maxProviderRequests: number;
	readonly #maxExaAttempts: number;
	#admittedRequestCount = 0;
	#requestRejectionCount = 0;

	constructor(config: RouterConfig) {
		this.#exa = config.exa;
		this.#apify = config.apify;
		this.#apifyFallbackEnabled = config.apifyFallbackEnabled;
		this.#budget = config.budget;
		this.#audit = config.audit;
		this.#sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
		this.#random = config.random ?? Math.random;
		this.#maxProviderRequests =
			config.maxProviderRequests ?? RESEARCH_PROVIDER_DEFAULT_REQUEST_LIMIT;
		this.#maxExaAttempts = Math.max(1, config.maxExaAttempts ?? 1);
	}

	get maxProviderRequests(): number {
		return this.#maxProviderRequests;
	}

	get admittedRequestCount(): number {
		return this.#admittedRequestCount;
	}

	get requestRejectionCount(): number {
		return this.#requestRejectionCount;
	}

	async search(
		input: WebSearchInput,
		signal: AbortSignal,
		allocation?: BudgetTracker,
	): Promise<WebSearchResponse> {
		this.#guardCallKey(input.callKey);
		return this.#executeWithRetry({
			input,
			signal,
			provider: 'exa',
			mode: 'search',
			estimateUsd: ADMISSION_ESTIMATES_USD['exa-search'],
			allocation,
			operation: (attemptInput) => this.#exa.search(attemptInput as WebSearchInput, signal),
		});
	}

	async fetch(
		input: WebFetchInput,
		signal: AbortSignal,
		allocation?: BudgetTracker,
	): Promise<WebFetchResponse> {
		this.#guardCallKey(input.callKey);

		try {
			const exaResponse = await this.#executeWithRetry({
				input: { ...input, mode: input.mode === 'full-text' ? 'full-text' : 'highlights' },
				signal,
				provider: 'exa',
				mode: input.mode === 'full-text' ? 'full-text' : 'highlights',
				estimateUsd: ADMISSION_ESTIMATES_USD['exa-contents'],
				allocation,
				operation: (attemptInput) => this.#exa.fetch(attemptInput as WebFetchInput, signal),
			});
			const quality = isUsableExtraction({
				content: exaResponse.content,
				title: exaResponse.title,
				finalUrl: exaResponse.finalUrl,
				hasError: false,
			});
			if (quality.usable) return exaResponse;
			exaResponse.receipt.fallbackReason = 'exa-unusable';
		} catch (error) {
			if (error instanceof BudgetExhaustedError) throw error;
			if (error instanceof ProviderRequestLimitError) throw error;
			if (error instanceof ProviderError && !error.retryable) throw error;
		}

		if (!this.#apifyFallbackEnabled || !this.#apify) {
			throw new ProviderError('Exa extraction unusable and Apify fallback disabled', {
				retryable: false,
				provider: 'exa',
			});
		}

		try {
			const rawResponse = await this.#executeApify({
				input: { ...input, mode: 'raw-http' },
				signal,
				mode: 'raw-http',
				estimateUsd: ADMISSION_ESTIMATES_USD['apify-raw-http'],
				allocation,
			});
			const quality = isUsableExtraction({
				content: rawResponse.content,
				title: rawResponse.title,
				finalUrl: rawResponse.finalUrl,
				hasError: false,
			});
			if (quality.usable) return rawResponse;
			rawResponse.receipt.fallbackReason = 'raw-http-unusable';
		} catch (error) {
			if (error instanceof BudgetExhaustedError) throw error;
			if (error instanceof ProviderRequestLimitError) throw error;
			if (error instanceof ProviderError && !error.retryable) throw error;
		}

		return this.#executeApify({
			input: { ...input, mode: 'browser-playwright' },
			signal,
			mode: 'browser-playwright',
			estimateUsd: ADMISSION_ESTIMATES_USD['apify-playwright'],
			allocation,
		});
	}

	#guardCallKey(callKey: string): void {
		if (this.#executedCallKeys.has(callKey)) {
			throw new DuplicateCallKeyError(callKey);
		}
		this.#executedCallKeys.add(callKey);
	}

	async #executeApify(params: {
		input: WebFetchInput;
		signal: AbortSignal;
		mode: Extract<FetchMode, 'raw-http' | 'browser-playwright'>;
		estimateUsd: number;
		allocation?: BudgetTracker;
	}): Promise<WebFetchResponse> {
		if (!this.#apify) {
			throw new ProviderError('Apify is unavailable', { retryable: false, provider: 'apify' });
		}
		const attemptInput = await this.#attemptInput(params.input, 'apify', params.mode, 1);
		this.#admit(params.estimateUsd, params.allocation, attemptInput, 'apify', params.mode);
		const startedAt = new Date().toISOString();
		const startMs = Date.now();
		const auditAttempt = this.#audit?.startProviderAttempt(
			this.#providerAttemptScope(attemptInput, 'apify', params.mode, params.estimateUsd),
		);
		try {
			const response = await this.#providerSemaphore.run(() =>
				this.#apifySemaphore.run(() => this.#apify!.fetch(attemptInput as WebFetchInput, params.signal)),
			);
			this.#recordSuccess(params.estimateUsd, response.receipt, params.allocation);
			auditAttempt?.complete({
				reportedCostUsd: response.receipt.costUsd,
				providerRequestId: response.receipt.providerRequestId,
				durationMs: response.receipt.latencyMs,
			});
			return response;
		} catch (error) {
			const classified = classifyAuditError(error);
			auditAttempt?.fail(classified.errorClass, classified.errorCode);
			await this.#recordFailure({
				input: attemptInput,
				provider: 'apify',
				mode: params.mode,
				estimateUsd: params.estimateUsd,
				allocation: params.allocation,
				startedAt,
				startMs,
				signal: params.signal,
			});
			throw error;
		}
	}

	async #executeWithRetry<T extends WebSearchResponse | WebFetchResponse>(params: {
		input: AttemptInput;
		signal: AbortSignal;
		provider: 'exa';
		mode: ProviderCallReceipt['mode'];
		estimateUsd: number;
		allocation?: BudgetTracker;
		operation: (input: AttemptInput) => Promise<T>;
		maxAttempts?: number;
	}): Promise<T> {
		let lastError: unknown;
		const maxAttempts = params.maxAttempts ?? this.#maxExaAttempts;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const attemptInput = await this.#attemptInput(params.input, params.provider, params.mode, attempt);
			this.#admit(params.estimateUsd, params.allocation, attemptInput, params.provider, params.mode);
			const startedAt = new Date().toISOString();
			const startMs = Date.now();
			const auditAttempt = this.#audit?.startProviderAttempt(
				this.#providerAttemptScope(
					attemptInput,
					params.provider,
					params.mode,
					params.estimateUsd,
				),
			);
			try {
				const response = await this.#providerSemaphore.run(() => params.operation(attemptInput));
				this.#recordSuccess(params.estimateUsd, response.receipt, params.allocation);
				auditAttempt?.complete({
					reportedCostUsd: response.receipt.costUsd,
					providerRequestId: response.receipt.providerRequestId,
					durationMs: response.receipt.latencyMs,
				});
				return response;
			} catch (error) {
				const classified = classifyAuditError(error);
				auditAttempt?.fail(classified.errorClass, classified.errorCode);
				lastError = error;
				await this.#recordFailure({
					input: attemptInput,
					provider: params.provider,
					mode: params.mode,
					estimateUsd: params.estimateUsd,
					allocation: params.allocation,
					startedAt,
					startMs,
					signal: params.signal,
				});
				if (params.signal.aborted) throw error;
				if (error instanceof ProviderError && error.statusCode === 429) {
					this.#providerSemaphore.setLimit(1);
				}
				if (error instanceof ProviderError && !error.retryable) throw error;
				if (error instanceof BudgetExhaustedError) throw error;
				if (error instanceof ProviderRequestLimitError) throw error;
				if (attempt < maxAttempts) {
					const retryAfter =
						error instanceof ProviderError ? error.retryAfterMs : null;
					const delay =
						retryAfter ??
						Math.min(1000 * 2 ** (attempt - 1) + this.#random() * 500, 8000);
					await this.#sleep(delay);
				}
			}
		}
		throw lastError;
	}

	async #attemptInput(
		input: AttemptInput,
		provider: ProviderName,
		mode: ProviderCallReceipt['mode'],
		attempt: number,
	): Promise<AttemptInput> {
		return {
			...input,
			callKey: await deriveProviderAttemptCallKey(input.callKey, provider, mode, attempt),
			attempt,
		};
	}

	#budgets(allocation?: BudgetTracker): BudgetTracker[] {
		return allocation && allocation !== this.#budget
			? [this.#budget, allocation]
			: [this.#budget];
	}

	#providerAttemptScope(
		input: AttemptInput,
		provider: ProviderName,
		mode: ProviderCallReceipt['mode'],
		estimateUsd: number,
	) {
		return {
			callKey: input.callKey,
			provider,
			phase: input.phase,
			briefId: input.briefId,
			market: input.market,
			operation: 'query' in input ? 'search' : 'fetch',
			mode,
			attempt: input.attempt,
			admittedEstimateUsd: estimateUsd,
		};
	}
	#admit(
		estimateUsd: number,
		allocation: BudgetTracker | undefined,
		attemptInput: AttemptInput,
		provider: ProviderName,
		mode: ProviderCallReceipt['mode'],
	): void {
		const budgets = this.#budgets(allocation);
		if (this.#admittedRequestCount >= this.#maxProviderRequests) {
			this.#requestRejectionCount++;
			this.#audit?.recordProviderRejection(
				this.#providerAttemptScope(attemptInput, provider, mode, estimateUsd),
			);
			throw new ProviderRequestLimitError();
		}
		if (!budgets.every((budget) => budget.canAdmit(estimateUsd))) {
			if (this.#audit) {
				this.#audit.recordBudgetRejection(
					this.#providerAttemptScope(attemptInput, provider, mode, estimateUsd),
				);
			}
			throw new BudgetExhaustedError('Provider budget exhausted');
		}
		for (const budget of budgets) {
			if (!budget.reserve(estimateUsd)) {
				throw new BudgetExhaustedError('Provider budget reservation failed');
			}
		}
		this.#admittedRequestCount++;
	}

	#recordSuccess(
		estimateUsd: number,
		receipt: ProviderCallReceipt,
		allocation?: BudgetTracker,
	): void {
		for (const budget of this.#budgets(allocation)) {
			budget.settle(estimateUsd, receipt.costUsd);
			budget.receipts.push(receipt);
		}
	}

	async #recordFailure(params: {
		input: AttemptInput;
		provider: ProviderName;
		mode: ProviderCallReceipt['mode'];
		estimateUsd: number;
		allocation?: BudgetTracker;
		startedAt: string;
		startMs: number;
		signal: AbortSignal;
	}): Promise<void> {
		const receipt: ProviderCallReceipt = {
			receiptId: await deriveReceiptId(
				params.input.callKey,
				params.input.attempt,
				params.provider,
				params.mode,
			),
			callKey: params.input.callKey,
			provider: params.provider,
			providerRequestId: null,
			operation: 'query' in params.input ? 'search' : 'fetch',
			mode: params.mode,
			phase: params.input.phase,
			briefId: params.input.briefId,
			market: params.input.market,
			query: 'query' in params.input ? params.input.query : null,
			requestedUrls: 'url' in params.input ? [params.input.url] : [],
			sourceTier: params.input.tier,
			requestedAt: params.startedAt,
			completedAt: new Date().toISOString(),
			resultUrls: [],
			costUsd: null,
			latencyMs: Date.now() - params.startMs,
			status: params.signal.aborted ? 'cancelled' : 'failed',
			fallbackReason: null,
			usage: {
				computeUnits: null,
				externalTransferGbytes: null,
				proxySerps: null,
			},
		};
		for (const budget of this.#budgets(params.allocation)) {
			budget.settle(params.estimateUsd, null);
			budget.receipts.push(receipt);
		}
	}
}
