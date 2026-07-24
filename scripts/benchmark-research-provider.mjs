#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const fixturesDir = join(root, 'tests/fixtures/research');
const reportsDir = process.env.BENCHMARK_REPORTS_DIR || join(root, 'docs/evals');
const exaApiKey = process.env.EXA_API_KEY || '';
const apifyToken = process.env.APIFY_API_TOKEN || '';
const maxObservedCostUsd = Number(process.env.BENCHMARK_MAX_COST_USD || '2');
let reservedCostUsd = 0;

const discoveryCases = JSON.parse(
	readFileSync(join(fixturesDir, 'provider-benchmark.json'), 'utf8'),
);
const extractionCases = JSON.parse(
	readFileSync(join(fixturesDir, 'extraction-benchmark.json'), 'utf8'),
);

const gates = {
	exaDiscoveryRecall: 0.8,
	exaExtractionAttribution: 0.9,
	apifyFallbackRecovery: 0.2,
	apifyAttribution: 0.9,
	apifyP95CostUsd: 0.08,
};

async function main() {
	mkdirSync(reportsDir, { recursive: true });
	const report = {
		date: new Date().toISOString().slice(0, 10),
		discoveryCases: discoveryCases.length,
		extractionCases: extractionCases.length,
		exaApiKeyPresent: Boolean(exaApiKey),
		apifyTokenPresent: Boolean(apifyToken),
		discoveryResults: [],
		extractionResults: [],
		metrics: {
			exaDiscoveryRecallByMarket: null,
			exaExtractionAttribution: null,
			apifyFallbackRecovery: null,
			apifyAttribution: null,
			apifyP50CostUsd: null,
			apifyP95CostUsd: null,
			unpricedCalls: 0,
			observedCostUsd: 0,
		},
		gates: {},
		promotionPassed: false,
	};

	if (exaApiKey) {
		for (const benchmarkCase of discoveryCases) {
			reserveEstimatedCost(0.01);
			const result = await benchmarkExaDiscovery(benchmarkCase);
			report.discoveryResults.push(result);
			report.metrics.observedCostUsd += result.costUsd ?? 0;
			enforceCostLimit(report.metrics.observedCostUsd);
			if (result.costUsd === null) report.metrics.unpricedCalls++;
		}
		for (const benchmarkCase of extractionCases) {
			reserveEstimatedCost(0.01);
			const result = await benchmarkExtractionCase(benchmarkCase);
			report.extractionResults.push(result);
			report.metrics.observedCostUsd += result.exa.costUsd ?? 0;
			if (result.exa.costUsd === null) report.metrics.unpricedCalls++;
			for (const attempt of result.apifyAttempts) {
				report.metrics.observedCostUsd += attempt.costUsd ?? 0;
				if (attempt.costUsd === null) report.metrics.unpricedCalls++;
			}
			enforceCostLimit(report.metrics.observedCostUsd);
		}
	}

	computeMetrics(report);
	evaluateGates(report);
	writeReports(report);
	process.exitCode = report.promotionPassed ? 0 : 1;
}

async function benchmarkExaDiscovery(benchmarkCase) {
	const startedAt = Date.now();
	try {
		const response = await requestJson(
			'https://api.exa.ai/search',
			{
				query: benchmarkCase.query,
				type: 'auto',
				numResults: 10,
				startPublishedDate: benchmarkCase.freshnessWindow.start,
				endPublishedDate: benchmarkCase.freshnessWindow.end,
				contents: { highlights: { maxCharacters: 1200 } },
			},
			{ 'x-api-key': exaApiKey },
			15_000,
		);
		const expectedDomains = [
			...benchmarkCase.expectedPrimaryDomains,
			...benchmarkCase.acceptableSecondaryDomains,
		];
		const urls = (response.results ?? []).map((item) => item.url).filter(Boolean);
		return {
			id: benchmarkCase.id,
			market: benchmarkCase.market,
			hit: urls.some((url) => expectedDomains.some((domain) => matchesDomain(url, domain))),
			resultCount: urls.length,
			costUsd: response.costDollars?.total ?? null,
			latencyMs: Date.now() - startedAt,
			error: null,
		};
	} catch (error) {
		return failedMetric(benchmarkCase, startedAt, error);
	}
}

async function benchmarkExtractionCase(benchmarkCase) {
	const exa = await benchmarkExaExtraction(benchmarkCase);
	const apifyAttempts = [];
	if (!exa.attributable && apifyToken) {
		const raw = await benchmarkApifyExtraction(benchmarkCase, 'raw-http');
		apifyAttempts.push(raw);
		if (!raw.attributable) {
			apifyAttempts.push(
				await benchmarkApifyExtraction(benchmarkCase, 'browser-playwright'),
			);
		}
	}
	return { id: benchmarkCase.id, market: benchmarkCase.market, exa, apifyAttempts };
}

async function benchmarkExaExtraction(benchmarkCase) {
	const startedAt = Date.now();
	try {
		const response = await requestJson(
			'https://api.exa.ai/contents',
			{
				urls: [benchmarkCase.url],
				text: { maxCharacters: 12_000 },
			},
			{ 'x-api-key': exaApiKey },
			30_000,
		);
		const item = response.results?.[0] ?? {};
		const content = String(item.text || '');
		return extractionMetric(
			benchmarkCase,
			'exa',
			'full-text',
			content,
			response.costDollars?.total ?? null,
			Date.now() - startedAt,
			null,
		);
	} catch (error) {
		return extractionMetric(
			benchmarkCase,
			'exa',
			'full-text',
			'',
			null,
			Date.now() - startedAt,
			safeError(error),
		);
	}
}

async function benchmarkApifyExtraction(benchmarkCase, mode) {
	reserveEstimatedCost(0.08);
	const startedAt = Date.now();
	let runId = null;
	try {
		const start = await requestJson(
			'https://api.apify.com/v2/acts/apify~rag-web-browser/runs',
			{
				query: benchmarkCase.url,
				outputFormats: ['markdown'],
				scrapingTool: mode,
				requestTimeoutSecs: mode === 'raw-http' ? 40 : 60,
				maxRequestRetries: 1,
				dynamicContentWaitSecs: mode === 'raw-http' ? 0 : 10,
				removeCookieWarnings: false,
				debugMode: false,
			},
			{ Authorization: `Bearer ${apifyToken}` },
			15_000,
		);
		runId = start.data?.id ?? null;
		if (!runId) throw new Error('Apify start returned no run ID');
		const run = await pollApifyRun(runId);
		const datasetId = run.data?.defaultDatasetId;
		if (!datasetId) throw new Error('Apify run returned no dataset ID');
		const items = await requestJson(
			`https://api.apify.com/v2/datasets/${datasetId}/items`,
			null,
			{ Authorization: `Bearer ${apifyToken}` },
			30_000,
			'GET',
		);
		const content = String(items?.[0]?.markdown || '');
		return extractionMetric(
			benchmarkCase,
			'apify',
			mode,
			content,
			run.data?.usageTotalUsd ?? null,
			Date.now() - startedAt,
			null,
		);
	} catch (error) {
		return extractionMetric(
			benchmarkCase,
			'apify',
			mode,
			'',
			null,
			Date.now() - startedAt,
			safeError(error),
			runId,
		);
	}
}

async function pollApifyRun(runId) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const run = await requestJson(
			`https://api.apify.com/v2/actor-runs/${runId}`,
			null,
			{ Authorization: `Bearer ${apifyToken}` },
			15_000,
			'GET',
		);
		const status = run.data?.status;
		if (status === 'SUCCEEDED') return run;
		if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
			throw new Error(`Apify run ${status}`);
		}
		await delay(1000);
	}
	throw new Error('Apify benchmark poll timed out');
}

function extractionMetric(
	benchmarkCase,
	provider,
	mode,
	content,
	costUsd,
	latencyMs,
	error,
	runId = null,
) {
	const normalized = content.toLowerCase();
	const markerMatched = benchmarkCase.expectedMarkers.some((marker) =>
		normalized.includes(String(marker).toLowerCase()),
	);
	return {
		provider,
		mode,
		attributable:
			benchmarkCase.acceptableModes.includes(mode) &&
			content.length >= benchmarkCase.minAttributableChars &&
			markerMatched,
		characterCount: content.length,
		markerMatched,
		costUsd,
		latencyMs,
		runId,
		error,
	};
}

function computeMetrics(report) {
	if (report.discoveryResults.length > 0) {
		const byMarket = {};
		for (const result of report.discoveryResults) {
			const market = byMarket[result.market] ?? { hits: 0, total: 0 };
			market.total++;
			if (result.hit) market.hits++;
			byMarket[result.market] = market;
		}
		report.metrics.exaDiscoveryRecallByMarket = Object.fromEntries(
			Object.entries(byMarket).map(([market, value]) => [
				market,
				value.total === 0 ? 0 : value.hits / value.total,
			]),
		);
	}

	if (report.extractionResults.length > 0) {
		report.metrics.exaExtractionAttribution =
			report.extractionResults.filter((result) => result.exa.attributable).length /
			report.extractionResults.length;
		const fallbackCases = report.extractionResults.filter(
			(result) => !result.exa.attributable,
		);
		const apifyAttempts = fallbackCases.flatMap((result) => result.apifyAttempts);
		if (fallbackCases.length >= 5 && apifyAttempts.length > 0) {
			const recovered = fallbackCases.filter((result) =>
				result.apifyAttempts.some((attempt) => attempt.attributable),
			).length;
			report.metrics.apifyFallbackRecovery = recovered / fallbackCases.length;
			report.metrics.apifyAttribution =
				apifyAttempts.filter((attempt) => attempt.attributable).length /
				apifyAttempts.length;
			const costs = apifyAttempts
				.map((attempt) => attempt.costUsd)
				.filter((cost) => typeof cost === 'number')
				.sort((a, b) => a - b);
			report.metrics.apifyP50CostUsd = percentile(costs, 0.5);
			report.metrics.apifyP95CostUsd = percentile(costs, 0.95);
		}
	}
}

function evaluateGates(report) {
	const recallValues = Object.values(
		report.metrics.exaDiscoveryRecallByMarket ?? {},
	);
	const discoveryPassed =
		recallValues.length === 5 &&
		recallValues.every((value) => value >= gates.exaDiscoveryRecall);
	const extractionPassed =
		typeof report.metrics.exaExtractionAttribution === 'number' &&
		report.metrics.exaExtractionAttribution >= gates.exaExtractionAttribution;
	const fallbackCases = report.extractionResults.filter(
		(result) => !result.exa.attributable,
	).length;
	const apifyRequired = fallbackCases >= 5;
	const apifyPassed =
		!apifyRequired ||
		(typeof report.metrics.apifyFallbackRecovery === 'number' &&
			report.metrics.apifyFallbackRecovery >= gates.apifyFallbackRecovery &&
			report.metrics.apifyAttribution >= gates.apifyAttribution &&
			report.metrics.apifyP95CostUsd <= gates.apifyP95CostUsd);

	report.gates = {
		exaDiscovery: discoveryPassed ? 'pass' : 'fail',
		exaExtraction: extractionPassed ? 'pass' : 'fail',
		apifyFallback: !apifyRequired
			? 'insufficient fallback cases'
			: apifyPassed
				? 'pass'
				: 'fail',
	};
	report.promotionPassed = discoveryPassed && extractionPassed && apifyPassed;
}

function writeReports(report) {
	const machinePath = join(reportsDir, 'research-provider-baseline.json');
	const datedMachinePath = join(
		reportsDir,
		`research-provider-baseline-${report.date}.json`,
	);
	writeFileSync(machinePath, JSON.stringify(report, null, 2));
	writeFileSync(datedMachinePath, JSON.stringify(report, null, 2));
	writeFileSync(
		join(reportsDir, 'research-provider-baseline.md'),
		renderMarkdown(report),
	);
	console.log(`Benchmark report written to ${machinePath}`);
}

function renderMarkdown(report) {
	return `# Research Provider Baseline — ${report.date}

## Fixture Coverage
- Discovery cases: ${report.discoveryCases}
- Extraction cases: ${report.extractionCases}

## Metrics
- Exa discovery recall by market: ${formatMetric(report.metrics.exaDiscoveryRecallByMarket)}
- Exa extraction attribution: ${formatMetric(report.metrics.exaExtractionAttribution)}
- Apify fallback recovery: ${formatMetric(report.metrics.apifyFallbackRecovery)}
- Apify attribution: ${formatMetric(report.metrics.apifyAttribution)}
- Apify p50 cost: ${formatMetric(report.metrics.apifyP50CostUsd)}
- Apify p95 cost: ${formatMetric(report.metrics.apifyP95CostUsd)}
- Unpriced calls: ${report.metrics.unpricedCalls}
- Observed provider cost: $${report.metrics.observedCostUsd.toFixed(4)}

## Promotion Gates
- Exa discovery: ${report.gates.exaDiscovery}
- Exa extraction: ${report.gates.exaExtraction}
- Apify fallback: ${report.gates.apifyFallback}
- Overall promotion: ${report.promotionPassed ? 'pass' : 'blocked'}

## Routing Decision
- Exa remains the only runtime search provider.
- Apify remains extraction-only and disabled until its required gate passes.
`;
}

async function requestJson(
	url,
	body,
	headers,
	timeoutMs,
	method = 'POST',
) {
	const response = await fetch(url, {
		method,
		headers: {
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...headers,
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Provider request failed: ${response.status}`);
	return JSON.parse(text);
}

function failedMetric(benchmarkCase, startedAt, error) {
	return {
		id: benchmarkCase.id,
		market: benchmarkCase.market,
		hit: false,
		resultCount: 0,
		costUsd: null,
		latencyMs: Date.now() - startedAt,
		error: safeError(error),
	};
}

function matchesDomain(url, domain) {
	try {
		const hostname = new URL(url).hostname.replace(/^www\./, '');
		return hostname === domain || hostname.endsWith(`.${domain}`);
	} catch {
		return false;
	}
}

function percentile(values, fraction) {
	if (values.length === 0) return null;
	return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

function formatMetric(value) {
	return value === null ? 'not measured' : JSON.stringify(value);
}

function safeError(error) {
	return error instanceof Error ? error.message : String(error);
}

function enforceCostLimit(observedCostUsd) {
	if (observedCostUsd > maxObservedCostUsd) {
		throw new Error(`Benchmark observed cost exceeded $${maxObservedCostUsd}`);
	}
}

function reserveEstimatedCost(estimateUsd) {
	if (reservedCostUsd + estimateUsd > maxObservedCostUsd) {
		throw new Error(`Benchmark admission estimate exceeds $${maxObservedCostUsd}`);
	}
	reservedCostUsd += estimateUsd;
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
	console.error(safeError(error));
	process.exitCode = 1;
});
