# Research Quality Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one attributable, evidence-ready article from either Nigeria or Ghana without wasting provider calls, then prove the same pipeline can produce one article per market.

**Architecture:** Keep discovery, validation, regional research, remediation, readiness, and audit as separate stages. Pass retained evidence across every boundary, preserve each evidence requirement as its own contract, and make local limits fail without consuming unused capacity. The quality gate remains fail-closed: unsupported claims stop before structural analysis.

**Tech Stack:** TypeScript, Valibot, Flue Runtime, Vitest, Cloudflare Workers, Exa, Apify.

## Global Constraints

- Foundation markets remain `nigeria` and `ghana`.
- NDIC is a Nigeria Tier 1 primary source for deposit insurance, bank resolution, liquidation, licence revocation, and failed-institution claims.
- SEC Nigeria is a Nigeria Tier 1 primary source for securities issuance and capital-market fundraising claims.
- One controlled quality run accepts one article total before testing two accepted articles.
- Discovery remains capped at two searches and four fetches per market.
- Deep research increases to six searches and eight fetches per article-market pair.
- Remediation increases to three searches and five fetches per article-market pair.
- A rejected local tool request must not consume provider budget or unused fetch capacity.
- Search snippets remain leads; only retained evidence can satisfy a requirement.
- Never convert an unsupported number into a supported claim through fuzzy matching.

---

## File Map

- `.flue/research/market-policy.ts`: canonical market source tiers.
- `.flue/skills/african-financial-intelligence-pipeline/references/source-map.md`: human-readable source policy.
- `.flue/research/schemas.ts`: validation input and remediation contract schemas.
- `.flue/research/pipeline.ts`: evidence handoff, article processing, and final artifact accounting.
- `.flue/research/delegation.ts`: task payloads and phase-specific session identities.
- `.flue/tools/research-tools.ts`: validator search output and local search/fetch limits.
- `.flue/research/evidence-anchor-matcher.ts`: exact, deterministic anchor normalization.
- `.flue/research/evidence-readiness.ts`: source, anchor, and time checks.
- `.flue/research/remediation.ts`: requirement-specific remediation briefs.
- `.flue/research/prompts/brief-validator.md`: evidence-aware validation instructions.
- `.flue/research/prompts/discovery-orchestrator.md`: claim-specific source-target rules.
- `.flue/research/prompts/region-researcher.md`: requirement-first search and fetch order.
- `.flue/skills/research-regional-evidence/SKILL.md`: regional researcher limits and stop rules.
- `scripts/lib/research-audit-projection.mjs`: task, tool-limit, and artifact projection.
- Tests under `tests/research/`: one focused test file per changed component.

---

### Task 1: Correct Nigeria Primary-Source Contracts

**Files:**
- Modify: `.flue/research/market-policy.ts`
- Modify: `.flue/skills/african-financial-intelligence-pipeline/references/source-map.md`
- Modify: `.flue/research/prompts/discovery-orchestrator.md`
- Modify: `.flue/research/prompts/brief-validator.md`
- Test: `tests/research/market-policy.test.ts`
- Test: `tests/research/evidence-readiness.test.ts`

**Interfaces:**
- Consumes: `MARKET_POLICIES`, `EvidenceRequirement.targetDomains`.
- Produces: `getTier1Domains(market: Market): readonly string[]` and claim-specific target-domain rules used by discovery and validation.

- [ ] **Step 1: Write failing policy tests**

Add assertions that Nigeria Tier 1 contains `cbn.gov.ng`, `ndic.gov.ng`, and `sec.gov.ng`. Add a readiness fixture where a primary NDIC revocation notice satisfies a requirement whose target domains contain `ndic.gov.ng`.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npx vitest run tests/research/market-policy.test.ts tests/research/evidence-readiness.test.ts
```

Expected: the new NDIC readiness case fails until the requirement fixture and policy instructions accept NDIC as the primary target.

- [ ] **Step 3: Export the Tier 1 lookup**

Add this interface to `.flue/research/market-policy.ts`:

```ts
export function getTier1Domains(market: Market): readonly string[] {
	return MARKET_POLICIES[market].tier1Domains;
}
```

Do not add a separate trusted-domain list.

- [ ] **Step 4: Make source targeting claim-specific**

Update the two prompts with these exact rules:

```markdown
- Set targetDomains to the institutions authoritative for that requirement.
- Nigeria examples: CBN for banking rules and licensing; NDIC for deposit
  insurance, resolution, liquidation, and revoked institutions; SEC Nigeria
  for securities issuance and capital-market fundraising; NGX/FMDQ for their
  own market notices.
- Do not assign cbn.gov.ng to every Nigeria requirement.
- When retained discovery evidence comes from a Tier 1 source that is
  authoritative for the requirement, include that source host in targetDomains.
```

Add NDIC explicitly to the Tier 1 section of `source-map.md`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/research/market-policy.test.ts tests/research/evidence-readiness.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .flue/research/market-policy.ts .flue/skills/african-financial-intelligence-pipeline/references/source-map.md .flue/research/prompts/discovery-orchestrator.md .flue/research/prompts/brief-validator.md tests/research/market-policy.test.ts tests/research/evidence-readiness.test.ts
git commit -m "fix: align Nigeria evidence requirements with primary sources"
```

---

### Task 2: Pass Retained Discovery Evidence Into Brief Validation

**Files:**
- Modify: `.flue/research/schemas.ts`
- Modify: `.flue/research/pipeline.ts`
- Modify: `.flue/research/delegation.ts`
- Modify: `.flue/tools/research-tools.ts`
- Modify: `.flue/research/prompts/brief-validator.md`
- Test: `tests/research/delegation.test.ts`
- Test: `tests/research/pipeline.test.ts`

**Interfaces:**
- Produces:

```ts
interface BriefValidationInput {
	brief: ArticleResearchBrief;
	sources: SourceRecord[];
	evidence: EvidenceExcerpt[];
}
```

- Changes:

```ts
validateBrief(input: BriefValidationInput): Promise<BriefValidation>
```

- [ ] **Step 1: Write failing delegation tests**

Create a brief with one discovery source ID and one discovery evidence ID. Assert that the validator task payload contains only the linked source and evidence records, including the evidence text.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npx vitest run tests/research/delegation.test.ts tests/research/pipeline.test.ts
```

Expected: FAIL because `validateBrief` currently receives and serializes only the brief.

- [ ] **Step 3: Add the validation input schema and type**

In `.flue/research/schemas.ts`, add:

```ts
export const BriefValidationInputSchema = v.object({
	brief: ArticleResearchBriefSchema,
	sources: v.array(SourceRecordSchema),
	evidence: v.array(EvidenceExcerptSchema),
});
export type BriefValidationInput = v.InferOutput<typeof BriefValidationInputSchema>;
```

- [ ] **Step 4: Build the filtered input in the pipeline**

Add a pure helper that selects only `brief.discoverySourceIds` and `brief.discoveryEvidenceIds` from the discovery portfolio. Use it for the initial validation and revalidation calls.

- [ ] **Step 5: Send the complete input to the validator**

Change delegation to serialize `BriefValidationInput`. Change validator search results from `{url, title}` to `{url, title, highlights}` so the verification search does not discard its supporting text.

- [ ] **Step 6: Tighten the validator decision rule**

Add:

```markdown
- ACCEPT only when every material fact asserted in signalSummary or thesis is
  present in retained discovery evidence or in the one verification search.
- Treat verification highlights as signal confirmation, not article evidence.
- REFINE when a number, date, named institution, or comparison in the proposed
  signal is absent from the supplied evidence.
- requestedSourceTargets must name the authority appropriate to each blocked
  requirement.
```

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run tests/research/delegation.test.ts tests/research/pipeline.test.ts
```

Expected: PASS, including initial validation and revalidation payload tests.

- [ ] **Step 8: Commit**

```bash
git add .flue/research/schemas.ts .flue/research/pipeline.ts .flue/research/delegation.ts .flue/tools/research-tools.ts .flue/research/prompts/brief-validator.md tests/research/delegation.test.ts tests/research/pipeline.test.ts
git commit -m "fix: validate briefs against retained discovery evidence"
```

---

### Task 3: Make Anchor Matching Exact but Format-Aware

**Files:**
- Create: `.flue/research/evidence-anchor-matcher.ts`
- Modify: `.flue/research/evidence-readiness.ts`
- Modify: `.flue/research/prompts/discovery-orchestrator.md`
- Test: `tests/research/evidence-anchor-matcher.test.ts`
- Test: `tests/research/evidence-readiness.test.ts`

**Interfaces:**
- Produces:

```ts
export function evidenceContainsAnchor(evidenceText: string, anchor: string): boolean;
```

- [ ] **Step 1: Write failing anchor tests**

Cover:

```ts
expect(evidenceContainsAnchor('Thirty-three banks raised ₦4.65 trillion', '33')).toBe(true);
expect(evidenceContainsAnchor('72.55 per cent was domestic capital', '72.55%')).toBe(true);
expect(evidenceContainsAnchor('72.55 per cent was domestic capital', '70%')).toBe(false);
expect(evidenceContainsAnchor('Thirty-three banks complied', '37')).toBe(false);
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/research/evidence-anchor-matcher.test.ts
```

Expected: FAIL because the matcher does not exist.

- [ ] **Step 3: Implement deterministic normalization**

Normalize Unicode, case, thousands separators, `per cent` to `%`, supported currency spellings, and number words from zero through one hundred. Do not add approximate numeric, embedding, or substring-threshold matching.

- [ ] **Step 4: Replace the readiness-local matcher**

Remove `normalizeText` from `evidence-readiness.ts` and call `evidenceContainsAnchor` for each evidence/anchor pair.

- [ ] **Step 5: Require literal claim anchors at discovery**

Tell discovery to use `72.55%` when the source says 72.55%, not the weaker threshold `70%`. Text anchors should be the shortest attributable phrase, such as `domestic capital`.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/research/evidence-anchor-matcher.test.ts tests/research/evidence-readiness.test.ts
```

Expected: PASS. The unsupported denominator `37` must still fail.

- [ ] **Step 7: Commit**

```bash
git add .flue/research/evidence-anchor-matcher.ts .flue/research/evidence-readiness.ts .flue/research/prompts/discovery-orchestrator.md tests/research/evidence-anchor-matcher.test.ts tests/research/evidence-readiness.test.ts
git commit -m "fix: match evidence anchors across safe format variants"
```

---

### Task 4: Protect Fetch Capacity and Increase the Quality-Run Limits

**Files:**
- Modify: `.flue/tools/research-tools.ts`
- Modify: `.flue/research/prompts/region-researcher.md`
- Modify: `.flue/skills/research-regional-evidence/SKILL.md`
- Test: `tests/research/research-tools.test.ts`

**Interfaces:**
- Deep research limits: six searches, eight source attempts.
- Remediation limits: three searches, five source attempts.
- Oversized requests throw `ResearchToolTerminalError('fetch_sources', 'limit-reached')` without changing the existing fetch counter.

- [ ] **Step 1: Write failing counter tests**

For remediation, search and select four source IDs, attempt to fetch all four against a five-fetch cap after two successful fetches, and assert:

1. the oversized request is rejected;
2. no provider call occurs;
3. a subsequent request for the remaining three IDs succeeds.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
npx vitest run tests/research/research-tools.test.ts
```

Expected: FAIL because the oversized call currently sets `counters.fetches` to the maximum.

- [ ] **Step 3: Change the counter behavior and limits**

Use:

```ts
const MAX_DEEP_SEARCHES_PER_MARKET = 6;
const MAX_DEEP_FETCH_URLS_PER_MARKET = 8;
const MAX_REMEDIATION_SEARCHES = 3;
const MAX_REMEDIATION_FETCH_URLS = 5;
```

Remove the counter assignment from the over-limit branch:

```ts
if (counters.fetches + input.sourceIds.length > maxFetches) {
	stopToolUse(counters, 'fetch_sources', 'limit-reached');
}
```

Do not charge unknown or invalid source IDs against the fetch count; validate all selections before incrementing.

- [ ] **Step 4: Require a requirement-first evidence plan**

Update the prompt and skill:

```markdown
1. List every unsatisfied high- and medium-materiality requirement.
2. Run the primary-source searches needed to cover those requirements before
   spending all fetch attempts.
3. Reserve at least one fetch attempt for every unresolved high-materiality
   requirement.
4. Fetch context sources only after coverage sources have been selected.
5. Never send more sourceIds than the remaining fetch allowance.
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/research/research-tools.test.ts tests/research/invariants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .flue/tools/research-tools.ts .flue/research/prompts/region-researcher.md .flue/skills/research-regional-evidence/SKILL.md tests/research/research-tools.test.ts tests/research/invariants.test.ts
git commit -m "fix: preserve research fetch capacity"
```

---

### Task 5: Preserve Requirement Boundaries During Remediation

**Files:**
- Modify: `.flue/research/schemas.ts`
- Modify: `.flue/research/remediation.ts`
- Modify: `.flue/research/prompts/region-researcher.md`
- Modify: `.flue/skills/research-regional-evidence/SKILL.md`
- Test: `tests/research/remediation.test.ts`
- Test: `tests/research/delegation.test.ts`

**Interfaces:**
- Replace the flattened remediation arrays with:

```ts
interface RemediationRequirement {
	requirementId: string;
	question: string;
	sourceRule: EvidenceSourceRule;
	targetDomains: string[];
	missingAnchors: string[];
	reasonCodes: string[];
	currentSourceIds: string[];
	currentEvidenceIds: string[];
	refetchUrls: string[];
}
```

- `ResearchRemediationBrief` keeps `briefId`, `market`, `requirements`, `excludedUrls`, `maxSearches: 3`, and `maxFetches: 5`.

- [ ] **Step 1: Replace flattened-contract tests**

Assert that Nigeria and Ghana receive different remediation briefs and that each requirement retains its own domains, reason codes, anchors, and current evidence links.

Add a fixture where:

- an NDIC source has linked but incomplete evidence and appears in `refetchUrls`;
- an unrelated management-visit source has no linked evidence and appears in `excludedUrls`;
- a satisfied source appears in neither remediation requirement.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/research/remediation.test.ts tests/research/delegation.test.ts
```

Expected: FAIL against the current flattened remediation contract.

- [ ] **Step 3: Add the new schemas**

Add `RemediationRequirementSchema`, then change `ResearchRemediationBriefSchema` to use `requirements`, `maxSearches: v.literal(3)`, and `maxFetches: v.literal(5)`.

- [ ] **Step 4: Build refetch and exclusion sets**

For each blocked requirement:

- copy its own readiness reason codes and evidence links;
- allow refetch when the source is linked but the reason is `requirement_anchor_missing` or `requirement_no_evidence`;
- exclude duplicate, stale, or unlinked sources;
- never exclude every retained source by default.

- [ ] **Step 5: Bind remediation strictly to the new contract**

Update the prompt and skill to search only `remediationBrief.requirements`. Permit URLs in `refetchUrls`; forbid URLs in `excludedUrls`.

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run tests/research/remediation.test.ts tests/research/delegation.test.ts tests/research/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .flue/research/schemas.ts .flue/research/remediation.ts .flue/research/prompts/region-researcher.md .flue/skills/research-regional-evidence/SKILL.md tests/research/remediation.test.ts tests/research/delegation.test.ts tests/research/schemas.test.ts
git commit -m "fix: keep remediation scoped to failed evidence requirements"
```

---

### Task 6: Separate Source Recency From Event Recency

**Files:**
- Modify: `.flue/research/schemas.ts`
- Modify: `.flue/research/evidence-readiness.ts`
- Modify: `.flue/research/prompts/discovery-orchestrator.md`
- Test: `tests/research/evidence-readiness.test.ts`
- Test: `tests/research/schemas.test.ts`

**Interfaces:**
- Replace `timeBound: boolean` with:

```ts
recencyRule: 'none' | 'source-published-in-window' | 'event-occurred-in-window';
```

- [ ] **Step 1: Write failing recency tests**

Test that an NDIC notice published July 1 can support a July 22 signal when the requirement is not source-publication-bound. Test that a requirement with `source-published-in-window` still rejects the July 1 notice.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/research/evidence-readiness.test.ts tests/research/schemas.test.ts
```

Expected: FAIL because the schema has only `timeBound`.

- [ ] **Step 3: Implement the explicit rule**

Apply the publication date check only to `source-published-in-window`. Treat `event-occurred-in-window` as an evidence-contract responsibility: the event date must be one of the requirement anchors and must occur in the scan window.

- [ ] **Step 4: Update discovery instructions**

Require discovery to choose the recency rule per requirement. Do not mark background facts as source-publication-bound.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run tests/research/evidence-readiness.test.ts tests/research/schemas.test.ts
```

Expected: PASS.

```bash
git add .flue/research/schemas.ts .flue/research/evidence-readiness.ts .flue/research/prompts/discovery-orchestrator.md tests/research/evidence-readiness.test.ts tests/research/schemas.test.ts
git commit -m "fix: distinguish event recency from source publication"
```

---

### Task 7: Make the Audit Report Match the Executed Work

**Files:**
- Modify: `.flue/research/delegation.ts`
- Modify: `.flue/research/pipeline.ts`
- Modify: `scripts/lib/research-audit-projection.mjs`
- Modify: `scripts/lib/research-audit-report.mjs`
- Test: `tests/research/run-audit-events.test.ts`
- Test: `tests/research/run-audit-projection.test.ts`
- Test: `tests/research/run-audit-cli.test.ts`

**Interfaces:**
- Region session identity:

```ts
article:${briefId}:region:${market}:${phase}
```

- The final pipeline artifact event contains de-duplicated final source, evidence, claim, and receipt totals.
- Local terminal errors project as blocked statuses with `limit-reached` or `budget-exhausted`.

- [ ] **Step 1: Write failing projection tests**

Create one deep-research task and one remediation task for the same article and market. Assert that both stages remain in the projection. Add four final claims and assert `artifacts.claimCount === 4`.

- [ ] **Step 2: Add failing tool-limit tests**

Project a `ResearchToolTerminalError` with reason `limit-reached`. Assert `blockedCount === 1`, `errorCount === 1`, and `statusCounts['limit-reached'] === 1`.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
npx vitest run tests/research/run-audit-events.test.ts tests/research/run-audit-projection.test.ts tests/research/run-audit-cli.test.ts
```

Expected: FAIL because phases collide, final claims are not recorded, and thrown limits lack a projected status.

- [ ] **Step 4: Include phase in the region session identity**

Use separate Flue session names for deep research and remediation. Keep the agent profile the same.

- [ ] **Step 5: Record final artifacts**

At pipeline completion, de-duplicate the sources, evidence, claims, and receipts present in final article outcomes. Record those totals instead of discovery-only totals and remove the hard-coded `claims: 0`.

- [ ] **Step 6: Project local terminal reasons**

When a tool result is an error, parse the structured terminal reason from the recorded error metadata. Do not infer `budget-exhausted` from ordinary text.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npx vitest run tests/research/run-audit-events.test.ts tests/research/run-audit-projection.test.ts tests/research/run-audit-cli.test.ts
```

Expected: PASS.

```bash
git add .flue/research/delegation.ts .flue/research/pipeline.ts scripts/lib/research-audit-projection.mjs scripts/lib/research-audit-report.mjs tests/research/run-audit-events.test.ts tests/research/run-audit-projection.test.ts tests/research/run-audit-cli.test.ts
git commit -m "fix: report research stages and final artifacts accurately"
```

---

### Task 8: Add the Failed Run as an Offline Regression Case

**Files:**
- Create: `evals/research/cases/recapitalisation-evidence-contract.json`
- Modify: `evals/research/cases/suite.json`
- Modify: `docs/evals/research-audit-baseline.md`
- Test: `tests/evals/research/schema.test.ts`

**Interfaces:**
- The fixture contains five requirements corresponding to run `run_01KY9TQT4SAPHE0DAWE1HEJ8RS`.
- Expected result before missing evidence is added: one satisfied, three weak, one missing.
- Expected result after corrected NDIC/SEC evidence is added: four satisfied; the unsupported `37` requirement remains blocked.

- [ ] **Step 1: Create the sanitized fixture**

Include source metadata, short evidence excerpts, claims, and readiness expectations. Do not include prompts, API keys, raw model thinking, or full fetched pages.

- [ ] **Step 2: Add two assertions**

The first assertion proves the gate rejects unsupported claims. The second proves NDIC and SEC evidence can pass with correct domains and literal anchors.

- [ ] **Step 3: Run the offline suite**

Run:

```bash
npm run eval:research:offline
```

Expected: PASS with no provider calls.

- [ ] **Step 4: Run the full repository check**

Run:

```bash
npm run check
```

Expected: typecheck, tests, and build all pass.

- [ ] **Step 5: Commit**

```bash
git add evals/research/cases/recapitalisation-evidence-contract.json evals/research/cases/suite.json docs/evals/research-audit-baseline.md tests/evals/research/schema.test.ts
git commit -m "test: preserve recapitalisation evidence failure as regression"
```

---

### Task 9: Run the Controlled Quality Evaluation

**Files:**
- No source changes.
- Export result to: `research-runs/scan-quality-2026-07-24-001/<runId>/audit.json`
- Export report to: `research-runs/scan-quality-2026-07-24-001/<runId>/audit.md`

**Interfaces:**
- Input:

```json
{
  "runKey": "scan-quality-2026-07-24-001",
  "trigger": "manual",
  "window": {
    "start": "2026-07-22T00:00:00Z",
    "end": "2026-07-24T00:00:00Z"
  },
  "focus": null,
  "maxDiscoveredBriefs": 2,
  "maxAcceptedBriefs": 1,
  "maxProviderCostUsd": 1,
  "maxProviderRequests": 40
}
```

- [ ] **Step 1: Start the one-article run**

Run the workflow endpoint with the input above.

- [ ] **Step 2: Watch the audit**

```bash
npm run audit:watch -- --run-id <run-id>
```

Stop and investigate if any of these occurs:

- more than one local limit error;
- more than two consecutive searches for the same requirement without a fetch;
- remediation repeats an identical query;
- a phase reports success after returning no evidence and no explicit gap;
- reported provider cost exceeds `$0.30`.

- [ ] **Step 3: Export the audit**

```bash
npm run audit:export -- --run-id <run-id>
```

- [ ] **Step 4: Apply the quality gate**

The run passes only when:

- one article reaches evidence readiness;
- every high-materiality claim has retained evidence;
- all primary evidence hosts match the claim-specific target domains;
- no unsupported number appears in a claim;
- structural analysis and research review both run;
- provider requests are at most 40;
- the audit shows separate deep-research and remediation stages;
- final artifact counts equal the article output.

- [ ] **Step 5: Run the two-article market test only after the first pass**

Use `maxAcceptedBriefs: 2`, `maxProviderRequests: 70`, and the same `$1` ceiling. Require one independently evaluated article from Nigeria and one from Ghana. Do not count a single cross-market article as one article per market.

---

## Final Self-Review

- Every confirmed defect from the investigation maps to one task.
- NDIC is addressed as a primary source policy and as a readiness test.
- Higher limits are applied only after the waste paths are fixed.
- The first paid run accepts one article total; the second accepts one per market.
- Unsupported `37` remains blocked unless new attributable evidence is retained.
- No task requires changes to structural analysis, writing, or publishing because evidence readiness currently blocks before those stages.
