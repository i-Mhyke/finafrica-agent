export const TERMINAL_DURABLE_SCAN_STATUSES = new Set([
	'complete',
	'completed',
	'errored',
	'terminated',
	'failed',
]);

export const SUCCESSFUL_DURABLE_SCAN_STATUSES = new Set(['complete', 'completed']);

const DEFAULT_DURABLE_SCAN_POLL_SECONDS = 600;
const DEFAULT_DURABLE_SCAN_POLL_INTERVAL_MS = 1000;

export function resolveScanMode(options = {}) {
	return options.mode ?? process.env.RESEARCH_SCAN_MODE ?? 'legacy';
}

export function resolveDurableScanPollConfig(options = {}) {
	const pollSeconds = Number(
		options.pollSeconds ??
			process.env.RESEARCH_SCAN_POLL_SECONDS ??
			DEFAULT_DURABLE_SCAN_POLL_SECONDS,
	);
	const pollIntervalMs = Number(
		options.pollIntervalMs ??
			process.env.RESEARCH_SCAN_POLL_INTERVAL_MS ??
			DEFAULT_DURABLE_SCAN_POLL_INTERVAL_MS,
	);

	if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
		throw new Error('RESEARCH_SCAN_POLL_SECONDS must be a positive number');
	}
	if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
		throw new Error('RESEARCH_SCAN_POLL_INTERVAL_MS must be a positive number');
	}

	return {
		maxAttempts: Math.ceil((pollSeconds * 1000) / pollIntervalMs),
		pollIntervalMs,
	};
}

export function isTerminalDurableScanStatus(status) {
	return TERMINAL_DURABLE_SCAN_STATUSES.has(status);
}

export function isSuccessfulDurableScanStatus(status) {
	return SUCCESSFUL_DURABLE_SCAN_STATUSES.has(status);
}

export async function invokeDurableScan(input, options = {}) {
	const baseUrl = options.baseUrl ?? process.env.RESEARCH_CONTROL_PLANE_URL ?? 'http://127.0.0.1:8788';
	const token = options.token ?? process.env.RESEARCH_ADMIN_TOKEN;
	if (!token) {
		throw new Error('RESEARCH_ADMIN_TOKEN is required for durable scan mode');
	}

	const response = await fetch(`${baseUrl}/v1/research/scans`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		throw new Error(`Durable scan admission failed: ${response.status}`);
	}
	return response.json();
}

export async function pollDurableScan(workflowInstanceId, options = {}) {
	const baseUrl = options.baseUrl ?? process.env.RESEARCH_CONTROL_PLANE_URL ?? 'http://127.0.0.1:8788';
	const token = options.token ?? process.env.RESEARCH_ADMIN_TOKEN;
	if (!token) {
		throw new Error('RESEARCH_ADMIN_TOKEN is required for durable scan mode');
	}

	const response = await fetch(`${baseUrl}/v1/research/scans/${workflowInstanceId}`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
	if (!response.ok) {
		throw new Error(`Durable scan status failed: ${response.status}`);
	}
	return response.json();
}
