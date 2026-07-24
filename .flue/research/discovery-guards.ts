import * as v from 'valibot';
import type { ResearchArtifactLedger } from './ledger';
import {
	MarketDiscoveryAgentResultSchema,
	type Market,
} from './schemas';

export function discoveryFinishSchemaForLedger(
	runKey: string,
	market: Market,
	ledger: ResearchArtifactLedger,
) {
	return v.pipe(
		MarketDiscoveryAgentResultSchema,
		v.check(
			(result) => result.runKey === runKey && result.market === market,
			'Discovery output must match the assigned run and market',
		),
		v.check((result) => {
			const artifacts = ledger.artifactsFor({
				phase: 'discovery',
				briefId: null,
				market,
			});
			const sourceIds = new Set(
				artifacts.map((artifact) => artifact.source.sourceId),
			);
			const evidenceIds = new Set(
				artifacts.map((artifact) => artifact.evidence.evidenceId),
			);
			return result.briefs.every(
				(brief) =>
					brief.discoverySourceIds.every((id) => sourceIds.has(id)) &&
					brief.discoveryEvidenceIds.every((id) => evidenceIds.has(id)),
			);
		}, 'Discovery briefs may reference only evidence retained by successful fetches'),
	);
}
