import type { Market, ProviderCallReceipt, SourceTier } from '../../research/schemas';

export type FetchMode = 'highlights' | 'full-text' | 'raw-http' | 'browser-playwright';

export interface WebSearchInput {
	query: string;
	market: Market;
	tier: SourceTier;
	domains: string[];
	startDate: string;
	endDate: string;
	maxResults: number;
	phase: ProviderCallReceipt['phase'];
	briefId: string | null;
	callKey: string;
	attempt: number;
}

export interface WebFetchInput {
	url: string;
	market: Market;
	tier: SourceTier;
	mode: FetchMode;
	evidenceQuestion: string;
	maxCharacters: number;
	phase: ProviderCallReceipt['phase'];
	briefId: string | null;
	callKey: string;
	attempt: number;
}

export interface WebSearchResult {
	url: string;
	title: string;
	publishedAt: string | null;
	highlights: string[];
	snippet: string | null;
}

export interface WebSearchResponse {
	results: WebSearchResult[];
	receipt: ProviderCallReceipt;
}

export interface WebFetchResponse {
	url: string;
	finalUrl: string;
	title: string;
	content: string;
	publishedAt: string | null;
	receipt: ProviderCallReceipt;
}

export interface WebResearchProvider {
	search(input: WebSearchInput, signal: AbortSignal): Promise<WebSearchResponse>;
	fetch(input: WebFetchInput, signal: AbortSignal): Promise<WebFetchResponse>;
}

export interface WebExtractionProvider {
	fetch(input: WebFetchInput, signal: AbortSignal): Promise<WebFetchResponse>;
}

export const ADMISSION_ESTIMATES_USD = {
	'exa-search': 0.02,
	'exa-contents': 0.02,
	'apify-raw-http': 0.03,
	'apify-playwright': 0.08,
} as const;

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_NORMALIZED_CONTENT_CHARS = 60_000;
export const MAX_EVIDENCE_EXCERPT_CHARS = 4_000;
export const EXA_SEARCH_TIMEOUT_MS = 15_000;
export const EXA_CONTENTS_TIMEOUT_MS = 30_000;
export const APIFY_RAW_HTTP_TIMEOUT_MS = 90_000;
export const APIFY_PLAYWRIGHT_TIMEOUT_MS = 120_000;
