import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function renderAuditMarkdown(report) {
	const lines = [];
	lines.push('# Research Run Audit');
	lines.push('');
	lines.push('## Run');
	lines.push(`- Run ID: ${report.run.runId}`);
	lines.push(`- Run key: ${report.run.runKey}`);
	lines.push(`- Status: ${report.run.status}`);
	lines.push(`- Started: ${report.run.startedAt ?? 'unknown'}`);
	lines.push(`- Ended: ${report.run.endedAt ?? 'in progress'}`);
	lines.push(`- Duration: ${formatMs(report.run.durationMs)}`);
	lines.push('');
	lines.push('## Usage');
	lines.push(
		`- Model: ${report.efficiency.model.inputTokens.toLocaleString()} in / ${report.efficiency.model.outputTokens.toLocaleString()} out, $${report.efficiency.model.costUsd.toFixed(4)}`,
	);
	lines.push(
		`- Provider admitted: $${report.efficiency.provider.admittedEstimateUsd.toFixed(4)}`,
	);
	lines.push(
		`- Provider reported: $${report.efficiency.provider.reportedCostUsd.toFixed(4)} (${report.efficiency.provider.unpricedCalls} unpriced)`,
	);
	if (report.run.limits?.maxProviderRequests != null) {
		lines.push(
			`- Provider requests: ${report.efficiency.provider.attemptCount} / ${report.run.limits.maxProviderRequests}`,
		);
	}
	lines.push(
		`- Provider admission rejections: ${report.efficiency.provider.requestRejectionCount ?? 0}`,
	);
	lines.push('');
	lines.push('## Tools');
	for (const tool of report.efficiency.tools) {
		const statuses = Object.entries(tool.statusCounts ?? {})
			.map(([status, count]) => `${status}=${count}`)
			.join(', ');
		lines.push(
			`- ${tool.toolName}: ${tool.callCount} calls, ${tool.blockedCount ?? 0} blocked${statuses ? ` (${statuses})` : ''}`,
		);
	}
	lines.push('');
	lines.push('## Stages');
	for (const stage of report.stages) {
		lines.push(
			`- ${stage.phase} [${stage.status}] ${formatMs(stage.durationMs)} ${stage.briefId ? `brief=${stage.briefId}` : ''} ${stage.market ? `market=${stage.market}` : ''}`.trim(),
		);
	}
	lines.push('');
	lines.push('## Outcomes');
	lines.push(`- Discovered: ${report.efficiency.outcomes.discovered}`);
	lines.push(`- Accepted: ${report.efficiency.outcomes.accepted}`);
	lines.push(`- Passed: ${report.efficiency.outcomes.passed}`);
	lines.push(`- Known total cost: $${report.efficiency.outcomes.knownTotalCostUsd.toFixed(4)}`);
	if (report.efficiency.outcomes.costPerAcceptedBrief != null) {
		lines.push(
			`- Cost per accepted brief: $${report.efficiency.outcomes.costPerAcceptedBrief.toFixed(4)}`,
		);
	}
	lines.push('');
	lines.push('## Decisions');
	for (const decision of report.decisions) {
		lines.push(`- ${decision.kind}: ${decision.decision} (${decision.briefId ?? 'run'})`);
	}
	lines.push('');
	if (report.bottlenecks.length > 0) {
		lines.push('## Bottlenecks');
		for (const bottleneck of report.bottlenecks) {
			lines.push(`- ${bottleneck.phase}: ${formatMs(bottleneck.durationMs)}`);
		}
		lines.push('');
	}
	lines.push('## Artifacts');
	lines.push(`- Sources: ${report.artifacts.sourceCount}`);
	lines.push(`- Evidence: ${report.artifacts.evidenceCount}`);
	lines.push(`- Claims: ${report.artifacts.claimCount}`);
	lines.push('');
	lines.push('## Notes');
	lines.push('- Compact audit export excludes prompts, thinking, tool results, and fetched content.');
	if (report.warnings.length > 0) {
		lines.push(`- Warnings: ${report.warnings.length}`);
	}
	return `${lines.join('\n')}\n`;
}

function formatMs(durationMs) {
	if (durationMs == null) return 'n/a';
	if (durationMs < 1000) return `${durationMs}ms`;
	const seconds = durationMs / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const rem = Math.round(seconds % 60);
	return `${minutes}m ${rem}s`;
}

export function stripGeneratedAt(report) {
	const { generatedAt, ...rest } = report;
	void generatedAt;
	return rest;
}

export function validateRunKeySegment(runKey) {
	if (!/^[A-Za-z0-9._-]+$/.test(runKey)) {
		throw new Error('Invalid run key segment for output path');
	}
}

export function resolveSafeOutputDir(requestedDir, runKey) {
	validateRunKeySegment(runKey);
	const base = resolve(requestedDir);
	const resolved = resolve(requestedDir, runKey);
	if (resolved !== base && !resolved.startsWith(`${base}/`)) {
		throw new Error('Output path escapes requested directory');
	}
	return resolved;
}

export function resolveSafeRunOutputDir(requestedDir, runKey, runId) {
	validateRunKeySegment(runKey);
	if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
		throw new Error('Invalid run ID segment for output path');
	}
	const runKeyDir = resolveSafeOutputDir(requestedDir, runKey);
	const resolved = resolve(runKeyDir, runId);
	if (!resolved.startsWith(`${runKeyDir}/`)) {
		throw new Error('Output path escapes run key directory');
	}
	return resolved;
}

export function writeAuditArtifacts(targetDir, report) {
	const jsonPath = resolve(targetDir, 'audit.json');
	const mdPath = resolve(targetDir, 'audit.md');
	const jsonTemp = `${jsonPath}.tmp`;
	const mdTemp = `${mdPath}.tmp`;
	writeFileSync(jsonTemp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	writeFileSync(mdTemp, renderAuditMarkdown(report), 'utf8');
	renameSync(jsonTemp, jsonPath);
	renameSync(mdTemp, mdPath);
	return { jsonPath, mdPath };
}
