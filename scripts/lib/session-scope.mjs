/** @param {string | null | undefined} session */
export function sessionPhase(session) {
	if (!session) return 'unknown';
	if (
		session === 'discovery' ||
		session.startsWith('discovery:') ||
		session.startsWith('task:discovery:')
	) {
		return 'discovery';
	}
	if (session.startsWith('brief-validator:')) return 'brief-validation';
	if (session.startsWith('brief-refiner:')) return 'brief-refinement';
	if (session.includes(':region:')) {
		if (session.endsWith(':remediation')) return 'remediation';
		if (session.endsWith(':deep-research')) return 'deep-research';
		return 'deep-research';
	}
	if (session.includes('structural-analyst')) return 'structural-analysis';
	if (session.includes('reviewer')) return 'review';
	return 'article';
}

/** @param {string | null | undefined} session */
export function scopeFromSession(session) {
	if (!session) return { briefId: null, market: null };
	const discoveryMatch = session.match(
		/^(?:task:)?discovery:(nigeria|kenya|ghana|south-africa|egypt)(?::|$)/,
	);
	if (discoveryMatch) {
		return { briefId: null, market: discoveryMatch[1] };
	}
	if (session.startsWith('brief-validator:')) {
		return { briefId: session.slice('brief-validator:'.length), market: null };
	}
	if (session.startsWith('brief-refiner:')) {
		return { briefId: session.slice('brief-refiner:'.length), market: null };
	}
	const regionMatch = session.match(
		/^article:([^:]+):region:([^:]+)(?::(deep-research|remediation))?$/,
	);
	if (regionMatch) {
		return { briefId: regionMatch[1], market: regionMatch[2] };
	}
	const articleMatch = session.match(/^article:([^:]+):(structural-analyst|reviewer)$/);
	if (articleMatch) {
		return { briefId: articleMatch[1], market: null };
	}
	return { briefId: null, market: null };
}

/**
 * @param {string | null | undefined} session
 * @param {string | null | undefined} parentSession
 * @param {Map<string, Record<string, unknown>> | undefined} sessionScopes
 */
export function enrichTurnScope(session, parentSession, sessionScopes) {
	const fromChild = session ? sessionScopes?.get(session) : null;
	const fromParent = parentSession ? sessionScopes?.get(parentSession) : null;
	const parsedChild = scopeFromSession(session);
	const parsedParent = scopeFromSession(parentSession);
	return {
		agent: fromChild?.agent ?? fromParent?.agent ?? null,
		briefId: fromChild?.briefId ?? fromParent?.briefId ?? parsedChild.briefId ?? parsedParent.briefId,
		market: fromChild?.market ?? fromParent?.market ?? parsedChild.market ?? parsedParent.market,
		phase:
			fromChild?.phase ??
			fromParent?.phase ??
			(session ? sessionPhase(session) : parentSession ? sessionPhase(parentSession) : 'unknown'),
		modelRole: fromChild?.modelRole ?? fromParent?.modelRole ?? null,
		modelId: fromChild?.modelId ?? fromParent?.modelId ?? null,
	};
}

/** @param {Record<string, unknown> | null | undefined} request */
export function resolveTurnModelId(request) {
	const modelId = request?.requestedModel ?? request?.modelId ?? null;
	if (!modelId) return null;
	const provider = request?.providerId ?? request?.providerName ?? null;
	return provider && !String(modelId).includes('/')
		? `${provider}/${modelId}`
		: String(modelId);
}
