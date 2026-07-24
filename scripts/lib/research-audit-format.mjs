import { RUN_FEED_STATES } from './research-run-feed.mjs';
import { sessionPhase } from './session-scope.mjs';

function formatDuration(ms) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const rem = seconds % 60;
	return `${minutes}m ${rem}s`;
}

function formatClock(isoOrMs) {
	const value = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(String(isoOrMs));
	if (!Number.isFinite(value)) return 'n/a';
	return new Date(value).toISOString().slice(11, 19);
}

function liveScope(report) {
	const activeTurn = report.activeTurns?.at(-1);
	if (activeTurn) {
		return [activeTurn.phase, activeTurn.agent, activeTurn.modelId ?? activeTurn.modelRole]
			.filter(Boolean)
			.join('/');
	}
	if (report.currentStage) {
		return [report.currentStage.phase, report.currentStage.agent, report.currentStage.modelId ?? report.currentStage.modelRole]
			.filter(Boolean)
			.join('/');
	}
	return report.run.status;
}

function totalsLine(report) {
	const model = report.efficiency.model;
	const provider = report.efficiency.provider;
	const tokenTotal = model.inputTokens + model.outputTokens;
	return `LLM $${model.costUsd.toFixed(4)} | Provider $${provider.reportedCostUsd.toFixed(4)} known | ${tokenTotal.toLocaleString()} tokens | ${report.efficiency.provider.attemptCount} provider attempts`;
}

function titleCaseMarket(market) {
	if (!market) return 'n/a';
	return market
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export function formatArticleReadinessLine(article) {
	const markets =
		article?.markets?.length > 0
			? article.markets.map(titleCaseMarket).join(', ')
			: 'n/a';
	const status = article?.outcomeStatus ?? 'n/a';
	const satisfied = article?.satisfied ?? 0;
	const total = article?.total ?? 0;
	const remediation = article?.remediationPasses ?? 0;
	const analysis =
		(article?.analysisCalls ?? 0) === 0
			? 'analysis skipped'
			: `analysis ${article.analysisCalls}`;
	return `${markets} article | ${status} | readiness ${satisfied}/${total} | remediation ${remediation} | ${analysis}`;
}

export function formatLiveLine(event, report) {
	const time = new Date(event.timestamp).toISOString().slice(11, 19);
	if (event.kind === 'turn_start') {
		const scope = [event.phase, event.agent, event.modelId ?? event.modelRole]
			.filter(Boolean)
			.join(' / ');
		return `${time}  TURN+  ${scope}`;
	}
	if (event.kind === 'turn') {
		const scope = event.phase ?? sessionPhase(event.session);
		return `${time}  TURN   ${String(scope).padEnd(18)}  ${event.modelId ?? 'unknown'}  ${event.inputTokens?.toLocaleString()} in / ${event.outputTokens} out  $${Number(event.costUsd ?? 0).toFixed(4)}  ${((event.durationMs ?? 0) / 1000).toFixed(1)}s`;
	}
	if (event.kind === 'tool') {
		const status = event.status && event.status !== 'ok' ? `  ${event.status}` : '';
		return `${time}  TOOL   ${event.toolName.padEnd(18)}  ${event.session ?? ''}  ${((event.durationMs ?? 0) / 1000).toFixed(1)}s${status}`;
	}
	if (event.kind === 'audit' && event.auditEvent?.startsWith('provider_attempt_')) {
		const state = event.auditEvent.replace('provider_attempt_', '');
		const cost =
			state === 'started'
				? `admitted $${Number(event.admittedEstimateUsd ?? 0).toFixed(4)}`
				: event.reportedCostUsd != null
					? `$${event.reportedCostUsd.toFixed(4)}`
					: 'unpriced';
		return `${time}  ${String(event.provider ?? 'PROV').toUpperCase().padEnd(5)}  ${state}  ${event.market ?? ''}  ${cost}`;
	}
	if (event.kind === 'audit' && event.auditEvent === 'budget_admission_rejected') {
		return `${time}  BUDGET  rejected  ${event.provider ?? ''} ${event.market ?? ''}  requested $${Number(event.admittedEstimateUsd ?? 0).toFixed(4)}`;
	}
	if (event.kind === 'audit' && event.auditEvent === 'provider_admission_rejected') {
		return `${time}  LIMIT   rejected  ${event.provider ?? ''} ${event.market ?? ''}  provider request ceiling reached`;
	}
	if (event.kind === 'audit' && event.auditEvent === 'stage_started') {
		return `${time}  START  ${event.phase.padEnd(18)}  ${event.agent ?? ''}  ${event.modelId ?? event.modelRole ?? ''}`;
	}
	if (event.kind === 'audit' && event.auditEvent === 'stage_completed') {
		const countSummary = event.counts?.briefs != null ? `${event.counts.briefs} briefs` : '';
		const stage = report?.stages?.find((candidate) => candidate.stageId === event.stageId);
		return `${time}  END    ${event.phase.padEnd(18)}  ${countSummary}  ${((stage?.durationMs ?? event.durationMs ?? 0) / 1000).toFixed(1)}s`;
	}
	if (
		event.kind === 'audit' &&
		event.auditEvent === 'decision_recorded' &&
		(event.decision === 'passed' ||
			event.decision === 'blocked' ||
			event.decision === 'needs-more-research' ||
			event.decision === 'failed' ||
			event.decision === 'rejected')
	) {
		const kind = event.auditId?.split(':')[2];
		if (kind === 'evidence-readiness' || kind === 'article-outcome') {
			const article = report?.readiness?.byArticle?.[event.briefId];
			if (article) return `${time}  READY  ${formatArticleReadinessLine(article)}`;
		}
	}
	return null;
}

export function formatWatcherStatus({
	state,
	runId,
	report,
	lastEventAt,
	now = Date.now(),
	errorClass = null,
	engineStatus = null,
}) {
	const elapsed =
		report?.run?.durationMs != null
			? formatDuration(report.run.durationMs)
			: report?.run?.startedAt
				? formatDuration(now - Date.parse(report.run.startedAt))
				: 'n/a';

	if (state === RUN_FEED_STATES.CONNECTING) {
		return `Connecting: ${runId}`;
	}
	if (state === RUN_FEED_STATES.CATCHING_UP) {
		return 'Catch-up: loading persisted events';
	}
	if (state === RUN_FEED_STATES.LIVE && report) {
		return `Live: ${liveScope(report)} | ${totalsLine(report)} | ${elapsed}`;
	}
	if (state === RUN_FEED_STATES.STALE && lastEventAt) {
		return `Stale: connected; no persisted event for ${formatDuration(now - Date.parse(lastEventAt))} | ${report ? totalsLine(report) : ''}`;
	}
	if (state === RUN_FEED_STATES.DISCONNECTED) {
		return lastEventAt
			? `Disconnected: run server unreachable; last confirmed event ${formatClock(lastEventAt)}`
			: 'Disconnected: run server unreachable';
	}
	if (state === RUN_FEED_STATES.TERMINAL && report) {
		const researchStatus = report.run.status;
		if (engineStatus === 'errored') {
			return `Errored: ${errorClass ?? 'run_failed'} | ${totalsLine(report)} | ${elapsed}`;
		}
		return `Completed: ${researchStatus} | ${totalsLine(report)} | ${elapsed}`;
	}
	return null;
}

export function formatCatchupSummary(report, lastEventAt) {
	return `Catch-up complete | status ${report.run.status} | stage ${report.currentStage?.phase ?? 'n/a'} | ${totalsLine(report)} | last event ${formatClock(lastEventAt)}`;
}

export function formatWatcherStateJson(payload) {
	const record = {
		kind: 'watcher_state',
		state: payload.state,
		runId: payload.runId,
	};
	if (payload.lastEventAt) record.lastEventAt = payload.lastEventAt;
	if (payload.errorClass) record.errorClass = payload.errorClass;
	if (payload.engineStatus) record.engineStatus = payload.engineStatus;
	return JSON.stringify(record);
}
