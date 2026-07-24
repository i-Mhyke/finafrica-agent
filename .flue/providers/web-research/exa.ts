import { deriveReceiptId } from '../../research/ids';
import type { ProviderCallReceipt } from '../../research/schemas';
import { isUsableExtraction, normalizeContent, truncateContent } from './extraction-quality';
import {
	ProviderError,
	classifyHttpError,
	parseRetryAfter,
	redactSecrets,
} from './provider-errors';
import {
	ADMISSION_ESTIMATES_USD,
	EXA_CONTENTS_TIMEOUT_MS,
	EXA_SEARCH_TIMEOUT_MS,
	MAX_NORMALIZED_CONTENT_CHARS,
	MAX_RESPONSE_BYTES,
	type WebExtractionProvider,
	type WebFetchInput,
	type WebFetchResponse,
	type WebResearchProvider,
	type WebSearchInput,
	type WebSearchResponse,
} from './provider';
import {
	assertPublicHttpsUrl,
	assertResponseSize,
	type HostnameResolver,
} from './url-policy';

export interface ExaConfig {
	apiKey: string;
	fetch?: typeof globalThis.fetch;
	resolveHostname?: HostnameResolver;
}

export class ExaWebResearchProvider implements WebResearchProvider {
	readonly #apiKey: string;
	readonly #fetch: typeof globalThis.fetch;
	readonly #resolveHostname?: HostnameResolver;

	constructor(config: ExaConfig) {
		this.#apiKey = config.apiKey;
		this.#fetch = (config.fetch ?? globalThis.fetch).bind(globalThis);
		this.#resolveHostname = config.resolveHostname;
	}

	async search(input: WebSearchInput, signal: AbortSignal): Promise<WebSearchResponse> {
		await assertPublicHttpsUrl('https://api.exa.ai/search');
		const startedAt = new Date().toISOString();
		const startMs = Date.now();

		const body = {
			query: input.query,
			type: 'auto',
			numResults: Math.min(input.maxResults, 10),
			includeDomains: input.domains.length > 0 ? input.domains : undefined,
			startPublishedDate: input.startDate,
			endPublishedDate: input.endDate,
			contents: { highlights: { maxCharacters: 2000 } },
		};

		const response = (await this.#request(
			'https://api.exa.ai/search',
			body,
			signal,
			EXA_SEARCH_TIMEOUT_MS,
		)) as {
			results?: Array<{
				url: string;
				title?: string;
				publishedDate?: string;
				highlights?: string[];
				text?: string;
			}>;
			costDollars?: { total?: number };
			requestId?: string;
		};

		for (const result of response.results ?? []) {
			await assertPublicHttpsUrl(result.url, this.#resolveHostname);
		}

		const results = (response.results ?? []).map((r) => ({
				url: r.url,
				title: r.title ?? '',
				publishedAt: r.publishedDate ?? null,
			highlights: r.highlights ?? [],
			snippet: r.text?.slice(0, 500) ?? null,
		}));

		const receipt = await this.#buildReceipt({
			input,
			operation: 'search',
			mode: 'search',
			provider: 'exa',
			startedAt,
			startMs,
			status: 'succeeded',
			resultUrls: results.map((r: { url: string }) => r.url),
			costUsd: response.costDollars?.total ?? null,
			providerRequestId: response.requestId ?? null,
		});

		return { results, receipt };
	}

	async fetch(input: WebFetchInput, signal: AbortSignal): Promise<WebFetchResponse> {
		const validatedUrl = await assertPublicHttpsUrl(input.url, this.#resolveHostname);
		const startedAt = new Date().toISOString();
		const startMs = Date.now();

		const useFullText = input.mode === 'full-text';
		const body = {
			urls: [validatedUrl],
			...(useFullText
				? { text: { maxCharacters: input.maxCharacters } }
				: { highlights: { maxCharacters: input.maxCharacters } }),
		};

		const response = (await this.#request(
			'https://api.exa.ai/contents',
			body,
			signal,
			EXA_CONTENTS_TIMEOUT_MS,
		)) as {
			results?: Array<{
				url?: string;
				title?: string;
				text?: string;
				highlights?: string[];
				publishedDate?: string;
			}>;
			costDollars?: { total?: number };
			requestId?: string;
		};

		const item = response.results?.[0];
		const content = useFullText ? (item?.text ?? '') : (item?.highlights?.join('\n') ?? '');
		const finalUrl = item?.url ?? validatedUrl;

		await assertPublicHttpsUrl(finalUrl, this.#resolveHostname);

		const receipt = await this.#buildReceipt({
			input,
			operation: 'fetch',
			mode: useFullText ? 'full-text' : 'highlights',
			provider: 'exa',
			startedAt,
			startMs,
			status: 'succeeded',
			resultUrls: [finalUrl],
			costUsd: response.costDollars?.total ?? null,
			providerRequestId: response.requestId ?? null,
		});

		return {
			url: validatedUrl,
			finalUrl,
			title: item?.title ?? '',
			content: truncateContent(content, MAX_NORMALIZED_CONTENT_CHARS),
			publishedAt: item?.publishedDate ?? null,
			receipt,
		};
	}

	async #request(
		endpoint: string,
		body: Record<string, unknown>,
		signal: AbortSignal,
		timeoutMs: number,
	): Promise<Record<string, unknown>> {
		if (signal.aborted) {
			throw new ProviderError('Request aborted', { retryable: false, provider: 'exa' });
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		signal.addEventListener('abort', onAbort);

		try {
			const response = await this.#fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.#apiKey,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});

			const text = await response.text();
			assertResponseSize(new TextEncoder().encode(text).byteLength, MAX_RESPONSE_BYTES);

			if (!response.ok) {
				const classification = classifyHttpError(response.status);
				throw new ProviderError(`Exa request failed: ${response.status}`, {
					retryable: classification.retryable,
					statusCode: response.status,
					provider: 'exa',
					retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
				});
			}

			return JSON.parse(text) as Record<string, unknown>;
		} catch (error) {
			if (error instanceof ProviderError) throw error;
			const message = redactSecrets(
				error instanceof Error ? error.message : String(error),
				[this.#apiKey],
			);
			throw new ProviderError(message, {
				retryable: !signal.aborted,
				provider: 'exa',
				cause: error,
			});
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
		}
	}

	async #buildReceipt(params: {
		input: WebSearchInput | WebFetchInput;
		operation: 'search' | 'fetch';
		mode: ProviderCallReceipt['mode'];
		provider: 'exa';
		startedAt: string;
		startMs: number;
		status: ProviderCallReceipt['status'];
		resultUrls: string[];
		costUsd: number | null;
		providerRequestId: string | null;
		fallbackReason?: ProviderCallReceipt['fallbackReason'];
	}): Promise<ProviderCallReceipt> {
			const receiptId = await deriveReceiptId(
				params.input.callKey,
				params.input.attempt,
				params.provider,
				params.mode,
			);
		return {
			receiptId,
			callKey: params.input.callKey,
			provider: params.provider,
			providerRequestId: params.providerRequestId,
			operation: params.operation,
			mode: params.mode,
			phase: params.input.phase,
			briefId: params.input.briefId,
			market: params.input.market,
			query: 'query' in params.input ? params.input.query : null,
			requestedUrls: 'url' in params.input ? [params.input.url] : [],
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

export { isUsableExtraction, normalizeContent };
