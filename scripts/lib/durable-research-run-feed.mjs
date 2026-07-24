export function resolveScanMode(options = {}) {
	return options.mode ?? process.env.RESEARCH_SCAN_MODE ?? 'legacy';
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
