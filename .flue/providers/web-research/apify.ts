import { deriveReceiptId } from '../../research/ids';
import type { ProviderCallReceipt } from '../../research/schemas';
import { isUsableExtraction, truncateContent } from './extraction-quality';
import {
	ProviderError,
	parseRetryAfter,
	redactSecrets,
} from './provider-errors';
import {
	APIFY_PLAYWRIGHT_TIMEOUT_MS,
	APIFY_RAW_HTTP_TIMEOUT_MS,
	MAX_NORMALIZED_CONTENT_CHARS,
	MAX_RESPONSE_BYTES,
	type WebExtractionProvider,
	type WebFetchInput,
	type WebFetchResponse,
} from './provider';
import {
	assertPublicHttpsUrl,
	assertResponseSize,
	type HostnameResolver,
} from './url-policy';

export interface ApifyConfig {
	apiToken: string;
	fetch?: typeof globalThis.fetch;
	resolveHostname?: HostnameResolver;
	sleep?: (milliseconds: number) => Promise<void>;
}

type ScrapingMode = 'raw-http' | 'browser-playwright';

export class ApifyWebExtractionProvider implements WebExtractionProvider {
	readonly #apiToken: string;
	readonly #fetch: typeof globalThis.fetch;
	readonly #resolveHostname?: HostnameResolver;
	readonly #sleep: (milliseconds: number) => Promise<void>;
	readonly #ambiguousStarts = new Set<string>();

	constructor(config: ApifyConfig) {
		this.#apiToken = config.apiToken;
		this.#fetch = (config.fetch ?? globalThis.fetch).bind(globalThis);
		this.#resolveHostname = config.resolveHostname;
		this.#sleep = config.sleep ?? sleep;
	}

	async fetch(input: WebFetchInput, signal: AbortSignal): Promise<WebFetchResponse> {
		const mode: ScrapingMode = input.mode === 'browser-playwright' ? 'browser-playwright' : 'raw-http';
		const validatedUrl = await assertPublicHttpsUrl(input.url, this.#resolveHostname);
		const startedAt = new Date().toISOString();
		const startMs = Date.now();
		const timeoutMs = mode === 'raw-http' ? APIFY_RAW_HTTP_TIMEOUT_MS : APIFY_PLAYWRIGHT_TIMEOUT_MS;

		const startKey = `${input.callKey}:${mode}`;
		if (this.#ambiguousStarts.has(startKey)) {
			throw new ProviderError('Ambiguous Apify start — not retrying', {
				retryable: false,
				provider: 'apify',
			});
		}

		let runId: string | null = null;
		try {
			const startResponse = await this.#apiRequest(
				'POST',
				'https://api.apify.com/v2/acts/apify~rag-web-browser/runs',
				{
					query: validatedUrl,
					outputFormats: ['markdown'],
					scrapingTool: mode,
					requestTimeoutSecs: mode === 'raw-http' ? 40 : 60,
					maxRequestRetries: 1,
					dynamicContentWaitSecs: mode === 'raw-http' ? 0 : 10,
					removeCookieWarnings: false,
					debugMode: false,
				},
				signal,
				15_000,
			);

			runId = (startResponse.data as { id?: string })?.id ?? null;
			if (!runId) {
				this.#ambiguousStarts.add(startKey);
				throw new ProviderError('Apify start returned no run ID', {
					retryable: false,
					provider: 'apify',
				});
			}

			const run = await this.#pollRun(runId, signal, timeoutMs);
			if (signal.aborted) {
				await this.#abortRun(runId);
				throw new ProviderError('Apify run cancelled', {
					retryable: false,
					provider: 'apify',
				});
			}

			const datasetId = (run.data as { defaultDatasetId?: string })?.defaultDatasetId;
			const items = (datasetId
				? await this.#apiGetWithRetry(
						`https://api.apify.com/v2/datasets/${datasetId}/items`,
						signal,
						30_000,
					)
				: []) as Array<Record<string, unknown>>;

			const item = Array.isArray(items) ? items[0] : null;
			const metadata = item?.metadata as
				| { url?: string; title?: string }
				| undefined;
			const finalUrl = (item?.url as string) ?? metadata?.url ?? validatedUrl;
			await assertPublicHttpsUrl(finalUrl, this.#resolveHostname);

			const content = truncateContent((item?.markdown as string) ?? '', MAX_NORMALIZED_CONTENT_CHARS);
			const usageTotalUsd = (run.data as { usageTotalUsd?: number })?.usageTotalUsd ?? null;

			const receipt = await this.#buildReceipt({
				input,
				mode,
				startedAt,
				startMs,
				status: signal.aborted ? 'cancelled' : 'succeeded',
				resultUrls: [finalUrl],
				costUsd: usageTotalUsd,
				providerRequestId: runId,
			});

			return {
				url: validatedUrl,
				finalUrl,
				title: (item?.title as string) ?? metadata?.title ?? '',
				content,
				publishedAt: null,
				receipt,
			};
		} catch (error) {
			if (runId !== null && signal.aborted) {
				await this.#abortRun(runId);
			}
			if (
				runId === null &&
				(!(error instanceof ProviderError) || error.retryable)
			) {
				this.#ambiguousStarts.add(startKey);
			}
			if (error instanceof ProviderError) throw error;
			throw new ProviderError(
				redactSecrets(error instanceof Error ? error.message : String(error), [this.#apiToken]),
				{ retryable: false, provider: 'apify', cause: error },
			);
		}
	}

	async #pollRun(
		runId: string,
		signal: AbortSignal,
		deadlineMs: number,
	): Promise<Record<string, unknown>> {
		const start = Date.now();
		let delay = 1000;
		while (Date.now() - start < deadlineMs) {
			if (signal.aborted) break;
			const run = await this.#apiGetWithRetry(
				`https://api.apify.com/v2/actor-runs/${runId}`,
				signal,
				15_000,
			);
			const status = (run.data as { status?: string })?.status;
			if (status === 'SUCCEEDED') return run;
			if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
				throw new ProviderError(`Apify run ${status}`, { retryable: false, provider: 'apify' });
			}
			await this.#sleep(Math.min(delay, 5000));
			delay = Math.min(delay * 1.5, 5000);
		}
		throw new ProviderError('Apify poll timeout', { retryable: true, provider: 'apify' });
	}

	async #abortRun(runId: string): Promise<void> {
		try {
			await this.#apiRequest(
				'POST',
				`https://api.apify.com/v2/actor-runs/${runId}/abort`,
				null,
				AbortSignal.timeout(10_000),
				10_000,
			);
		} catch {
			// Best effort abort
		}
	}

	async #apiRequest(
		method: string,
		url: string,
		body: Record<string, unknown> | null,
		signal: AbortSignal,
		timeoutMs: number,
	): Promise<Record<string, unknown>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		signal.addEventListener('abort', onAbort);

		try {
			const response = await this.#fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.#apiToken}`,
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});

			const text = await response.text();
			assertResponseSize(new TextEncoder().encode(text).byteLength, MAX_RESPONSE_BYTES);

			if (!response.ok) {
				throw new ProviderError(`Apify request failed: ${response.status}`, {
					retryable: response.status >= 500 || response.status === 429,
					statusCode: response.status,
					provider: 'apify',
					retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
				});
			}

			return JSON.parse(text) as Record<string, unknown>;
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
		}
	}

	async #apiGetWithRetry(
		url: string,
		signal: AbortSignal,
		timeoutMs: number,
		maxAttempts = 3,
	): Promise<Record<string, unknown>> {
		let lastError: unknown;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return await this.#apiRequest('GET', url, null, signal, timeoutMs);
			} catch (error) {
				lastError = error;
				if (signal.aborted) throw error;
				if (!(error instanceof ProviderError) || !error.retryable || attempt === maxAttempts) {
					throw error;
				}
				await this.#sleep(error.retryAfterMs ?? Math.min(250 * 2 ** (attempt - 1), 1000));
			}
		}
		throw lastError;
	}

	async #buildReceipt(params: {
		input: WebFetchInput;
		mode: 'raw-http' | 'browser-playwright';
		startedAt: string;
		startMs: number;
		status: ProviderCallReceipt['status'];
		resultUrls: string[];
		costUsd: number | null;
		providerRequestId: string;
		fallbackReason?: ProviderCallReceipt['fallbackReason'];
	}): Promise<ProviderCallReceipt> {
			const receiptId = await deriveReceiptId(
				params.input.callKey,
				params.input.attempt,
				'apify',
				params.mode,
			);
		return {
			receiptId,
			callKey: params.input.callKey,
			provider: 'apify',
			providerRequestId: params.providerRequestId,
			operation: 'fetch',
			mode: params.mode,
			phase: params.input.phase,
			briefId: params.input.briefId,
			market: params.input.market,
			query: null,
			requestedUrls: [params.input.url],
			sourceTier: params.input.tier,
			requestedAt: params.startedAt,
			completedAt: new Date().toISOString(),
			resultUrls: params.resultUrls,
			costUsd: params.costUsd,
			latencyMs: Date.now() - params.startMs,
			status: params.status,
			fallbackReason: params.fallbackReason ?? null,
			usage: {
				computeUnits: null,
				externalTransferGbytes: null,
				proxySerps: null,
			},
		};
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export { isUsableExtraction };
