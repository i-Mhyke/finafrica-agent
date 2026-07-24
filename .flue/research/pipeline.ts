import type {
	BudgetTracker,
	CostAwareWebResearchRouter,
} from '../providers/web-research/router';
import type {
	ArticleRegionResearchResult,
	ArticleResearchBrief,
	ArticleResearchOutcome,
	BlockedBrief,
	BriefValidation,
	BriefValidationInput,
	DiscoveryPortfolio,
	DiscoveryRunRequest,
	EvidenceReadinessReport,
	Market,
	NormalizedArticleResearchPacket,
	ResearchPortfolioRun,
	ReviewInput,
	ReviewReport,
	ResearchRemediationBrief,
	RunStatus,
	StructuralPacket,
} from './schemas';
import {
	allocateProviderBudget,
	DISCOVERY_FETCHES_PER_MARKET,
	DISCOVERY_SEARCHES_PER_MARKET,
	effectiveProviderBudgetUsd,
	effectiveProviderRequestLimit,
	FOUNDATION_MARKETS,
	MAX_CONCURRENT_ARTICLES,
	MAX_CONCURRENT_BRIEF_VALIDATIONS,
	MAX_CONCURRENT_REGIONS_PER_ARTICLE,
} from './schemas';
import {
	auditArticleResearch,
	deduplicateBriefs,
	mergeArticleRemediation,
} from './audit';
import { allocateArticleBudgets, type ArticleBudgetAllocation } from './budget';
import { mapWithConcurrency } from './concurrency';
import { evaluateEvidenceReadiness } from './evidence-readiness';
import { buildRemediationBriefs } from './remediation';
import { shouldSkipRemediation } from './region-guards';
import {
	reconcileReviewWithEvidence,
	reconcileReviewWithPacket,
} from './review';
import { withAuditStage } from './run-audit';
import type { ResearchAuditEmitter } from './run-audit';
import { classifyAuditError } from './run-audit';
import type { ResearchToolBindings } from './delegation';
import { buildBriefValidationInput } from './brief-validation-input';
import { model, researchModelRoles } from '../models';

export interface ResearchDelegator {
	discover(request: DiscoveryRunRequest): Promise<DiscoveryPortfolio>;
	validateBrief(input: BriefValidationInput): Promise<BriefValidation>;
	refineBrief(
		brief: ArticleResearchBrief,
		validation: BriefValidation,
	): Promise<ArticleResearchBrief>;
	research(
		brief: ArticleResearchBrief,
		market: Market,
		options?: {
			phase?: 'deep-research' | 'remediation';
			remediationBrief?: ResearchRemediationBrief;
		},
	): Promise<ArticleRegionResearchResult>;
	analyze(input: NormalizedArticleResearchPacket): Promise<StructuralPacket>;
	review(input: ReviewInput): Promise<ReviewReport>;
}

export interface PipelineDeps {
	delegator: ResearchDelegator;
	toolBindings?: ResearchToolBindings;
	runBudget?: BudgetTracker;
	clock?: () => string;
	audit?: ResearchAuditEmitter;
}

const TERMINAL_ARTICLE_STATUSES = new Set<ArticleResearchOutcome['status']>([
	'passed',
	'rejected',
	'failed',
	'needs-more-research',
]);

export function resolveRunStatus(
	acceptedCount: number,
	articles: ArticleResearchOutcome[],
	partial: boolean,
	blockedCount = 0,
): RunStatus {
	if (blockedCount > 0 && acceptedCount === 0) return 'failed';
	if (partial || blockedCount > 0) return 'partial';
	if (acceptedCount === 0) return 'complete';
	if (articles.length !== acceptedCount) return 'partial';
	if (articles.some((a) => !TERMINAL_ARTICLE_STATUSES.has(a.status))) return 'partial';
	if (articles.some((a) => a.status === 'failed' || a.status === 'needs-more-research')) {
		return 'partial';
	}
	return 'complete';
}

export function resolveArticleStatus(
	review: ReviewReport,
	structuralPacket: StructuralPacket,
	regionFailed: boolean,
): ArticleResearchOutcome['status'] {
	const reconciled = reconcileReviewWithPacket(review, structuralPacket);
	if (reconciled.decision === 'PASS') {
		return regionFailed ? 'needs-more-research' : 'passed';
	}
	if (reconciled.decision === 'REJECT') return 'rejected';
	return 'needs-more-research';
}

export async function executeResearchPipeline(
	deps: PipelineDeps,
	input: DiscoveryRunRequest,
): Promise<ResearchPortfolioRun> {
	const audit = deps.audit;
	const effectiveBudget = effectiveProviderBudgetUsd(input.maxProviderCostUsd);

	if (deps.toolBindings) {
		deps.toolBindings.input = input;
	}

	audit?.startPipeline({
		maxDiscoveredBriefs: input.maxDiscoveredBriefs,
		maxAcceptedBriefs: input.maxAcceptedBriefs,
		maxProviderRequests: effectiveProviderRequestLimit(input.maxProviderRequests),
		maxProviderCostUsd: effectiveBudget,
		activeMarkets: FOUNDATION_MARKETS.length,
		maxDiscoverySearchesPerMarket: DISCOVERY_SEARCHES_PER_MARKET,
		maxDiscoveryFetchesPerMarket: DISCOVERY_FETCHES_PER_MARKET,
	});

	let discovery: DiscoveryPortfolio;
	try {
		discovery = await withAuditStage(
			audit,
			{
				phase: 'discovery',
				agent: 'market_discovery_pool',
				modelRole: researchModelRoles.discovery,
				modelId: model(researchModelRoles.discovery),
				sessionName: 'discovery',
			},
			() => deps.delegator.discover(input),
			(result) => ({ briefs: result.briefs.length }),
		);
	} catch {
		audit?.failPipeline('pipeline_failed');
		return failedPortfolio(
			input,
			effectiveBudget,
			deps.runBudget,
			deps.toolBindings?.executionRecords,
			deps.toolBindings?.ledger,
			undefined,
			deps.toolBindings?.runtime.router,
		);
	}

	return continueResearchPipeline(deps, input, discovery);
}

export async function continueResearchPipeline(
	deps: PipelineDeps,
	input: DiscoveryRunRequest,
	discovery: DiscoveryPortfolio,
): Promise<ResearchPortfolioRun> {
	const clock = deps.clock ?? (() => new Date().toISOString());
	const effectiveBudget = effectiveProviderBudgetUsd(input.maxProviderCostUsd);
	const budgetAlloc = allocateProviderBudget(effectiveBudget);
	const audit = deps.audit;
	const coveredMarkets = new Set(discovery.coverage.map((c) => c.market));
	const failedMarkets = new Set(
		discovery.coverage
			.filter((coverage) => coverage.status === 'failed')
			.map((coverage) => coverage.market),
	);
	if (
		!FOUNDATION_MARKETS.every((market) => coveredMarkets.has(market)) ||
		FOUNDATION_MARKETS.every((market) => failedMarkets.has(market))
	) {
		audit?.failPipeline('pipeline_failed');
		return failedPortfolio(
			input,
			effectiveBudget,
			deps.runBudget,
			deps.toolBindings?.executionRecords,
			deps.toolBindings?.ledger,
			discovery,
			deps.toolBindings?.runtime.router,
		);
	}

	const { unique: uniqueBriefs, duplicates } = deduplicateBriefs(discovery.briefs);
	const briefsToValidate = uniqueBriefs.slice(0, input.maxDiscoveredBriefs);
	const validationByBriefId = new Map<string, BriefValidation>();
	const rejectedBriefs: Array<{ brief: ArticleResearchBrief; validation: BriefValidation }> = [];
	const blockedBriefs: BlockedBrief[] = [];

	function recordBlockedBrief(
		brief: ArticleResearchBrief,
		phase: BlockedBrief['phase'],
		error: unknown,
	): void {
		const classified = classifyAuditError(error);
		blockedBriefs.push({
			brief,
			phase,
			errorClass: classified.errorClass,
			errorMessage: error instanceof Error ? error.message : 'Agent task failed',
		});
	}

	for (const brief of uniqueBriefs.slice(input.maxDiscoveredBriefs)) {
		const validation = rejectValidation(brief, 'Discovery candidate limit exceeded');
		validationByBriefId.set(brief.briefId, validation);
		rejectedBriefs.push({ brief, validation });
	}

	const validations: Array<BriefValidation | null> = await mapWithConcurrency(
		briefsToValidate,
		MAX_CONCURRENT_BRIEF_VALIDATIONS,
		async (brief) => {
			try {
				const validation = await deps.delegator.validateBrief(
					buildBriefValidationInput(brief, discovery),
				);
				audit?.recordDecision({
					kind: 'brief-validation',
					decision: validation.decision,
					briefId: brief.briefId,
					phase: 'brief-validation',
				});
				return validation;
			} catch (error) {
				recordBlockedBrief(brief, 'brief-validation', error);
				return null;
			}
		},
	);

	for (const dup of duplicates) {
		const validation: BriefValidation = {
			briefId: dup.brief.briefId,
			briefVersion: '1',
			decision: 'REJECT',
			reasons: ['Duplicate brief'],
			duplicateOfBriefId: dup.duplicateOfBriefId,
			requiredChanges: [],
			requestedSourceTargets: [],
		};
		validationByBriefId.set(dup.brief.briefId, validation);
		rejectedBriefs.push({ brief: dup.brief, validation });
	}

	const acceptedBriefs: ArticleResearchBrief[] = [];
	for (let i = 0; i < briefsToValidate.length; i++) {
		const brief = briefsToValidate[i];
		const validation = validations[i];
		if (!validation) continue;

		validationByBriefId.set(brief.briefId, validation);

		if (validation.decision === 'REFINE') {
			try {
				const refined = await deps.delegator.refineBrief(brief, validation);
				try {
					const revalidation = await deps.delegator.validateBrief(
						buildBriefValidationInput(refined, discovery),
					);
					audit?.recordDecision({
						kind: 'brief-validation',
						decision: revalidation.decision,
						briefId: refined.briefId,
						phase: 'brief-validation',
					});
					validationByBriefId.set(refined.briefId, revalidation);
					if (revalidation.decision === 'ACCEPT') {
						acceptedBriefs.push(refined);
					} else {
						rejectedBriefs.push({ brief: refined, validation: revalidation });
					}
				} catch (error) {
					recordBlockedBrief(refined, 'brief-validation', error);
				}
			} catch (error) {
				recordBlockedBrief(brief, 'brief-refinement', error);
			}
		} else if (validation.decision === 'ACCEPT') {
			acceptedBriefs.push(brief);
		} else {
			rejectedBriefs.push({ brief, validation });
		}
	}

	const accepted = acceptedBriefs.slice(0, input.maxAcceptedBriefs);
	for (const brief of acceptedBriefs.slice(input.maxAcceptedBriefs)) {
		const validation = rejectValidation(brief, 'Accepted brief limit exceeded');
		validationByBriefId.set(brief.briefId, validation);
		rejectedBriefs.push({ brief, validation });
	}
	const articleBudgets = allocateArticleBudgets(accepted, input.maxProviderCostUsd);
	if (deps.toolBindings) {
		deps.toolBindings.articleBudgets = articleBudgets;
	}

	let partial = failedMarkets.size > 0;
	const articles = await mapWithConcurrency(accepted, MAX_CONCURRENT_ARTICLES, async (brief) => {
		const validation = validationByBriefId.get(brief.briefId);
		if (!validation || validation.decision !== 'ACCEPT') {
			partial = true;
			return failedArticleOutcome(
				brief,
				validation ?? rejectValidation(brief, 'Missing validation'),
				executionRecordsFor(deps, brief.briefId),
			);
		}

		const allocation = articleBudgets.get(brief.briefId);
		try {
			return await processArticle(
				deps,
				brief,
				validation,
				allocation,
				budgetAlloc.deepResearch / Math.max(accepted.length, 1),
				clock,
				input.window,
			);
		} catch {
			partial = true;
			return failedArticleOutcome(
				brief,
				validation,
				executionRecordsFor(deps, brief.briefId),
			);
		}
	});

	const status = resolveRunStatus(accepted.length, articles, partial, blockedBriefs.length);
	const runBudget = deps.runBudget;
	const finalArtifacts = collectFinalArtifactCounts(articles);

	audit?.recordArtifact({
		phase: 'pipeline',
		counts: finalArtifacts,
	});
	const pipelineCounts = {
		discovered: discovery.briefs.length,
		accepted: accepted.length,
		passed: articles.filter((a) => a.status === 'passed').length,
	};
	if (status === 'failed') {
		audit?.failPipeline('pipeline_failed');
	} else {
		audit?.completePipeline(pipelineCounts);
	}

	return {
		runKey: input.runKey,
		status,
		discovery,
		articles,
		execution: deps.toolBindings?.executionRecords ?? [],
		rejectedBriefs,
		blockedBriefs,
		providerUsage: {
			requestedBudgetUsd: input.maxProviderCostUsd,
			effectiveBudgetUsd: effectiveBudget,
			requestedRequestLimit: input.maxProviderRequests,
			effectiveRequestLimit: effectiveProviderRequestLimit(input.maxProviderRequests),
			admittedRequestCount:
				deps.toolBindings?.runtime?.router.admittedRequestCount ?? 0,
			requestRejectionCount:
				deps.toolBindings?.runtime?.router.requestRejectionCount ?? 0,
			admittedEstimateUsd: runBudget?.admittedEstimateUsd ?? 0,
			actualCostUsd: runBudget?.actualCostUsd ?? 0,
			unpricedCallCount: runBudget?.unpricedCallCount ?? 0,
			overrunUsd: runBudget?.overrunUsd ?? 0,
			receipts: deduplicateReceipts([
				...discovery.receipts,
				...(runBudget?.receipts ?? []),
			]),
		},
		totals: {
			discovered: discovery.briefs.length,
			accepted: accepted.length,
			passed: articles.filter((a) => a.status === 'passed').length,
			incomplete: articles.filter((a) => a.status === 'needs-more-research').length,
			rejected: rejectedBriefs.length,
			blocked: blockedBriefs.length,
		},
	};
}

function collectFinalArtifactCounts(
	articles: ArticleResearchOutcome[],
): Record<string, number> {
	const sourceIds = new Set<string>();
	const evidenceIds = new Set<string>();
	const claimIds = new Set<string>();
	const receiptIds = new Set<string>();

	for (const article of articles) {
		for (const source of article.sourceAudit?.sources ?? []) {
			sourceIds.add(source.sourceId);
			for (const receiptId of source.receiptIds) {
				receiptIds.add(receiptId);
			}
		}
		for (const excerpt of article.sourceAudit?.evidence ?? []) {
			evidenceIds.add(excerpt.evidenceId);
		}
		for (const claim of article.sourceAudit?.claims ?? []) {
			claimIds.add(claim.claimId);
		}
		for (const region of article.regionResults ?? []) {
			for (const receipt of region.receipts) {
				receiptIds.add(receipt.receiptId);
			}
		}
	}

	return {
		sources: sourceIds.size,
		evidence: evidenceIds.size,
		claims: claimIds.size,
		providerReceipts: receiptIds.size,
	};
}

function deduplicateReceipts(
	receipts: ResearchPortfolioRun['providerUsage']['receipts'],
): ResearchPortfolioRun['providerUsage']['receipts'] {
	const byId = new Map(receipts.map((receipt) => [receipt.receiptId, receipt]));
	return [...byId.values()];
}

export function createFailedResearchPortfolio(
	input: DiscoveryRunRequest,
	runBudget?: BudgetTracker,
): ResearchPortfolioRun {
	return failedPortfolio(input, effectiveProviderBudgetUsd(input.maxProviderCostUsd), runBudget);
}

async function processArticle(
	deps: PipelineDeps,
	brief: ArticleResearchBrief,
	validation: BriefValidation,
	allocation: ArticleBudgetAllocation | undefined,
	perArticleBudget: number,
	_clock: () => string,
	window: DiscoveryRunRequest['window'],
): Promise<ArticleResearchOutcome> {
	void allocation;
	void perArticleBudget;
	const audit = deps.audit;
	const articleStage = audit?.startStage({
		phase: 'article',
		briefId: brief.briefId,
		agent: 'article_pipeline',
		sessionName: `article:${brief.briefId}`,
	});

	const failArticle = (outcome: ArticleResearchOutcome): ArticleResearchOutcome => {
		articleStage?.fail('agent_task_failed');
		return outcome;
	};

	const recordReadinessDecisions = (
		readiness: EvidenceReadinessReport,
		remediationPass: number,
	) => {
		for (const requirement of readiness.requirements) {
			audit?.recordDecision({
				kind: 'evidence-requirement',
				decision: requirement.status,
				briefId: brief.briefId,
				market: requirement.market,
				entityId: requirement.requirementId,
				reasonCodes: requirement.reasonCodes,
				phase: 'evidence-readiness',
				counts: {
					sources: requirement.sourceIds.length,
					evidence: requirement.evidenceIds.length,
					missingAnchors: requirement.missingAnchors.length,
					pass: remediationPass,
				},
			});
		}
		audit?.recordDecision({
			kind: 'evidence-readiness',
			decision: readiness.ready ? 'passed' : 'blocked',
			briefId: brief.briefId,
			entityId: brief.briefId,
			phase: 'evidence-readiness',
			counts: { pass: remediationPass },
		});
	};

	let regionFailed = false;
	const regionResults = await mapWithConcurrency(
		brief.markets,
		MAX_CONCURRENT_REGIONS_PER_ARTICLE,
		async (market) => {
			try {
				return await deps.delegator.research(brief, market);
			} catch {
				regionFailed = true;
				return {
					briefId: brief.briefId,
					market,
					status: 'failed' as const,
					receipts: [],
					sources: [],
					evidence: [],
					claims: [],
					gaps: [`Region research failed for ${market}`],
					error: 'Region research failed',
				};
			}
		},
	);

	let sourceAudit = await auditArticleResearch(brief, regionResults);
	let readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);
	recordReadinessDecisions(readiness, 0);

	if (!readiness.ready && !shouldSkipRemediation(readiness, sourceAudit)) {
		const remediationBriefs = buildRemediationBriefs(brief, sourceAudit, readiness);
		for (const remediationBrief of remediationBriefs) {
			try {
				const remediation = await deps.delegator.research(
					brief,
					remediationBrief.market,
					{ phase: 'remediation', remediationBrief },
				);
				const index = regionResults.findIndex(
					(result) => result.market === remediationBrief.market,
				);
				if (index >= 0) {
					regionResults[index] = mergeArticleRemediation(
						regionResults[index],
						remediation,
					);
				} else {
					regionResults.push(remediation);
				}
			} catch {
				regionFailed = true;
			}
		}
		sourceAudit = await auditArticleResearch(brief, regionResults);
		readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);
		recordReadinessDecisions(readiness, 1);
	}

	if (!readiness.ready) {
		const status = 'needs-more-research' as const;
		audit?.recordDecision({
			kind: 'article-outcome',
			decision: status,
			briefId: brief.briefId,
			phase: 'article',
		});
		articleStage?.complete({ regions: regionResults.length });
		return {
			brief,
			validation,
			status,
			regionResults,
			sourceAudit,
			readiness,
			structuralPacket: null,
			review: null,
			execution: executionRecordsFor(deps, brief.briefId),
		};
	}

	const packet: NormalizedArticleResearchPacket = {
		brief,
		sourceAudit,
		regionResults,
		readiness,
	};

	let structuralPacket: StructuralPacket | null = null;
	let review: ReviewReport | null = null;

	try {
		structuralPacket = await deps.delegator.analyze(packet);
	} catch {
		return failArticle({
			brief,
			validation,
			status: 'failed',
			regionResults,
			sourceAudit,
			readiness,
			structuralPacket: null,
			review: null,
			execution: executionRecordsFor(deps, brief.briefId),
		});
	}

	try {
		review = await deps.delegator.review({
			brief,
			sourceAudit,
			readiness,
			structuralPacket,
			proposedOutputType: determineOutputType(brief),
		});
	} catch {
		return failArticle({
			brief,
			validation,
			status: 'failed',
			regionResults,
			sourceAudit,
			readiness,
			structuralPacket,
			review: null,
			execution: executionRecordsFor(deps, brief.briefId),
		});
	}

	review = reconcileReviewWithEvidence(review, structuralPacket, sourceAudit, readiness);

	const status = resolveArticleStatus(review, structuralPacket, regionFailed);
	audit?.recordDecision({
		kind: 'article-outcome',
		decision: status,
		briefId: brief.briefId,
		phase: 'article',
	});
	articleStage?.complete({ regions: regionResults.length });

	return {
		brief,
		validation,
		status,
		regionResults,
		sourceAudit,
		readiness,
		structuralPacket,
		review,
		execution: executionRecordsFor(deps, brief.briefId),
	};
}

function determineOutputType(brief: ArticleResearchBrief): string {
	if (brief.verticals.some((vertical) => vertical.includes('regulation') || vertical.includes('policy'))) {
		return 'policy explainer';
	}
	if (brief.verticals.some((vertical) => vertical.includes('company'))) {
		return 'company deep dive';
	}
	return 'full analysis';
}

function rejectValidation(brief: ArticleResearchBrief, reason: string): BriefValidation {
	return {
		briefId: brief.briefId,
		briefVersion: '1',
		decision: 'REJECT',
		reasons: [reason],
		duplicateOfBriefId: null,
		requiredChanges: [],
		requestedSourceTargets: [],
	};
}

function failedArticleOutcome(
	brief: ArticleResearchBrief,
	validation: BriefValidation,
	execution: ArticleResearchOutcome['execution'] = [],
): ArticleResearchOutcome {
	return {
		brief,
		validation,
		status: 'failed',
		regionResults: [],
		sourceAudit: {
			briefId: brief.briefId,
			sources: [],
			evidence: [],
			claims: [],
			gaps: ['Article processing failed'],
			duplicateSourceIds: [],
			staleSourceIds: [],
		},
		readiness: null,
		structuralPacket: null,
		review: null,
		execution,
	};
}

function executionRecordsFor(
	deps: PipelineDeps,
	briefId: string,
): ArticleResearchOutcome['execution'] {
	return deps.toolBindings?.executionRecords.filter((record) => record.briefId === briefId) ?? [];
}

function failedPortfolio(
	input: DiscoveryRunRequest,
	effectiveBudget: number,
	runBudget?: BudgetTracker,
	execution: ResearchPortfolioRun['execution'] = [],
	ledger?: ResearchToolBindings['ledger'],
	retainedDiscovery?: DiscoveryPortfolio,
	router?: CostAwareWebResearchRouter,
): ResearchPortfolioRun {
	const discoveryReceipts = deduplicateReceipts(
		[
			...(retainedDiscovery?.receipts ?? []),
			...(runBudget?.receipts ?? []),
		].filter((receipt) => receipt.phase === 'discovery'),
	);
	const discoveryArtifacts = ledger?.discoveryArtifacts() ?? [];
	const coverage = FOUNDATION_MARKETS.map((market) => ({
		market,
		searchesPerformed: new Set(
			discoveryReceipts
				.filter(
					(receipt) => receipt.market === market && receipt.operation === 'search',
				)
				.map((receipt) => receipt.callKey),
		).size,
		signalsFound: 0,
		sourceIds: discoveryArtifacts
			.filter((artifact) => artifact.source.market === market)
			.map((artifact) => artifact.source.sourceId),
		status: 'failed' as const,
	}));

	return {
		runKey: input.runKey,
		status: 'failed',
		discovery: {
			...(retainedDiscovery ?? {
				runKey: input.runKey,
				coverage,
				sources: discoveryArtifacts.map((artifact) => artifact.source),
				evidence: discoveryArtifacts.map((artifact) => artifact.evidence),
				briefs: [],
			}),
			receipts: discoveryReceipts,
		},
		articles: [],
		execution,
		rejectedBriefs: [],
		blockedBriefs: [],
		providerUsage: {
			requestedBudgetUsd: input.maxProviderCostUsd,
			effectiveBudgetUsd: effectiveBudget,
			requestedRequestLimit: input.maxProviderRequests,
			effectiveRequestLimit: effectiveProviderRequestLimit(input.maxProviderRequests),
			admittedRequestCount: router?.admittedRequestCount ?? 0,
			requestRejectionCount: router?.requestRejectionCount ?? 0,
			admittedEstimateUsd: runBudget?.admittedEstimateUsd ?? 0,
			actualCostUsd: runBudget?.actualCostUsd ?? 0,
			unpricedCallCount: runBudget?.unpricedCallCount ?? 0,
			overrunUsd: runBudget?.overrunUsd ?? 0,
			receipts: runBudget?.receipts ?? [],
		},
		totals: {
			discovered: retainedDiscovery?.briefs.length ?? 0,
			accepted: 0,
			passed: 0,
			incomplete: 0,
			rejected: 0,
			blocked: 0,
		},
	};
}
