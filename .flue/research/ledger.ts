import type { WebFetchInput, WebFetchResponse } from '../providers/web-research/provider';
import { classifySource } from './market-policy';
import {
	deriveContentHash,
	deriveEvidenceId,
	deriveSourceId,
	normalizeCanonicalUrl,
} from './ids';
import type {
	ArticleRegionResearchResult,
	ClaimCandidate,
	DiscoveryPortfolio,
	EvidenceExcerpt,
	MarketDiscoveryAgentResult,
	MarketDiscoveryResult,
	ProviderCallReceipt,
	SourceRecord,
} from './schemas';

export interface ResearchArtifact {
	source: SourceRecord;
	evidence: EvidenceExcerpt;
}

function scopeKey(input: {
	phase: string;
	briefId: string | null;
	market: string;
}): string {
	return `${input.phase}:${input.briefId ?? 'discovery'}:${input.market}`;
}

export class ResearchArtifactLedger {
	readonly #artifacts = new Map<string, Map<string, ResearchArtifact>>();

	async recordFetch(
		input: WebFetchInput,
		response: WebFetchResponse,
		retrievedAt: string,
	): Promise<ResearchArtifact> {
		const canonicalUrl = normalizeCanonicalUrl(response.finalUrl);
		const sourceId = await deriveSourceId(canonicalUrl);
		const excerpt = response.content.slice(0, input.maxCharacters);
		const evidenceId = await deriveEvidenceId(sourceId, excerpt);
		const classification = classifySource(canonicalUrl, input.market);
		const source: SourceRecord = {
			sourceId,
			canonicalUrl,
			title: response.title,
			publisher: null,
			author: null,
			publishedAt: response.publishedAt,
			retrievedAt,
			market: input.market,
			tier: classification.tier,
			sourceType: classification.sourceType,
			receiptIds: [response.receipt.receiptId],
			contentHash: await deriveContentHash(response.content),
			rightsNote: 'Bounded excerpt retained for research provenance',
		};
		const evidence: EvidenceExcerpt = {
			evidenceId,
			sourceId,
			text: excerpt,
			supports: [],
			capturedAt: retrievedAt,
		};
		const key = scopeKey(input);
		const scoped = this.#artifacts.get(key) ?? new Map<string, ResearchArtifact>();
		const previous = scoped.get(sourceId);
		scoped.set(sourceId, previous ? mergeArtifact(previous, { source, evidence }) : { source, evidence });
		this.#artifacts.set(key, scoped);
		return { source, evidence };
	}

	artifactsFor(scope: {
		phase: string;
		briefId: string | null;
		market: string;
	}): ResearchArtifact[] {
		return [...(this.#artifacts.get(scopeKey(scope))?.values() ?? [])].sort((a, b) =>
			a.source.sourceId.localeCompare(b.source.sourceId),
		);
	}

	artifactsForBrief(briefId: string): ResearchArtifact[] {
		const artifacts: ResearchArtifact[] = [];
		for (const [key, scoped] of this.#artifacts) {
			if (key.includes(`:${briefId}:`)) artifacts.push(...scoped.values());
		}
		return deduplicateArtifacts(artifacts);
	}

	discoveryArtifacts(): ResearchArtifact[] {
		const artifacts: ResearchArtifact[] = [];
		for (const [key, scoped] of this.#artifacts) {
			if (key.startsWith('discovery:')) artifacts.push(...scoped.values());
		}
		return deduplicateArtifacts(artifacts);
	}
}

export function reconcileDiscoveryWithLedger(
	portfolio: DiscoveryPortfolio,
	ledger: ResearchArtifactLedger,
	receipts: ProviderCallReceipt[],
): DiscoveryPortfolio {
	const artifacts = ledger.discoveryArtifacts();
	const sourceIds = new Set(artifacts.map((artifact) => artifact.source.sourceId));
	const evidenceIds = new Set(artifacts.map((artifact) => artifact.evidence.evidenceId));

	for (const brief of portfolio.briefs) {
		if (
			brief.discoverySourceIds.some((id) => !sourceIds.has(id)) ||
			brief.discoveryEvidenceIds.some((id) => !evidenceIds.has(id))
		) {
			throw new Error(`Discovery brief ${brief.briefId} references unrecorded provenance`);
		}
	}

	return {
		...portfolio,
		receipts: receipts.filter((receipt) => receipt.phase === 'discovery'),
		sources: artifacts.map((artifact) => artifact.source),
		evidence: artifacts.map((artifact) => artifact.evidence),
		coverage: portfolio.coverage.map((coverage) => ({
			...coverage,
			sourceIds: coverage.sourceIds.filter((id) => sourceIds.has(id)),
		})),
	};
}

export function reconcileMarketDiscoveryWithLedger(
	result: MarketDiscoveryAgentResult,
	ledger: ResearchArtifactLedger,
	receipts: ProviderCallReceipt[],
): MarketDiscoveryResult {
	const artifacts = ledger.artifactsFor({
		phase: 'discovery',
		briefId: null,
		market: result.market,
	});
	const sourceIds = new Set(artifacts.map((artifact) => artifact.source.sourceId));
	const evidenceIds = new Set(
		artifacts.map((artifact) => artifact.evidence.evidenceId),
	);

	for (const brief of result.briefs) {
		if (
			brief.discoverySourceIds.some((id) => !sourceIds.has(id)) ||
			brief.discoveryEvidenceIds.some((id) => !evidenceIds.has(id))
		) {
			throw new Error(
				`Market discovery brief ${brief.briefId} references unrecorded provenance`,
			);
		}
	}

	return {
		...result,
		coverage: {
			...result.coverage,
			sourceIds: result.coverage.sourceIds.filter((id) => sourceIds.has(id)),
		},
		receipts: receipts.filter(
			(receipt) =>
				receipt.phase === 'discovery' && receipt.market === result.market,
		),
		sources: artifacts.map((artifact) => artifact.source),
		evidence: artifacts.map((artifact) => artifact.evidence),
	};
}

export function reconcileRegionWithLedger(
	result: ArticleRegionResearchResult,
	ledger: ResearchArtifactLedger,
	receipts: ProviderCallReceipt[],
	phase: 'deep-research' | 'remediation',
): ArticleRegionResearchResult {
	const artifacts = ledger.artifactsFor({
		phase,
		briefId: result.briefId,
		market: result.market,
	});
	const evidenceIds = new Set(artifacts.map((artifact) => artifact.evidence.evidenceId));
	const claims = result.claims.map((claim) => reconcileClaim(claim, evidenceIds));

	return {
		...result,
		receipts: receipts.filter(
			(receipt) =>
				receipt.phase === phase &&
				receipt.briefId === result.briefId &&
				receipt.market === result.market,
		),
		sources: artifacts.map((artifact) => artifact.source),
		evidence: artifacts.map((artifact) => artifact.evidence),
		claims,
	};
}

function reconcileClaim(
	claim: ClaimCandidate,
	evidenceIds: Set<string>,
): ClaimCandidate {
	const supportingEvidenceIds = claim.supportingEvidenceIds.filter((id) => evidenceIds.has(id));
	const contradictingEvidenceIds = claim.contradictingEvidenceIds.filter((id) => evidenceIds.has(id));
	return {
		...claim,
		supportingEvidenceIds,
		contradictingEvidenceIds,
		status:
			claim.kind === 'fact' && supportingEvidenceIds.length === 0
				? 'unsupported'
				: claim.status,
	};
}

function mergeArtifact(a: ResearchArtifact, b: ResearchArtifact): ResearchArtifact {
	return {
		source: {
			...a.source,
			...b.source,
			receiptIds: [...new Set([...a.source.receiptIds, ...b.source.receiptIds])],
		},
		evidence: b.evidence,
	};
}

function deduplicateArtifacts(artifacts: ResearchArtifact[]): ResearchArtifact[] {
	const bySource = new Map<string, ResearchArtifact>();
	for (const artifact of artifacts) {
		const previous = bySource.get(artifact.source.sourceId);
		bySource.set(
			artifact.source.sourceId,
			previous ? mergeArtifact(previous, artifact) : artifact,
		);
	}
	return [...bySource.values()].sort((a, b) =>
		a.source.sourceId.localeCompare(b.source.sourceId),
	);
}
