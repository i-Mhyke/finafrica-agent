# Research Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an article from reaching structural analysis or research review until deterministic checks prove that its material claims have retained, correctly classified evidence.

**Architecture:** Discovery defines an evidence contract on each article brief. Regional researchers bind claims and excerpts to that contract. Pure TypeScript functions grade readiness and build one bounded, market-specific remediation request. `processArticle` enforces the order `research -> audit -> readiness -> optional remediation -> readiness -> analysis -> review`.

**Tech Stack:** TypeScript 5.9, Valibot 1.4, Vitest 4, Flue Runtime, existing research audit log.

## Global Constraints

- Foundation markets remain exactly `['nigeria', 'ghana']`.
- Discovery remains two searches per market. Deep research remains four searches and six fetch attempts per article-market. Remediation remains two searches and three fetch attempts per article-market.
- No dependency changes.
- No model-role or model-ID changes.
- No provider-router, Exa, Apify, budget-allocation, workflow endpoint, authentication, Cloudflare, or Wrangler changes.
- No writing, publishing, graph database, embeddings, or semantic-similarity work.
- No source is fetched by the readiness gate; the gate reads retained `SourceAudit` data only.
- One article receives at most one evidence-remediation pass.
- Structural analysis and research review each run at most once on the normal path.
- Existing source, evidence, receipt, and execution IDs remain stable.
- Existing JSON output fields remain present. New fields are additive.
- Tests must not call a provider or paid model.

---

## File Responsibility and Mutation Map

Only the files in this table may change under this plan.

| File | Exact allowed change | Explicitly out of scope |
|---|---|---|
| `.flue/research/schemas.ts` | Add the named schemas and additive fields listed in Task 1. | Do not change market lists, limits, provider budgets, existing enum values, or existing field meanings. |
| `.flue/research/evidence-readiness.ts` | New pure readiness evaluator. | No network, model, filesystem, clock, or audit calls. |
| `.flue/research/remediation.ts` | New pure remediation-brief builder. | No provider calls and no model calls. |
| `.flue/research/pipeline.ts` | Change only `ResearchDelegator.research`, the `processArticle` invocation, `processArticle`, and `failedArticleOutcome`. | Do not change discovery, brief validation, budget allocation, concurrency constants, run-status resolution, or portfolio assembly. |
| `.flue/research/delegation.ts` | Change only the `research` method's input serialization and option type usage. | Do not change discovery, validator, analyzer, reviewer, session names, tools, or model roles. |
| `.flue/research/review.ts` | Add readiness to `reconcileReviewWithEvidence`. | Do not change review scoring or packet-version rules. |
| `.flue/research/run-audit.ts` | Extend decision records with `market`, `entityId`, and `reasonCodes`. | Do not add event names or change provider/stage event behavior. |
| `scripts/lib/research-audit-projection.mjs` | Project the three additive decision fields and readiness counters. | Do not change provider/LLM cost arithmetic, event retention, redaction, or watcher state. |
| `scripts/lib/research-audit-format.mjs` | Add one article-readiness summary line. | Do not change watcher connection or terminal-state wording in this plan. |
| Three prompt files named in Task 2 | Add evidence-contract instructions. | Do not rewrite agent purpose, tool permissions, or search limits. |
| Four skill files named in Task 2 | Mirror the same evidence-contract rules. | Do not copy the full publication skill into regional-agent context. |
| Existing fixtures and tests named in each task | Add fields and cases required by the new contracts. | Do not rewrite unrelated provider or watcher fixtures. |

All other files are forbidden, including:

```text
.flue/models.ts
.flue/research/budget.ts
.flue/research/runtime.ts
.flue/research/market-policy.ts
.flue/research/audit.ts
.flue/research/ledger.ts
.flue/providers/**
.flue/tools/research-tools.ts
.flue/workflows/**
.flue/actions/**
.flue/agents/profiles/**
wrangler.jsonc
.dev.vars
package-lock.json
```

If implementation appears to require a forbidden file, stop that task and revise this plan before editing it.

## Stable Existing Behavior

The following must still pass unchanged:

- discovery creates one independent task per foundation market;
- rejected briefs do not enter article research;
- provider budgets and request limits remain enforced by existing tools;
- a region failure does not cancel another article;
- audit cost and token totals remain identical for the same event fixture;
- `PASS` still requires the five existing required review dimensions to score at least two.

---

### Task 1: Define the Evidence Contracts

**Files:**

- Modify: `.flue/research/schemas.ts:152-207`
- Modify: `.flue/research/schemas.ts:335-373`
- Modify: `.flue/research/schemas.ts:510-574`
- Modify: `tests/fixtures/research/discovery-portfolio.json`
- Modify: `tests/fixtures/research/region-results.json`
- Modify: `tests/research/audit.test.ts`
- Modify: `tests/research/schemas.test.ts`

**Interfaces:**

- Consumes: existing `MarketSchema`, `SourceAuditSchema`, `ArticleResearchBriefSchema`, and `ClaimCandidateSchema`.
- Produces: `EvidenceRequirement`, `EvidenceReadinessReport`, and `ResearchRemediationBrief`, which Tasks 3–6 consume.

**Mutation boundary:**

- Add fields only to `ClaimCandidateSchema`, `ArticleResearchBriefSchema`, `NormalizedArticleResearchPacketSchema`, `ReviewInputSchema`, and `ArticleResearchOutcomeSchema`.
- Do not add fields to `SourceRecordSchema`, `EvidenceExcerptSchema`, `ProviderCallReceiptSchema`, or `DiscoveryRunRequestSchema`.

- [ ] **Step 1: Add failing schema tests with these exact test names**

```ts
it('requires a high-materiality evidence requirement on every article brief', () => {});
it('rejects an evidence requirement assigned outside the brief markets', () => {});
it('rejects duplicate evidence requirement IDs inside one brief', () => {});
it('requires target domains for a source rule that permits primary evidence', () => {});
it('requires at least one anchor on high-materiality requirements', () => {});
it('requires material factual claims to name their evidence requirements', () => {});
it('accepts null readiness on an article that failed before evidence audit', () => {});
```

Use `v.safeParse` in each test. Do not cast malformed objects through `unknown`.

- [ ] **Step 2: Run the schema tests and confirm the missing-contract failure**

Run:

```bash
npx vitest run tests/research/schemas.test.ts
```

Expected: FAIL because the new schema exports and fields do not exist.

- [ ] **Step 3: Add these exact schema exports before `ClaimCandidateSchema`**

```ts
export const EvidenceSourceRuleSchema = v.picklist([
	'primary',
	'independent-secondary',
	'primary-or-two-independent-secondary',
]);
export type EvidenceSourceRule = v.InferOutput<typeof EvidenceSourceRuleSchema>;

export const EvidenceRequirementSchema = v.pipe(
	v.object({
		requirementId: v.pipe(v.string(), v.minLength(1)),
		market: MarketSchema,
		question: v.pipe(v.string(), v.minLength(1)),
		materiality: v.picklist(['low', 'medium', 'high']),
		sourceRule: EvidenceSourceRuleSchema,
		targetDomains: v.array(v.pipe(v.string(), v.minLength(1))),
		anchors: v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
		timeBound: v.boolean(),
	}),
	v.check(
		(value) =>
			value.sourceRule === 'independent-secondary' ||
			value.targetDomains.length > 0,
		'Primary-capable source rules require a target domain',
	),
	v.check(
		(value) => value.materiality !== 'high' || value.anchors.length > 0,
		'High-materiality requirements require at least one anchor',
	),
);
export type EvidenceRequirement = v.InferOutput<typeof EvidenceRequirementSchema>;
```

- [ ] **Step 4: Add exact fields to existing schemas**

Add to `ClaimCandidateSchema`:

```ts
requirementIds: v.array(v.string()),
```

Add a check requiring at least one `requirementId` when `kind === 'fact'` and `materiality !== 'low'`.

Add to `ArticleResearchBriefSchema`:

```ts
evidenceRequirements: v.pipe(v.array(EvidenceRequirementSchema), v.minLength(1)),
```

Add checks that:

```ts
brief.evidenceRequirements.some((item) => item.materiality === 'high')
brief.evidenceRequirements.every((item) => brief.markets.includes(item.market))
new Set(brief.evidenceRequirements.map((item) => item.requirementId)).size ===
	brief.evidenceRequirements.length
```

- [ ] **Step 5: Add these exact readiness schemas after `SourceAuditSchema`**

```ts
export const RequirementReadinessSchema = v.object({
	requirementId: v.string(),
	market: MarketSchema,
	status: v.picklist(['satisfied', 'missing', 'weak', 'contradicted']),
	sourceIds: v.array(v.string()),
	evidenceIds: v.array(v.string()),
	missingAnchors: v.array(v.string()),
	reasonCodes: v.array(v.string()),
});

export const EvidenceReadinessReportSchema = v.object({
	briefId: v.string(),
	ready: v.boolean(),
	requirements: v.array(RequirementReadinessSchema),
	unsupportedMaterialClaimIds: v.array(v.string()),
	unsubstantiatedMaterialClaimIds: v.array(v.string()),
	blockingReasonCodes: v.array(v.string()),
});
export type EvidenceReadinessReport = v.InferOutput<typeof EvidenceReadinessReportSchema>;

export const ResearchRemediationBriefSchema = v.object({
	briefId: v.string(),
	market: MarketSchema,
	requirementIds: v.pipe(v.array(v.string()), v.minLength(1)),
	questions: v.pipe(v.array(v.string()), v.minLength(1)),
	sourceRules: v.pipe(v.array(EvidenceSourceRuleSchema), v.minLength(1)),
	targetDomains: v.array(v.string()),
	missingAnchors: v.array(v.string()),
	excludedUrls: v.array(v.string()),
	maxSearches: v.literal(2),
	maxFetches: v.literal(3),
});
export type ResearchRemediationBrief = v.InferOutput<typeof ResearchRemediationBriefSchema>;
```

- [ ] **Step 6: Add readiness to pipeline payload schemas**

Use these exact fields:

```ts
// ArticleResearchOutcomeSchema
readiness: v.nullable(EvidenceReadinessReportSchema),

// NormalizedArticleResearchPacketSchema
readiness: EvidenceReadinessReportSchema,

// ReviewInputSchema
readiness: EvidenceReadinessReportSchema,
```

Do not make `sourceAudit`, `structuralPacket`, or `review` optional.

- [ ] **Step 7: Update only the two affected fixtures**

In `discovery-portfolio.json`, add one evidence requirement to every brief. Its `market` must match the brief's single market and its target domain must come from that market's existing source target.

In `region-results.json`, add `requirementIds` to every claim:

- material facts reference the fixture brief's high-materiality requirement;
- low-materiality claims may use an empty array;
- do not change statements, statuses, or evidence IDs.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npx vitest run tests/research/schemas.test.ts tests/research/pipeline.test.ts tests/research/invariants.test.ts
```

Expected: schema tests pass; pipeline tests fail only where fake outcomes now require `readiness`.

---

### Task 2: Align the Three Agent Contracts and Four Skills

**Files:**

- Modify: `.flue/research/prompts/discovery-orchestrator.md`
- Modify: `.flue/research/prompts/brief-validator.md`
- Modify: `.flue/research/prompts/region-researcher.md`
- Modify: `.flue/skills/scan-market-signals/SKILL.md`
- Modify: `.flue/skills/validate-research-briefs/SKILL.md`
- Modify: `.flue/skills/research-regional-evidence/SKILL.md`
- Modify: `.flue/skills/review-research-packets/SKILL.md`
- Modify: `tests/research/profiles.test.ts`

**Interfaces:**

- Consumes: the Task 1 field names exactly.
- Produces: discovery briefs and regional claims that parse without application-side repair.

**Mutation boundary:**

- Append or edit only the output-contract sections.
- Keep every existing boundary, tool restriction, search limit, and stop condition.
- Do not change `.flue/agents/profiles/*.ts`; those files already import these prompts.

- [ ] **Step 1: Add prompt-contract assertions**

Add tests that read the three prompt Markdown files and assert the presence of these literal field names:

```text
evidenceRequirements
requirementId
sourceRule
targetDomains
anchors
timeBound
requirementIds
```

Assert `region-researcher.md` contains both:

```text
remediationBrief
Do not search for requirements outside remediationBrief.requirementIds
```

- [ ] **Step 2: Update the discovery prompt and discovery skill**

Add this contract, without changing discovery tool limits:

```text
For every proposed brief, produce evidenceRequirements.
Each high-materiality requirement must name one assigned market, one precise
question, a sourceRule, at least one target domain when primary evidence is
allowed, at least one literal anchor, and whether the fact is time-bound.
Do not create a requirement for another market.
```

Add the same rules under `Candidate Standard` in `scan-market-signals/SKILL.md`.

- [ ] **Step 3: Update the validator prompt and validator skill**

Add this exact decision rule:

```text
REFINE a brief when its evidenceRequirements are vague, cross-market, missing
a high-materiality requirement, missing a primary target domain, or missing
literal anchors. REJECT it when the authoritative source cannot be named and
two independent Tier 2 sources would not be sufficient.
```

The validator continues to return `BriefValidation`; it does not return a new schema.

- [ ] **Step 4: Update the regional prompt and regional skill**

Add:

```text
Every medium- or high-materiality factual ClaimCandidate must list the
requirementIds it answers. Retained evidence must contain the literal anchors
for those requirements. In remediation phase, use only the supplied
remediationBrief. Do not reopen satisfied requirements. Do not fetch a URL in
remediationBrief.excludedUrls.
```

Do not instruct the model to calculate readiness; application code owns that decision.

- [ ] **Step 5: Narrow reviewer skill responsibility**

Add under `Boundaries` in `review-research-packets/SKILL.md`:

```text
The deterministic readiness result is binding. Never return PASS when
readiness.ready is false. Do not request web remediation for an analytical
weakness; list it as a review reason.
```

Do not alter the reviewer scoring dimensions.

- [ ] **Step 6: Run profile tests**

Run:

```bash
npx vitest run tests/research/profiles.test.ts
```

Expected: PASS.

---

### Task 3: Implement the Pure Evidence-Readiness Evaluator

**Files:**

- Create: `.flue/research/evidence-readiness.ts`
- Create: `tests/research/evidence-readiness.test.ts`

**Interfaces:**

- Consumes:

```ts
evaluateEvidenceReadiness(
	brief: ArticleResearchBrief,
	sourceAudit: SourceAudit,
	window: DiscoveryRunRequest['window'],
): EvidenceReadinessReport
```

- Produces: one deterministic `EvidenceReadinessReport`.

**Mutation boundary:**

- This file may import only from `./schemas`.
- It may not import a provider, tool, model, audit emitter, ledger, or Node API.
- It may not mutate `brief` or `sourceAudit`.

- [ ] **Step 1: Write these exact tests**

```ts
it('satisfies a requirement only when all anchors appear in linked evidence', () => {});
it('does not accept a valid evidence ID whose excerpt lacks the material number', () => {});
it('requires a primary linked source on an allowed target domain', () => {});
it('accepts two secondary sources only from different publishers and hosts', () => {});
it('does not count two URLs from one publisher as independent sources', () => {});
it('blocks a material factual claim with no requirement ID', () => {});
it('blocks a material factual claim whose requirement ID does not exist', () => {});
it('blocks social-only evidence for a material fact', () => {});
it('blocks stale evidence for a time-bound requirement', () => {});
it('keeps old evidence eligible for a non-time-bound background requirement', () => {});
it('returns requirements in the same order as the brief', () => {});
it('does not mutate its inputs', () => {});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
npx vitest run tests/research/evidence-readiness.test.ts
```

Expected: FAIL because `evaluateEvidenceReadiness` is not defined.

- [ ] **Step 3: Implement these private helpers**

```ts
function normalizeText(value: string): string
function normalizeHost(value: string): string
function normalizedPublisher(source: SourceRecord): string
function evidenceForRequirement(
	requirementId: string,
	sourceAudit: SourceAudit,
): EvidenceExcerpt[]
function sourceRuleSatisfied(
	requirement: EvidenceRequirement,
	sources: SourceRecord[],
): boolean
```

`normalizeText` performs only:

- Unicode NFKC normalization;
- lower-casing;
- whitespace collapse;
- removal of commas between digits;
- conversion of `₦`, `NGN`, `GH₵`, and `GHS` to stable currency tokens.

Do not add written-number conversion or fuzzy matching in this sprint. Anchors must be authored in a form expected to appear in evidence.

- [ ] **Step 4: Implement the exact passing rule**

A requirement is `satisfied` only when:

1. at least one claim references its `requirementId`;
2. at least one supporting evidence record exists for those claims;
3. every normalized anchor appears in at least one linked evidence excerpt;
4. every linked evidence points to a retained source;
5. the linked sources satisfy `sourceRule`;
6. no linked contradicting evidence exists;
7. if `timeBound` is true, at least one qualifying source has `publishedAt` inside the request window.

Status selection order:

```text
contradicted -> contradicted
no claim/evidence/source -> missing
anchors or source rule fail -> weak
all seven rules pass -> satisfied
```

`ready` is true only when:

- every high-materiality requirement is satisfied;
- every medium/high factual claim is supported;
- `unsupportedMaterialClaimIds` and `unsubstantiatedMaterialClaimIds` are empty.

- [ ] **Step 5: Use only these reason codes**

```text
requirement_no_claim
requirement_no_evidence
requirement_missing_source
requirement_anchor_missing
requirement_source_rule_failed
requirement_contradicted
requirement_outside_window
claim_missing_requirement
claim_unknown_requirement
claim_not_supported
claim_evidence_unsubstantiated
claim_social_only
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/research/evidence-readiness.test.ts
```

Expected: all Task 3 tests pass.

---

### Task 4: Build One Bounded Remediation Brief per Affected Market

**Files:**

- Create: `.flue/research/remediation.ts`
- Create: `tests/research/remediation.test.ts`

**Interfaces:**

- Consumes:

```ts
buildRemediationBriefs(
	brief: ArticleResearchBrief,
	sourceAudit: SourceAudit,
	readiness: EvidenceReadinessReport,
): ResearchRemediationBrief[]
```

- Produces: zero or one remediation brief per market, ordered by `brief.markets`.

**Mutation boundary:**

- Pure transformation only.
- No prompt generation, network calls, model calls, or budget allocation.

- [ ] **Step 1: Write these exact tests**

```ts
it('returns no remediation brief when readiness passes', () => {});
it('groups failed requirements by their assigned market', () => {});
it('does not include satisfied requirements', () => {});
it('copies questions, source rules, target domains, and missing anchors', () => {});
it('excludes every canonical URL already present in the source audit', () => {});
it('sets maxSearches to two and maxFetches to three', () => {});
it('returns markets in brief order and removes duplicate values', () => {});
```

- [ ] **Step 2: Implement the builder**

Use this exact selection:

```ts
const blockedIds = new Set(
	readiness.requirements
		.filter((item) => item.status !== 'satisfied')
		.map((item) => item.requirementId),
);
const blockedRequirements = brief.evidenceRequirements.filter((item) =>
	blockedIds.has(item.requirementId),
);
```

For each affected market:

- `requirementIds` comes from `blockedRequirements`;
- `questions` comes from the matching requirements;
- `sourceRules` comes from the matching requirements;
- `targetDomains` is the unique union of matching requirements;
- `missingAnchors` comes from the matching readiness records;
- `excludedUrls` is every `sourceAudit.sources[].canonicalUrl`;
- limits are literals `2` and `3`.

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run tests/research/remediation.test.ts
```

Expected: PASS.

---

### Task 5: Pass Remediation Contracts Through the Existing Regional Agent

**Files:**

- Modify: `.flue/research/pipeline.ts:47-61`
- Modify: `.flue/research/delegation.ts:320-356`
- Modify: `tests/research/delegation.test.ts`

**Interfaces:**

- Consumes: `ResearchRemediationBrief`.
- Produces: unchanged `ArticleRegionResearchResult`.

**Mutation boundary:**

- Change no session name, agent profile, tool list, result schema, ledger reconciliation, or model role.

- [ ] **Step 1: Change only the `ResearchDelegator.research` signature**

Replace its option type with:

```ts
options?: {
	phase?: 'deep-research' | 'remediation';
	remediationBrief?: ResearchRemediationBrief;
}
```

Add a type-level or runtime check that `phase === 'remediation'` requires `remediationBrief`, and deep research must not receive one.

- [ ] **Step 2: Change only the regional task payload**

In `createFlueResearchDelegator().research`, replace:

```ts
JSON.stringify({ brief, market })
```

with:

```ts
JSON.stringify({
	brief,
	market,
	phase,
	...(options?.remediationBrief
		? { remediationBrief: options.remediationBrief }
		: {}),
})
```

Before creating the session, throw when:

```ts
phase === 'remediation' && options?.remediationBrief?.market !== market
```

- [ ] **Step 3: Test payload and market rejection**

Add tests proving:

- normal deep research payload has no `remediationBrief`;
- remediation payload contains the exact supplied object;
- Ghana remediation cannot be passed to Nigeria;
- the existing `article:<briefId>:region:<market>` session name remains unchanged.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run tests/research/delegation.test.ts
```

Expected: PASS.

---

### Task 6: Enforce Readiness Before Analysis and Review

**Files:**

- Modify: `.flue/research/pipeline.ts:375-545`
- Modify: `.flue/research/review.ts:24-62`
- Modify: `tests/research/pipeline.test.ts`
- Modify: `tests/research/invariants.test.ts`

**Interfaces:**

- Consumes: `evaluateEvidenceReadiness` and `buildRemediationBriefs`.
- Produces: article outcomes with `readiness`, plus analysis/review only on ready packets.

**Mutation boundary:**

- In `pipeline.ts`, edit only `processArticle` and `failedArticleOutcome`.
- Keep `executeResearchPipeline`, concurrency, allocation, discovery, validation, `resolveRunStatus`, and `resolveArticleStatus` unchanged.

- [ ] **Step 1: Replace the existing remediation-order test with three call-order tests**

Use mocked methods and an ordered string array. Assert these exact sequences:

```ts
['research', 'analyze', 'review']
```

for a first-pass-ready packet;

```ts
['research', 'remediation', 'analyze', 'review']
```

for a packet that passes after remediation;

```ts
['research', 'remediation']
```

for a packet still blocked after remediation.

`auditArticleResearch` and the pure readiness check are application functions, not delegator calls, so they do not appear in the mock list.

- [ ] **Step 2: Add explicit cost-avoidance assertions**

For a packet blocked after remediation:

```ts
expect(delegator.analyze).not.toHaveBeenCalled();
expect(delegator.review).not.toHaveBeenCalled();
expect(result.articles[0].status).toBe('needs-more-research');
expect(result.articles[0].structuralPacket).toBeNull();
expect(result.articles[0].review).toBeNull();
expect(result.articles[0].readiness?.ready).toBe(false);
```

- [ ] **Step 3: Replace only the middle of `processArticle`**

Add this final parameter to `processArticle`:

```ts
window: DiscoveryRunRequest['window'],
```

Change its single invocation inside `executeResearchPipeline` to pass `input.window`:

```ts
processArticle(
	deps,
	brief,
	validation,
	allocation,
	budgetAlloc.deepResearch / Math.max(accepted.length, 1),
	clock,
	input.window,
)
```

After initial `regionResults`, implement this sequence:

```ts
let sourceAudit = await auditArticleResearch(brief, regionResults);
let readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);

if (!readiness.ready) {
	const remediationBriefs = buildRemediationBriefs(brief, sourceAudit, readiness);
	for (const remediationBrief of remediationBriefs) {
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
	}
	sourceAudit = await auditArticleResearch(brief, regionResults);
	readiness = evaluateEvidenceReadiness(brief, sourceAudit, window);
}

if (!readiness.ready) {
	return {
		brief,
		validation,
		status: 'needs-more-research',
		regionResults,
		sourceAudit,
		readiness,
		structuralPacket: null,
		review: null,
		execution: executionRecordsFor(deps, brief.briefId),
	};
}
```

Do not change any other `PipelineDeps` member.

- [ ] **Step 4: Create the packet only after readiness passes**

Use:

```ts
const packet: NormalizedArticleResearchPacket = {
	brief,
	sourceAudit,
	regionResults,
	readiness,
};
const structuralPacket = await deps.delegator.analyze(packet);
const reviewInput: ReviewInput = {
	brief,
	sourceAudit,
	readiness,
	structuralPacket,
	proposedOutputType: determineOutputType(brief),
};
```

Remove the existing reviewer-triggered web-remediation block entirely. A reviewer may return `NEEDS_MORE_RESEARCH`, but that decision ends the article in this sprint.

- [ ] **Step 5: Make deterministic readiness binding in `review.ts`**

Change the signature to:

```ts
export function reconcileReviewWithEvidence(
	review: ReviewReport,
	structuralPacket: StructuralPacket,
	sourceAudit: SourceAudit,
	readiness: EvidenceReadinessReport,
): ReviewReport
```

Before the existing source/evidence-ID checks, return `NEEDS_MORE_RESEARCH` when `readiness.ready` is false. Add the exact missing item:

```text
Deterministic evidence readiness blocked PASS
```

Append one missing item per `blockingReasonCodes` value. Do not modify a model-issued `REJECT`.

- [ ] **Step 6: Make failure outcomes explicit**

In `failedArticleOutcome`, set:

```ts
readiness: null,
```

Every other accepted article outcome must have non-null readiness.

- [ ] **Step 7: Run focused pipeline tests**

Run:

```bash
npx vitest run tests/research/pipeline.test.ts tests/research/invariants.test.ts
```

Expected: PASS with one analysis and one review on a ready article, and zero on an unready article.

---

### Task 7: Add Readiness Decisions to the Existing Audit Event

**Files:**

- Modify: `.flue/research/run-audit.ts:29-120`
- Modify: `.flue/research/run-audit.ts:330-350`
- Modify: `.flue/research/pipeline.ts:375-545`
- Modify: `scripts/lib/research-audit-projection.mjs`
- Modify: `scripts/lib/research-audit-format.mjs`
- Modify: `tests/research/run-audit-events.test.ts`
- Modify: `tests/research/run-audit-projection.test.ts`
- Modify: `tests/research/run-audit-cli.test.ts`

**Interfaces:**

- Consumes: readiness and remediation results from Task 6.
- Produces: existing `decision_recorded` events with additive fields.

**Mutation boundary:**

- Keep `RESEARCH_AUDIT_SCHEMA_VERSION` at `'1'` because fields are additive.
- Keep `ResearchAuditEventName` unchanged.
- Do not change watcher feed states, terminal handling, provider totals, LLM totals, or redaction.

- [ ] **Step 1: Extend only decision attributes**

Add to `ResearchAuditAttributes`:

```ts
entityId: string | null;
reasonCodes: string[];
```

Set defaults in `baseAttributes`:

```ts
entityId: null,
reasonCodes: [],
```

Change only `recordDecision`:

```ts
recordDecision(params: {
	kind: string;
	decision: string;
	briefId?: string | null;
	market?: Market | null;
	entityId?: string | null;
	reasonCodes?: string[];
	phase?: string;
	counts?: Record<string, number>;
}): void;
```

Change `deriveDecisionAuditId` to accept `entityId`. Preserve every existing decision ID when `entityId` is null; append it only for requirement-level decisions:

```ts
const base = `decision:${runKey}:${kind}:${briefId ?? 'none'}`;
return entityId ? `${base}:${entityId}` : base;
```

- [ ] **Step 2: Emit exact readiness decisions from `processArticle`**

After each readiness evaluation, emit one decision per requirement:

```ts
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
```

Also emit one article-level decision:

```ts
kind: 'evidence-readiness'
decision: readiness.ready ? 'passed' : 'blocked'
entityId: brief.briefId
```

- [ ] **Step 3: Project additive fields**

In `createAuditProjection().ingest`, retain `entityId` and `reasonCodes` only for `decision_recorded`. Add to the report:

```ts
readiness: {
	byArticle: Record<string, {
		status: 'passed' | 'blocked';
		markets: Market[];
		outcomeStatus: string | null;
		satisfied: number;
		total: number;
		remediationPasses: number;
		analysisCalls: number;
	}>;
}
```

Build `markets` from requirement decisions, `outcomeStatus` from the existing `article-outcome` decision, and `analysisCalls` from terminal `structural-analysis` stages. Do not recalculate cost, tokens, provider attempts, or elapsed time.

- [ ] **Step 4: Add one formatter**

Export:

```js
export function formatArticleReadinessLine(article)
```

Exact output:

```text
Nigeria article | needs-more-research | readiness 7/9 | remediation 1 | analysis skipped
```

The input is one `report.readiness.byArticle[briefId]` object. Title-case and comma-join `markets`; use `n/a` when market or status is absent; print `analysis skipped` when `analysisCalls === 0`, otherwise `analysis <count>`.

Call this formatter from `formatLiveLine` only when the incoming audit event is an article-level `evidence-readiness` or `article-outcome` decision. Do not alter `formatWatcherStatus`.

- [ ] **Step 5: Run audit tests**

Run:

```bash
npx vitest run tests/research/run-audit-events.test.ts tests/research/run-audit-projection.test.ts tests/research/run-audit-cli.test.ts
```

Expected: PASS and existing cost/token fixture snapshots remain unchanged except for additive readiness fields.

---

### Task 8: Full Verification and Scope Audit

**Files:**

- No production changes.
- Update only test expectations if a failure is caused by the additive schema fields defined above.

**Interfaces:**

- Consumes: Tasks 1–7.
- Produces: evidence that the implementation stayed inside this plan.

- [ ] **Step 1: Run the complete verification sequence**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all commands exit zero.

- [ ] **Step 2: Run the forbidden-file audit**

Because this workspace is not currently a Git worktree, record the touched-file list during implementation. Confirm no file outside the File Responsibility and Mutation Map changed.

- [ ] **Step 3: Run the normal-path call-count assertion**

The focused pipeline test must prove:

```text
ready on first pass: 1 regional research, 0 remediation, 1 analysis, 1 review
ready after remediation: 1 regional research, 1 remediation, 1 analysis, 1 review
blocked after remediation: 1 regional research, 1 remediation, 0 analysis, 0 review
```

- [ ] **Step 4: Check required outcomes**

- An evidence ID without matching anchor text cannot pass.
- Primary-source rules inspect only linked sources, not unrelated ledger entries.
- Remediation receives exact requirement IDs and one market.
- No reviewer-triggered web research remains.
- The audit explains readiness before and after remediation.
- Provider budgets, search limits, models, and foundation markets are unchanged.

## Definition of Done

This plan is complete only when all eight tasks pass and every changed production line falls inside the mutation map. Discovery and regional research still operate independently for Nigeria and Ghana, but expensive analysis and review cannot run on a deterministically weak evidence packet.
