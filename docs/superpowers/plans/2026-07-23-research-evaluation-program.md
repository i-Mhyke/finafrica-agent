# Research Evaluation Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a network-free evaluation suite that detects research-quality regressions from saved artifacts, then define a separate opt-in Nigeria/Ghana canary that cannot exceed the existing workflow request and provider-cost caps.

**Architecture:** JSON cases contain input artifacts and editor-approved expected labels. Small JavaScript evaluators calculate discovery, evidence, review-gate, efficiency, and allocation metrics. The default CLI reads fixtures only. The paid canary is a separate command with an explicit `--live` flag and a fixed request body.

**Tech Stack:** Node.js ESM, Valibot 1.4, Vitest 4, existing audit JSON format and workflow HTTP endpoint.

## Global Constraints

- This plan must not change production research behavior.
- No file under `.flue/**` may change.
- No default evaluation command may read `.dev.vars`, call localhost, call Exa, call Apify, or call a model.
- The evaluation runner uses `.mjs`, not TypeScript, so Node can execute it without adding a loader.
- No dependency changes.
- The existing `eval:research-provider` command remains unchanged.
- The canary command is opt-in and exits before making a request unless `--live` is present.
- The canary request covers only Nigeria and Ghana because the production pipeline fixes foundation markets internally.
- The canary caps are `maxDiscoveredBriefs: 2`, `maxAcceptedBriefs: 1`, `maxProviderRequests: 30`, and `maxProviderCostUsd: 0.25`.
- Evaluation outputs never contain secrets, request headers, raw chain-of-thought, or environment-variable values.
- A single aggregate score cannot override a hard publication-safety failure.

---

## File Responsibility and Mutation Map

Only these files may change under this plan.

| File | Exact responsibility |
|---|---|
| `evals/research/schema.mjs` | Parse and validate evaluation cases and reports. |
| `evals/research/discovery-evaluator.mjs` | Calculate discovery metrics only. |
| `evals/research/evidence-evaluator.mjs` | Calculate evidence/readiness metrics only. |
| `evals/research/review-evaluator.mjs` | Calculate deterministic review-gate metrics only. |
| `evals/research/efficiency-evaluator.mjs` | Calculate cost, token, attempt, and allocation metrics from audit reports. |
| `evals/research/runner.mjs` | Load cases, route them to evaluators, aggregate results, and compare reports. |
| `evals/research/cases/*.json` | Versioned inputs and expected labels. |
| `scripts/research-eval.mjs` | Parse offline CLI arguments and write reports. |
| `scripts/research-canary.mjs` | Submit one explicit live canary and write its returned result. |
| `tests/evals/research/*.test.ts` | Network-free evaluator and CLI tests. |
| `package.json` | Add four scripts only. |
| `docs/evals/research-quality-baseline.md` | Record the first offline result. |
| `docs/evals/research-quality-campaign.md` | Record canary and promotion procedure. |

Forbidden files:

```text
.flue/**
scripts/benchmark-research-provider.mjs
scripts/research-audit.mjs
scripts/lib/**
tests/research/**
tests/fixtures/research/**
research-runs/**
package-lock.json
wrangler.jsonc
.dev.vars
```

The evaluator reads existing fixtures and run exports but never edits them.

## Input Sources

Use these exact repository artifacts:

```text
tests/fixtures/research/discovery-portfolio.json
tests/fixtures/research/region-results.json
tests/fixtures/research/reviewer-pass.json
tests/fixtures/research/reviewer-needs-more.json
research-runs/scan-smoke-2026-07-23-001/audit.json
```

New adversarial cases copy only the fields needed from these inputs. Do not make the evaluator depend on attachments or an external run server.

## Hard Gates

An offline report fails when any of these is nonzero:

```text
unsupportedMaterialClaimEscapeCount
danglingEvidenceReferenceCount
danglingSourceReferenceCount
crossMarketContaminationCount
reviewPassWithReadinessBlockedCount
reviewPassBelowRequiredScoreCount
```

The clean positive case must pass. A suite that blocks every case also fails.

---

### Task 1: Define Exact Case and Report Schemas

**Files:**

- Create: `evals/research/schema.mjs`
- Create: `tests/evals/research/schema.test.ts`

**Interfaces:**

- Produces:

```js
parseEvalCase(value)
parseEvalSuite(value)
parseEvalReport(value)
```

- Consumed by: every remaining task.

**Mutation boundary:**

- Import only `valibot`.
- Do not import production `.flue` modules; offline cases must remain stable when production code changes.

- [ ] **Step 1: Write failing tests with these exact names**

```ts
it('accepts a valid discovery evaluation case', () => {});
it('accepts a valid evidence evaluation case', () => {});
it('rejects an unsupported case kind', () => {});
it('rejects an unsupported market', () => {});
it('rejects duplicate case IDs in one suite', () => {});
it('rejects absolute input artifact paths', () => {});
it('requires expected labels and rationale', () => {});
```

- [ ] **Step 2: Define one discriminated case schema**

Implement this public shape:

```js
{
	caseId: string,
	caseVersion: 1,
	kind: 'discovery' | 'evidence' | 'review' | 'efficiency',
	market: 'nigeria' | 'ghana' | 'portfolio',
	input: object,
	expected: object,
	rationale: string,
	sourceOfTruth: 'editor-reviewed' | 'deterministic-invariant',
	enforceHardGates: boolean,
}
```

Use a different `input` and `expected` schema per `kind`; do not use `record(string, unknown)` for either.

Required inputs:

```js
// discovery
input: { portfolio: object }
expected: {
	relevantBriefIds: string[],
	irrelevantBriefIds: string[],
	expectedMarketSourceIds: string[],
	crossMarketContaminationCount: number,
}

// evidence
input: { brief: object, sourceAudit: object, readiness: object, finalDecision: string }
expected: {
	unsupportedMaterialClaimIds: string[],
	unsubstantiatedMaterialClaimIds: string[],
	readinessReady: boolean,
	materialAnchorCoverage: number,
	primaryRequirementSatisfactionRate: number,
	socialOnlyMaterialSupportCount: number,
	danglingEvidenceReferenceCount: number,
	danglingSourceReferenceCount: number,
	unsupportedMaterialClaimEscapeCount: number,
}

// review
input: { readiness: object, structuralPacket: object, review: object }
expected: { publicationEligible: boolean }

// efficiency
input: { auditReport: object }
expected: {
	maxProviderAttempts: number,
	maxProviderFailures: number,
	maxStructuralAnalysisCallsPerArticle: number,
	maxResearchReviewCallsPerArticle: number,
}
```

Define the nested objects with `v.looseObject` so the evaluator requires every field it reads while preserving unused production fields:

```js
const EvalSourceSchema = v.looseObject({
	sourceId: v.string(),
	canonicalUrl: v.string(),
	publisher: v.nullable(v.string()),
	market: v.picklist(['nigeria', 'ghana']),
	tier: v.union([v.literal(1), v.literal(2), v.literal(3)]),
	sourceType: v.picklist(['primary', 'secondary', 'social']),
});

const EvalEvidenceSchema = v.looseObject({
	evidenceId: v.string(),
	sourceId: v.string(),
	text: v.string(),
});

const EvalClaimSchema = v.looseObject({
	claimId: v.string(),
	kind: v.picklist(['fact', 'reported-claim', 'inference']),
	materiality: v.picklist(['low', 'medium', 'high']),
	requirementIds: v.array(v.string()),
	supportingEvidenceIds: v.array(v.string()),
	status: v.picklist(['supported', 'disputed', 'unsupported']),
});

const EvalRequirementSchema = v.looseObject({
	requirementId: v.string(),
	sourceRule: v.picklist([
		'primary',
		'independent-secondary',
		'primary-or-two-independent-secondary',
	]),
	targetDomains: v.array(v.string()),
	anchors: v.array(v.string()),
});

const EvalBriefSchema = v.looseObject({
	briefId: v.string(),
	markets: v.array(v.picklist(['nigeria', 'ghana'])),
	discoverySourceIds: v.array(v.string()),
	evidenceRequirements: v.array(EvalRequirementSchema),
});

const EvalReadinessSchema = v.looseObject({
	ready: v.boolean(),
	unsupportedMaterialClaimIds: v.array(v.string()),
	unsubstantiatedMaterialClaimIds: v.array(v.string()),
});
```

```js
const EvalStructuralPacketSchema = v.looseObject({
	packetVersion: v.string(),
	editorsQuestions: v.array(v.unknown()),
	storyOptions: v.array(v.unknown()),
	analysisLayers: v.object({
		layer1WhatChanged: v.string(),
		layer2IsNew: v.string(),
		layer3WhoLoses: v.string(),
		layer4PricingPower: v.string(),
		layer5StackCollapse: v.string(),
		layer6InstitutionalPower: v.string(),
		layer7WhatBecomesPossible: v.string(),
	}),
});

const EvalReviewSchema = v.looseObject({
	packetVersion: v.string(),
	decision: v.picklist(['PASS', 'NEEDS_MORE_RESEARCH', 'REJECT']),
	scores: v.looseObject({
		sourceQuality: v.number(),
		factualSupport: v.number(),
		structuralAnalysis: v.number(),
		reporterVsAnalystTest: v.number(),
		libelAndAllegationRisk: v.number(),
	}),
});

const EvalAuditSchema = v.looseObject({
	efficiency: v.looseObject({
		provider: v.looseObject({
			attemptCount: v.number(),
			reportedCostUsd: v.number(),
		}),
		model: v.looseObject({
			inputTokens: v.number(),
			outputTokens: v.number(),
			costUsd: v.number(),
		}),
	}),
	stages: v.array(v.looseObject({
		phase: v.string(),
		briefId: v.nullable(v.string()),
	})),
	timeline: v.array(v.looseObject({
		auditEvent: v.nullable(v.string()),
		phase: v.nullable(v.string()),
		operation: v.nullable(v.string()),
		briefId: v.nullable(v.string()),
		market: v.nullable(v.picklist(['nigeria', 'ghana'])),
	})),
});
```

- [ ] **Step 3: Define report schema**

```js
{
	evaluatorVersion: 1,
	generatedAt: string,
	suitePath: string,
	cases: [{
		caseId: string,
		kind: string,
		passed: boolean,
		failures: string[],
		observations: string[],
		metrics: object,
	}],
	metrics: object,
	hardGateFailures: string[],
	passed: boolean,
}
```

`passed` must equal:

```js
hardGateFailures.length === 0 && cases.every((item) => item.passed)
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
npx vitest run tests/evals/research/schema.test.ts
```

Expected: PASS.

---

### Task 2: Create Eight One-Fault Evaluation Cases

**Files:**

- Create: `evals/research/cases/suite.json`
- Create: `evals/research/cases/discovery-market-clean.json`
- Create: `evals/research/cases/discovery-cross-market.json`
- Create: `evals/research/cases/evidence-clean.json`
- Create: `evals/research/cases/evidence-anchor-missing.json`
- Create: `evals/research/cases/evidence-primary-missing.json`
- Create: `evals/research/cases/evidence-social-only.json`
- Create: `evals/research/cases/review-false-pass.json`
- Create: `evals/research/cases/efficiency-known-run.json`
- Create: `tests/evals/research/cases.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas.
- Produces: exactly eight cases listed in `suite.json` in the order shown above.

**Mutation boundary:**

- Each negative case changes one condition from its paired positive case.
- Do not copy secrets, headers, prompts, or model reasoning into cases.

- [ ] **Step 1: Create the suite manifest**

Use:

```json
{
	"suiteVersion": 1,
	"cases": [
		"discovery-market-clean.json",
		"discovery-cross-market.json",
		"evidence-clean.json",
		"evidence-anchor-missing.json",
		"evidence-primary-missing.json",
		"evidence-social-only.json",
		"review-false-pass.json",
		"efficiency-known-run.json"
	]
}
```

Set `enforceHardGates: false` on synthetic negative controls. Set it to `true` on both clean controls and `efficiency-known-run`. Future exported production-run cases must set it to `true`.

- [ ] **Step 2: Build the discovery pair**

`discovery-market-clean.json` contains:

- one Nigeria brief;
- one Nigeria source on an allowed Nigeria domain;
- no Ghana artifact;
- expected relevant brief ID and expected market source ID.

`discovery-cross-market.json` is identical except that the retained source has `market: "ghana"` and a Ghana hostname. Its expected relevant list is empty, its irrelevant list contains the brief ID, and its expected contamination count is one. The case passes when the evaluator detects that contamination.

- [ ] **Step 3: Build the evidence cases**

Use the same brief, source audit, and readiness shape in all four evidence cases.

`evidence-clean.json`:

- one high-materiality fact;
- one requirement ID;
- one linked evidence excerpt containing every anchor;
- one linked Tier 1 primary source on a target domain;
- readiness ready;
- final decision may be PASS.

`evidence-anchor-missing.json` changes only the excerpt text so one material anchor is absent. Expected readiness is false.

`evidence-primary-missing.json` changes only the source to Tier 2 secondary while the rule remains `primary`. Expected readiness is false.

`evidence-social-only.json` changes only the source type to `social`. Expected readiness is false.

Each negative case sets `finalDecision: "NEEDS_MORE_RESEARCH"`. A negative case passes when the computed defect and readiness match `expected`; the deliberate defect does not fail the full suite.

- [ ] **Step 4: Build the review false-PASS case**

Use:

- `readiness.ready: false`;
- a structurally valid packet;
- reviewer decision `PASS`;
- all reviewer dimension scores at least two.

Expected `publicationEligible: false`. The case passes when the evaluator blocks publication.

- [ ] **Step 5: Build the efficiency case from the existing audit**

Copy the complete sanitized object from:

```text
research-runs/scan-smoke-2026-07-23-001/audit.json
```

into `input.auditReport`. Expected limits:

```json
{
	"maxProviderAttempts": 30,
	"maxProviderFailures": 0,
	"maxStructuralAnalysisCallsPerArticle": 1,
	"maxResearchReviewCallsPerArticle": 1
}
```

This case measures the existing run's agent-stage counts. Model turns inside one agent stage do not count as separate analysis or review calls.

- [ ] **Step 6: Validate all cases**

Run:

```bash
npx vitest run tests/evals/research/cases.test.ts
```

Expected: exactly eight unique cases parse.

---

### Task 3: Implement Discovery and Evidence Evaluators

**Files:**

- Create: `evals/research/discovery-evaluator.mjs`
- Create: `evals/research/evidence-evaluator.mjs`
- Create: `tests/evals/research/discovery-evaluator.test.ts`
- Create: `tests/evals/research/evidence-evaluator.test.ts`

**Interfaces:**

- Produces:

```js
evaluateDiscoveryCase(evalCase)
evaluateEvidenceCase(evalCase)
```

- Return shape:

```js
{
	passed: boolean,
	failures: string[],
	observations: string[],
	metrics: Record<string, number>,
}
```

**Mutation boundary:**

- No production imports, filesystem reads, network calls, or model calls.
- Use only IDs and classifications present in the case.

- [ ] **Step 1: Implement discovery formulas**

Use exact formulas:

```text
candidatePrecision =
  relevantBriefCount / discoveredBriefCount

marketSpecificSourceRate =
  sourcesWhoseMarketMatches / retainedSourceCount

primarySourceHitRate =
  relevantBriefsWithAtLeastOnePrimaryDiscoverySource / relevantBriefCount

crossMarketContaminationCount =
  sources + evidence + briefs whose market differs from the case market
```

For a zero denominator, return `0`, except an empty contamination set returns `0` naturally.

Record detected defects in `observations`:

```text
cross_market_contamination
```

Record expectation mismatches in `failures`:

```text
relevant_brief_set_mismatch
irrelevant_brief_set_mismatch
market_source_set_mismatch
cross_market_contamination_count_mismatch
```

- [ ] **Step 2: Implement evidence formulas**

Use exact formulas:

```text
materialClaimSupportRate =
  expected supported material claims / all material claims

materialAnchorCoverage =
  anchors found in linked excerpts / all required anchors

primaryRequirementSatisfactionRate =
  primary requirements with a linked primary target-domain source /
  all primary requirements

unsupportedMaterialClaimEscapeCount =
  expected unsupported or unsubstantiated material claim IDs when
  finalDecision is PASS

danglingEvidenceReferenceCount =
  claim evidence IDs absent from sourceAudit.evidence

danglingSourceReferenceCount =
  evidence source IDs absent from sourceAudit.sources
```

Do not infer semantic support. Anchor comparison uses lower-case, NFKC-normalized, whitespace-collapsed exact containment.

Record detected defects in `observations`:

```text
material_anchor_missing
primary_source_rule_failed
social_only_material_support
dangling_evidence_reference
dangling_source_reference
```

Record expectation mismatches in `failures`:

```text
readiness_mismatch
unsupported_claim_set_mismatch
unsubstantiated_claim_set_mismatch
material_anchor_coverage_mismatch
primary_requirement_rate_mismatch
social_only_support_count_mismatch
unsupported_material_claim_escape_count_mismatch
dangling_evidence_count_mismatch
dangling_source_count_mismatch
unsupported_material_claim_escape
```

- [ ] **Step 3: Run focused tests**

```bash
npx vitest run tests/evals/research/discovery-evaluator.test.ts tests/evals/research/evidence-evaluator.test.ts
```

Expected: all cases pass against their expected labels; each negative case contains exactly one intended observation.

---

### Task 4: Implement Review and Efficiency Evaluators

**Files:**

- Create: `evals/research/review-evaluator.mjs`
- Create: `evals/research/efficiency-evaluator.mjs`
- Create: `tests/evals/research/review-evaluator.test.ts`
- Create: `tests/evals/research/efficiency-evaluator.test.ts`

**Interfaces:**

- Produces:

```js
evaluateReviewCase(evalCase)
evaluateEfficiencyCase(evalCase)
```

**Mutation boundary:**

- Review evaluator grades deterministic publication eligibility only.
- It does not grade prose quality with an LLM.
- Efficiency evaluator consumes the saved audit report shape without changing the audit projection.

- [ ] **Step 1: Implement the publication-eligibility rule**

`publicationEligible` is true only when:

```js
readiness.ready === true
review.decision === 'PASS'
review.packetVersion === structuralPacket.packetVersion
structuralPacket.editorsQuestions.length >= 10
structuralPacket.storyOptions.length >= 3
structuralPacket.storyOptions.length <= 5
all seven analysisLayers values are non-empty
sourceQuality >= 2
factualSupport >= 2
structuralAnalysis >= 2
reporterVsAnalystTest >= 2
libelAndAllegationRisk >= 2
```

Record detected defects in `observations`:

```text
review_pass_with_readiness_blocked
review_packet_version_mismatch
review_structure_incomplete
review_pass_below_required_score
```

Set `failures` to `['publication_eligibility_mismatch']` only when the computed boolean differs from `expected.publicationEligible`.

- [ ] **Step 2: Implement efficiency extraction**

Read these exact existing audit fields:

```text
auditReport.efficiency.provider.attemptCount
auditReport.efficiency.provider.reportedCostUsd
auditReport.efficiency.model.inputTokens
auditReport.efficiency.model.outputTokens
auditReport.efficiency.model.costUsd
auditReport.stages
auditReport.timeline
```

Calculate:

```text
providerAttemptCount
providerFailureCount
providerCostUsd
llmInputTokens
llmOutputTokens
llmCostUsd
structuralAnalysisCallsByArticle
researchReviewCallsByArticle
discoverySearchesByMarket
```

If a required section is absent, fail with `audit_metric_missing`; do not substitute zero.

Limit failures:

```text
provider_attempt_limit_exceeded
provider_failure_limit_exceeded
structural_analysis_call_limit_exceeded
research_review_call_limit_exceeded
unequal_discovery_allocation
```

Count structural-analysis and review calls from `auditReport.stages`, grouped by non-null `briefId`. Count provider failures from terminal `provider_attempt_failed` timeline entries. Discovery allocation uses terminal `provider_attempt_completed` timeline entries where `phase === "discovery"`, `operation === "search"`, and `briefId === null`; validator searches are excluded. Allocation is equal when Nigeria and Ghana have the same count.

- [ ] **Step 3: Run focused tests**

```bash
npx vitest run tests/evals/research/review-evaluator.test.ts tests/evals/research/efficiency-evaluator.test.ts
```

Expected: PASS.

---

### Task 5: Build the Offline Runner and Report Comparison

**Files:**

- Create: `evals/research/runner.mjs`
- Create: `tests/evals/research/runner.test.ts`

**Interfaces:**

- Produces:

```js
loadSuite(suitePath)
runSuite({ suitePath, generatedAt })
compareReports(baseline, candidate)
```

**Mutation boundary:**

- Filesystem reads are limited to the selected suite directory.
- The runner does not write files; the CLI owns writes.
- No environment-variable reads.

- [ ] **Step 1: Route by exact case kind**

```js
const evaluators = {
	discovery: evaluateDiscoveryCase,
	evidence: evaluateEvidenceCase,
	review: evaluateReviewCase,
	efficiency: evaluateEfficiencyCase,
};
```

Unknown kinds must fail schema parsing before routing.

- [ ] **Step 2: Aggregate hard gates**

For cases with `enforceHardGates: true`, map both evaluator failures and detected safety observations to hard gates. Ignore observations from synthetic negative controls.

```js
const hardGateReasons = new Set([
	'unsupported_material_claim_escape',
	'dangling_evidence_reference',
	'dangling_source_reference',
	'cross_market_contamination',
	'review_pass_with_readiness_blocked',
	'review_pass_below_required_score',
	'dangling_evidence_count_mismatch',
	'dangling_source_count_mismatch',
	'cross_market_contamination_count_mismatch',
	'publication_eligibility_mismatch',
]);
```

Also fail when `evidence-clean` or `discovery-market-clean` fails, using:

```text
positive_control_failed
```

- [ ] **Step 3: Implement deterministic comparison**

Return:

```js
{
	regressions: string[],
	improvements: string[],
	unchangedFailures: string[],
	addedCases: string[],
	removedCases: string[],
}
```

A regression is a baseline-passing case that fails in candidate. An improvement is the reverse. Reject comparison when `evaluatorVersion` differs.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/evals/research/runner.test.ts
```

Expected: PASS.

---

### Task 6: Add the Network-Free Evaluation CLI

**Files:**

- Create: `scripts/research-eval.mjs`
- Create: `tests/evals/research/cli.test.ts`
- Modify: `package.json:6-19`

**Interfaces:**

- Consumes: `runSuite` and `compareReports`.
- Produces: JSON on stdout or three files in an explicit output directory.

**Mutation boundary:**

- Add exactly three package scripts in this task.
- Do not use `--env-file-if-exists`.
- Do not modify any existing script.

- [ ] **Step 1: Support only these CLI forms**

```text
node scripts/research-eval.mjs run
  [--suite evals/research/cases/suite.json]
  [--out <directory>]
  [--json]

node scripts/research-eval.mjs compare
  --baseline <report.json>
  --candidate <report.json>
  [--json]
```

Unknown flags exit `2`. Evaluation failure exits `1`. Success exits `0`.

- [ ] **Step 2: Write exact report files**

When `--out` is supplied, write:

```text
<out>/report.json
<out>/report.md
<out>/manifest.json
```

`manifest.json` contains:

```js
{
	evaluatorVersion: 1,
	suitePath,
	caseIds,
	caseFileSha256,
	generatedAt,
}
```

Do not include environment variables or absolute paths.

- [ ] **Step 3: Add exact package scripts**

```json
"eval:research": "node scripts/research-eval.mjs run",
"eval:research:offline": "node scripts/research-eval.mjs run --suite evals/research/cases/suite.json",
"eval:research:compare": "node scripts/research-eval.mjs compare"
```

- [ ] **Step 4: Test network prohibition**

In the CLI test, replace `globalThis.fetch` with a function that throws. Run the offline command and assert it still completes.

- [ ] **Step 5: Run CLI tests and offline suite**

```bash
npx vitest run tests/evals/research/cli.test.ts
npm run eval:research:offline -- --out /tmp/publication-research-eval
```

Expected: CLI tests pass. The suite result matches the expected labels without any network call.

---

### Task 7: Add a Separate Opt-In Paid Canary

**Files:**

- Create: `scripts/research-canary.mjs`
- Create: `tests/evals/research/canary.test.ts`
- Modify: `package.json:6-22`

**Interfaces:**

- Makes one HTTP POST only when all guards pass.
- Writes the returned workflow response to an explicit path.

**Mutation boundary:**

- No changes to the workflow, pipeline, providers, watcher, or schemas.
- Tests use a fake `fetch`; they cannot bind a port or contact localhost.
- Add one package script only.

- [ ] **Step 1: Parse these required flags**

```text
--live
--run-key <unique-key>
--window-start <ISO timestamp>
--window-end <ISO timestamp>
--out <file.json>
[--base-url http://localhost:3583]
```

Exit `2` before calling `fetch` when `--live` is absent or a required flag is missing.

- [ ] **Step 2: Use this fixed request body**

```js
{
	runKey,
	trigger: 'manual',
	window: {
		start: windowStart,
		end: windowEnd,
	},
	focus: null,
	maxDiscoveredBriefs: 2,
	maxAcceptedBriefs: 1,
	maxProviderRequests: 30,
	maxProviderCostUsd: 0.25,
}
```

Post to:

```text
<base-url>/workflows/market-intelligence-scan?wait=true
```

The script must not accept flags that override the four limits.

- [ ] **Step 3: Add preflight output**

Before `fetch`, print:

```text
LIVE PAID CANARY
markets: nigeria, ghana
max briefs: 2 discovered, 1 accepted
provider ceiling: $0.25
provider attempts: 30
```

- [ ] **Step 4: Handle failures**

- Non-2xx response: save a sanitized error object and exit `1`.
- Invalid JSON: save `{ "status": "invalid-response" }` and exit `1`.
- Success: save parsed JSON and exit `0`.
- Redact strings matching `Bearer ...`, `x-api-key`, and known key prefixes before writing.

- [ ] **Step 5: Add the package script**

```json
"eval:research:canary": "node --env-file-if-exists=.dev.vars scripts/research-canary.mjs"
```

Only the canary command may load `.dev.vars`; the script must not read or print API-key variables.

- [ ] **Step 6: Run fake-fetch tests**

```bash
npx vitest run tests/evals/research/canary.test.ts
```

Expected: PASS with zero real HTTP calls.

---

### Task 8: Establish the Baseline and Promotion Procedure

**Files:**

- Create: `docs/evals/research-quality-baseline.md`
- Create: `docs/evals/research-quality-campaign.md`

**Interfaces:**

- Consumes: the offline report and future canary result files.
- Produces: a recorded baseline and a bounded scale decision.

**Mutation boundary:**

- Documentation only.
- Do not start a live canary while implementing this task.

- [ ] **Step 1: Generate the baseline**

```bash
npm run eval:research:offline -- --out docs/evals/research-quality-baseline
```

Copy the report summary into `research-quality-baseline.md` with:

- evaluator version;
- eight case results;
- every hard-gate failure;
- known-run provider attempts, failures, cost, tokens, structural calls, and review calls;
- date and command.

- [ ] **Step 2: Document the campaign stages**

`research-quality-campaign.md` must define:

```text
Stage A: offline suite passes all hard gates.
Stage B: three paid canaries per market for calibration.
Stage C: fix every safety or cost regression found in Stage B.
Stage D: ten independent article outcomes per market for promotion.
```

Three canaries per market are calibration only. They do not authorize adding markets.

- [ ] **Step 3: Define promotion gates**

```text
0 false PASS outcomes
100% material-anchor coverage on passing articles
100% high-materiality source-rule satisfaction on passing articles
>=95% provider attempt success
<=30 provider attempts per run
<=1 evidence-remediation pass per article
<=1 structural-analysis call per ready article on the standard path
<=1 research-review call per ready article on the standard path
equal configured discovery-search allocation for Nigeria and Ghana
complete cost, token, market, article, stage, latency, and terminal-status audit fields
```

- [ ] **Step 4: State scale restriction**

Add:

```text
Do not add a third market until Nigeria and Ghana each have ten independent
article outcomes and every promotion gate passes.
```

---

### Task 9: Full Verification and Scope Audit

**Files:**

- No production changes.

**Interfaces:**

- Consumes: Tasks 1–8.
- Produces: a verified network-free default evaluation path.

- [ ] **Step 1: Run the evaluator tests**

```bash
npx vitest run tests/evals/research
```

Expected: PASS.

- [ ] **Step 2: Run the default offline command with provider secrets unset**

```bash
env -u EXA_API_KEY -u APIFY_API_TOKEN npm run eval:research:offline -- --out /tmp/publication-research-eval-clean
```

Expected: completes without a network request.

- [ ] **Step 3: Run repository verification**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all exit zero.

- [ ] **Step 4: Confirm mutation scope**

Confirm that no `.flue/**`, production provider, watcher, existing research fixture, or lockfile changed under this plan.

## Definition of Done

This plan is complete when the eight versioned cases run offline, the hard gates detect each intended defect, the clean positive controls pass, reports can be compared, and a paid canary cannot execute without `--live` or exceed the fixed request body.
