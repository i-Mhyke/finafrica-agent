import type { FlueHarness } from '@flue/runtime';
import type {
	ArticleRegionResearchResult,
	ArticleResearchBrief,
	DiscoveryPortfolio,
	DiscoveryRunRequest,
	MarketDiscoveryAgentResult,
	MarketDiscoveryResult,
	Market,
	NormalizedArticleResearchPacket,
	ReviewInput,
	ResearchRemediationBrief,
	ReviewReport,
	StructuralPacket,
	BriefValidation,
	BriefValidationInput,
	AgentExecutionRecord,
} from './schemas';
import {
	FOUNDATION_MARKETS,
	DISCOVERY_TASK_TIMEOUT_MS,
	BRIEF_VALIDATION_TASK_TIMEOUT_MS,
	BRIEF_REFINEMENT_TASK_TIMEOUT_MS,
	REGION_RESEARCH_TASK_TIMEOUT_MS,
	STRUCTURAL_ANALYSIS_TASK_TIMEOUT_MS,
	RESEARCH_REVIEW_TASK_TIMEOUT_MS,
	MarketDiscoveryAgentResultSchema,
	ArticleResearchBriefSchema,
	BriefValidationInputSchema,
	BriefValidationSchema,
	StructuralPacketSchema,
	ReviewReportSchema,
} from './schemas';
import { regionFinishSchemaForBrief } from './region-guards';
import { discoveryFinishSchemaForLedger } from './discovery-guards';
import type { ResearchDelegator } from './pipeline';
import type { ArticleBudgetAllocation } from './budget';
import type { ResearchRuntime } from './runtime';
import type { ResearchAuditEmitter } from './run-audit';
import { classifyAuditError, extractValidationReasonCodes } from './run-audit';
import {
	ResearchArtifactLedger,
	reconcileMarketDiscoveryWithLedger,
	reconcileRegionWithLedger,
} from './ledger';
import {
	createArticleResearchTools,
	createBriefValidatorTools,
	createDiscoveryTools,
} from '../tools/research-tools';
import { parse } from 'valibot';
import { sha256Hex } from './ids';
import { model, researchModelRoles, type ModelRole } from '../models';
import {
	startSessionUsageTracking,
	type SalvagedTaskUsage,
} from './session-usage-tracker';

export interface ResearchToolBindings {
	runtime: ResearchRuntime;
	input: DiscoveryRunRequest;
	articleBudgets: Map<string, ArticleBudgetAllocation>;
	ledger: ResearchArtifactLedger;
	executionRecords: AgentExecutionRecord[];
	audit?: ResearchAuditEmitter;
}

interface RecordedTaskResponse<T> {
	data: T;
	usage: {
		input: number;
		output: number;
		cost: { total: number };
	};
	model: { provider: string; id: string };
}

function salvageTaskUsage(error: unknown): SalvagedTaskUsage | null {
	if (!error || typeof error !== 'object') return null;
	const candidate = error as {
		usage?: { input?: number; output?: number; cost?: { total?: number } };
		response?: { usage?: { input?: number; output?: number; cost?: { total?: number } } };
	};
	const usage = candidate.usage ?? candidate.response?.usage;
	if (!usage) return null;
	const input = usage.input;
	const output = usage.output;
	const costUsd = usage.cost?.total;
	if (
		typeof input !== 'number' ||
		typeof output !== 'number' ||
		typeof costUsd !== 'number'
	) {
		return null;
	}
	return { input, output, costUsd };
}

export function createFlueResearchDelegator(
	harness: FlueHarness,
	profiles: {
		discovery: Record<(typeof FOUNDATION_MARKETS)[number], string>;
		briefValidator: string;
		briefRefiner: string;
		regionResearchers: Record<Market, string>;
		structuralAnalyst: string;
		researchReviewer: string;
	},
	bindings?: ResearchToolBindings,
): ResearchDelegator {
	const clock = { now: () => new Date().toISOString() };

	async function executeRecordedTask<T>(params: {
		sessionName: string;
		agent: string;
		briefId: string | null;
		phase: string;
		modelRole: ModelRole;
		market?: Market | null;
		call: () => Promise<RecordedTaskResponse<T>>;
	}): Promise<RecordedTaskResponse<T>> {
		const startedAt = clock.now();
		const audit = bindings?.audit;
		const expectedModelId = model(params.modelRole);
		const stage = audit?.startAgentTask({
			phase: params.phase,
			briefId: params.briefId,
			market: params.market ?? null,
			agent: params.agent,
			modelRole: params.modelRole,
			modelId: expectedModelId,
			sessionName: params.sessionName,
		});
		const usageTracker = startSessionUsageTracking(params.sessionName);
		try {
			const response = await params.call();
			stage?.complete({
				inputTokens: response.usage.input,
				outputTokens: response.usage.output,
			});
			if (bindings) {
				bindings.executionRecords.push(
					await buildExecutionRecord({
						runKey: bindings.input.runKey,
						briefId: params.briefId,
						agent: params.agent,
						sessionName: params.sessionName,
						phase: params.phase,
						modelRole: params.modelRole,
						startedAt,
						completedAt: clock.now(),
						status: 'succeeded',
						modelId: `${response.model.provider}/${response.model.id}`,
						tokenUsage: {
							input: response.usage.input,
							output: response.usage.output,
						},
						costUsd: response.usage.cost.total,
						error: null,
					}),
				);
			}
			return response;
		} catch (error) {
			const classified = classifyAuditError(error);
			const salvagedUsage = salvageTaskUsage(error) ?? usageTracker.stop();
			if (classified.errorClass === 'validation_error') {
				audit?.recordDecision({
					kind: 'agent-finish',
					decision: 'rejected',
					briefId: params.briefId,
					market: params.market ?? null,
					phase: params.phase,
					entityId: params.sessionName,
					reasonCodes: extractValidationReasonCodes(error),
				});
			}
			stage?.fail(classified.errorClass, classified.errorCode);
			if (bindings) {
				bindings.executionRecords.push(
					await buildExecutionRecord({
						runKey: bindings.input.runKey,
						briefId: params.briefId,
						agent: params.agent,
						sessionName: params.sessionName,
						phase: params.phase,
						modelRole: params.modelRole,
						startedAt,
						completedAt: clock.now(),
						status: 'failed',
						modelId: expectedModelId,
						tokenUsage: salvagedUsage
							? {
									input: salvagedUsage.input,
									output: salvagedUsage.output,
								}
							: null,
						costUsd: salvagedUsage?.costUsd ?? null,
						error: error instanceof Error ? error.message : 'Agent task failed',
					}),
				);
			}
			throw error;
		} finally {
			usageTracker.stop();
		}
	}

	function discoveryTools(market: (typeof FOUNDATION_MARKETS)[number]) {
		if (!bindings) return undefined;
		const { search_web, fetch_sources } = createDiscoveryTools({
			router: bindings.runtime.router,
			budget:
				bindings.runtime.discoveryBudgets[market] ??
				bindings.runtime.discoveryBudget,
			clock,
			scope: {
				runKey: bindings.input.runKey,
				phase: 'discovery',
				market,
				windowStart: bindings.input.window.start,
				windowEnd: bindings.input.window.end,
				maxProviderCostUsd: bindings.input.maxProviderCostUsd,
			},
			ledger: bindings.ledger,
		});
		return [search_web, fetch_sources];
	}

	function validatorTools(brief: ArticleResearchBrief, market: Market) {
		if (!bindings) return undefined;
		const { search_web } = createBriefValidatorTools({
			router: bindings.runtime.router,
			budget: bindings.runtime.discoveryBudget,
			scope: {
				runKey: bindings.input.runKey,
				briefId: brief.briefId,
				windowStart: bindings.input.window.start,
				windowEnd: bindings.input.window.end,
			},
			market,
		});
		return [search_web];
	}

	function articleTools(brief: ArticleResearchBrief, market: Market, phase: 'deep-research' | 'remediation') {
		if (!bindings) return undefined;
		const allocation = bindings.articleBudgets.get(brief.briefId);
		const budget =
			(phase === 'remediation'
				? allocation?.remediationTrackers[market]
				: allocation?.marketTrackers[market]) ??
			allocation?.tracker ??
			bindings.runtime.runBudget;
		const { search_web, fetch_sources } = createArticleResearchTools({
			router: bindings.runtime.router,
			budget,
			clock,
			scope: {
				runKey: bindings.input.runKey,
				briefId: brief.briefId,
				market,
				phase,
				windowStart: bindings.input.window.start,
				windowEnd: bindings.input.window.end,
					maxProviderCostUsd:
						allocation?.totalUsd ?? bindings.input.maxProviderCostUsd,
				},
			ledger: bindings.ledger,
		});
		return [search_web, fetch_sources];
	}

	return {
		async discover(request: DiscoveryRunRequest): Promise<DiscoveryPortfolio> {
			const briefLimits = allocateDiscoveryBriefLimits(
				request.maxDiscoveredBriefs,
			);
			const settled = await Promise.allSettled(
				FOUNDATION_MARKETS.map(async (market) => {
					const sessionName = `discovery:${market}`;
					const session = await harness.session(sessionName);
					const tools = discoveryTools(market);
					const briefLimit = briefLimits[market];
					const { data } = await executeRecordedTask({
						sessionName,
						agent: profiles.discovery[market],
						briefId: null,
						phase: 'discovery',
						modelRole: researchModelRoles.discovery,
						market,
						call: () =>
							session.task(
								JSON.stringify({
									...request,
									assignedMarket: market,
									maxDiscoveredBriefs: briefLimit,
									maxAcceptedBriefs: Math.min(
										request.maxAcceptedBriefs,
										briefLimit,
									),
								}),
								{
									agent: profiles.discovery[market],
									result: bindings
										? discoveryFinishSchemaForLedger(
												request.runKey,
												market,
												bindings.ledger,
											)
										: MarketDiscoveryAgentResultSchema,
									signal: AbortSignal.timeout(DISCOVERY_TASK_TIMEOUT_MS),
									...(tools ? { tools } : {}),
								},
							),
					});
					return bindings
						? reconcileMarketDiscoveryWithLedger(
								{ ...data, briefs: data.briefs.slice(0, briefLimit) },
								bindings.ledger,
								bindings.runtime.runBudget.receipts,
							)
						: emptyMarketDiscoveryArtifacts({
								...data,
								briefs: data.briefs.slice(0, briefLimit),
							});
				}),
			);
				const marketResults = settled.map((result, index) => {
					if (result.status === 'fulfilled') return result.value;
					return failedMarketDiscoveryResult(
						request.runKey,
						FOUNDATION_MARKETS[index]!,
						bindings,
					);
				});
				return mergeMarketDiscoveryResults(request.runKey, marketResults);
			},

		async validateBrief(input: BriefValidationInput): Promise<BriefValidation> {
			const validatedInput = parse(BriefValidationInputSchema, input);
			const brief = validatedInput.brief;
			const market = brief.markets[0];
			if (!market) {
				throw new Error(
					`Research brief ${brief.briefId} must include at least one market`,
				);
			}
			const session = await harness.session(`brief-validator:${brief.briefId}`);
			const tools = validatorTools(brief, market);
			const { data } = await executeRecordedTask({
				sessionName: `brief-validator:${brief.briefId}`,
				agent: profiles.briefValidator,
				briefId: brief.briefId,
				phase: 'brief-validation',
				modelRole: researchModelRoles.briefValidator,
				market,
				call: () => session.task(JSON.stringify(validatedInput), {
					agent: profiles.briefValidator,
					result: BriefValidationSchema,
					signal: AbortSignal.timeout(BRIEF_VALIDATION_TASK_TIMEOUT_MS),
					...(tools ? { tools } : {}),
				}),
			});
			return data;
		},

		async refineBrief(
			brief: ArticleResearchBrief,
			validation: BriefValidation,
		): Promise<ArticleResearchBrief> {
			const session = await harness.session(`brief-refiner:${brief.briefId}`);
			const { data } = await executeRecordedTask({
				sessionName: `brief-refiner:${brief.briefId}`,
				agent: profiles.briefRefiner,
				briefId: brief.briefId,
				phase: 'brief-refinement',
				modelRole: researchModelRoles.briefRefiner,
				call: () => session.task(JSON.stringify({ brief, validation }), {
					agent: profiles.briefRefiner,
					result: ArticleResearchBriefSchema,
					signal: AbortSignal.timeout(BRIEF_REFINEMENT_TASK_TIMEOUT_MS),
				}),
			});
			return data;
		},

		async research(
			brief: ArticleResearchBrief,
			market: Market,
			options?: {
				phase?: 'deep-research' | 'remediation';
				remediationBrief?: ResearchRemediationBrief;
			},
		): Promise<ArticleRegionResearchResult> {
			const phase = options?.phase ?? 'deep-research';
			if (phase === 'remediation' && !options?.remediationBrief) {
				throw new Error('Remediation phase requires remediationBrief');
			}
			if (phase === 'deep-research' && options?.remediationBrief) {
				throw new Error('Deep research must not receive remediationBrief');
			}
			if (phase === 'remediation' && options?.remediationBrief?.market !== market) {
				throw new Error(
					`Remediation brief market ${options?.remediationBrief?.market} does not match ${market}`,
				);
			}
			const sessionName = `article:${brief.briefId}:region:${market}:${phase}`;
			const session = await harness.session(sessionName);
			const tools = articleTools(brief, market, phase);
			const agent = profiles.regionResearchers[market];
			const { data } = await executeRecordedTask({
				sessionName,
				agent,
				briefId: brief.briefId,
				phase,
				modelRole: researchModelRoles.regionResearcher,
				market,
				call: () =>
					session.task(
						JSON.stringify({
							brief,
							market,
							phase,
							...(options?.remediationBrief
								? { remediationBrief: options.remediationBrief }
								: {}),
						}),
						{
							agent,
							result: regionFinishSchemaForBrief(brief, market),
							signal: AbortSignal.timeout(REGION_RESEARCH_TASK_TIMEOUT_MS),
							...(tools ? { tools } : {}),
						},
					),
			});
			return bindings
				? reconcileRegionWithLedger(
						data,
						bindings.ledger,
						bindings.runtime.runBudget.receipts,
						phase,
					)
				: data;
		},

		async analyze(input: NormalizedArticleResearchPacket): Promise<StructuralPacket> {
			const session = await harness.session(`article:${input.brief.briefId}:structural-analyst`);
			const sessionName = `article:${input.brief.briefId}:structural-analyst`;
			const { data } = await executeRecordedTask({
				sessionName,
				agent: profiles.structuralAnalyst,
				briefId: input.brief.briefId,
				phase: 'structural-analysis',
				modelRole: researchModelRoles.structuralAnalyst,
				call: () => session.task(JSON.stringify(input), {
					agent: profiles.structuralAnalyst,
					result: StructuralPacketSchema,
					signal: AbortSignal.timeout(STRUCTURAL_ANALYSIS_TASK_TIMEOUT_MS),
				}),
			});
			return data;
		},

		async review(input: ReviewInput): Promise<ReviewReport> {
			const session = await harness.session(`article:${input.brief.briefId}:reviewer`);
			const sessionName = `article:${input.brief.briefId}:reviewer`;
			const { data } = await executeRecordedTask({
				sessionName,
				agent: profiles.researchReviewer,
				briefId: input.brief.briefId,
				phase: 'review',
				modelRole: researchModelRoles.researchReviewer,
				call: () => session.task(JSON.stringify(input), {
					agent: profiles.researchReviewer,
					result: ReviewReportSchema,
					signal: AbortSignal.timeout(RESEARCH_REVIEW_TASK_TIMEOUT_MS),
				}),
			});
			return data;
		},
	};
}

async function buildExecutionRecord(
	input: Omit<
		AgentExecutionRecord,
		'recordId' | 'promptVersion' | 'skillVersions' | 'schemaVersion'
	>,
): Promise<AgentExecutionRecord> {
	const recordId = `exec_${(
		await sha256Hex(
			`${input.runKey}:${input.briefId ?? ''}:${input.sessionName}:${input.startedAt}:${input.status}`,
		)
	).slice(0, 16)}`;
	return {
		...input,
		recordId,
		promptVersion: '1',
		skillVersions: { [skillForAgent(input.agent)]: '1' },
		schemaVersion: '1',
	};
}

function skillForAgent(agent: string): string {
	if (agent.startsWith('discovery_')) return 'scan-market-signals';
	if (agent === 'brief_validator') return 'validate-research-briefs';
	if (agent === 'brief_refiner') return 'refine-research-briefs';
	if (agent.startsWith('research_')) return 'research-regional-evidence';
	if (agent === 'structural_analyst') return 'analyze-financial-structure';
	if (agent === 'research_reviewer') return 'review-research-packets';
	return 'unknown';
}

export function mergeMarketDiscoveryResults(
	runKey: string,
	results: MarketDiscoveryResult[],
): DiscoveryPortfolio {
	const byMarket = new Map(results.map((result) => [result.market, result]));
	for (const market of FOUNDATION_MARKETS) {
		const result = byMarket.get(market);
		if (!result || result.runKey !== runKey || result.coverage.market !== market) {
			throw new Error(`Invalid discovery result for ${market}`);
		}
	}
	return {
		runKey,
		coverage: FOUNDATION_MARKETS.map((market) => byMarket.get(market)!.coverage),
		receipts: results.flatMap((result) => result.receipts),
		sources: results.flatMap((result) => result.sources),
		evidence: results.flatMap((result) => result.evidence),
		briefs: results.flatMap((result) => result.briefs),
	};
}

function failedMarketDiscoveryResult(
	runKey: string,
	market: (typeof FOUNDATION_MARKETS)[number],
	bindings?: ResearchToolBindings,
): MarketDiscoveryResult {
	const artifacts =
		bindings?.ledger.artifactsFor({
			phase: 'discovery',
			briefId: null,
			market,
		}) ?? [];
	const receipts =
		bindings?.runtime.runBudget.receipts.filter(
			(receipt) => receipt.phase === 'discovery' && receipt.market === market,
		) ?? [];
	return {
		runKey,
		market,
		coverage: {
			market,
			searchesPerformed: receipts.filter(
				(receipt) => receipt.operation === 'search',
			).length,
			signalsFound: 0,
			sourceIds: artifacts.map((artifact) => artifact.source.sourceId),
			status: 'failed',
		},
		receipts,
		sources: artifacts.map((artifact) => artifact.source),
		evidence: artifacts.map((artifact) => artifact.evidence),
		briefs: [],
	};
}

function emptyMarketDiscoveryArtifacts(
	result: MarketDiscoveryAgentResult,
): MarketDiscoveryResult {
	return {
		...result,
		receipts: [],
		sources: [],
		evidence: [],
	};
}

export function allocateDiscoveryBriefLimits(
	totalBriefs: number,
): Record<(typeof FOUNDATION_MARKETS)[number], number> {
	if (totalBriefs < FOUNDATION_MARKETS.length) {
		throw new Error(
			'Discovery candidate limit must allow one brief per foundation market',
		);
	}
	const base = Math.floor(totalBriefs / FOUNDATION_MARKETS.length);
	const remainder = totalBriefs % FOUNDATION_MARKETS.length;
	return Object.fromEntries(
		FOUNDATION_MARKETS.map((market, index) => [
			market,
			base + (index < remainder ? 1 : 0),
		]),
	) as Record<(typeof FOUNDATION_MARKETS)[number], number>;
}
