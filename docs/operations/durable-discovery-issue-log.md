# Durable Discovery — Issue Log & Decisions

Living record of problems observed during durable discovery rollout (local E2E, shadow runs, durability tests) and the fixes or explicit deferrals chosen. Update this file when a new failure mode is reproduced—not when something is only theorized.

**Related:** [durable-research-runbook.md](./durable-research-runbook.md) · [design spec](../superpowers/specs/2026-07-24-durable-discovery-control-design.md)

---

## Local verification status (2026-07-24)

| Check | Result | Notes |
|-------|--------|-------|
| Durable E2E (`scan-durable-local-008`) | **Pass** | Control plane `complete` ~2m; continue → brief validation |
| CAS retry after DO RPC fix | **Pass** | Scan 008 succeeded after message-based stale detection |
| Shadow legacy (`scan-shadow-legacy-011`) | **Pass (partial)** | ~9m45s; `partial` — hit provider request ceiling in remediation |
| Shadow durable (`scan-shadow-durable-012`) | **Pass** | ~2m18s control plane + continue; `pipeline_completed` |
| Durability: kill control plane mid-scan | **Fail (local)** | Workflow stuck `running` — local wrangler process owns workflow engine |
| Durability: kill Flue mid-scan | **Mixed** | 5 provider completions (same as non-restart baseline); workflow ended `errored` |
| Control plane deploy dry-run | **Pass** | 119 KiB bundle |

---

## State machine & checkpoint persistence

### ISSUE-001 — Checkpoint CAS failures under concurrent markets

**Observed:** `ResearchRunRepositoryError: Checkpoint compare-and-swap failed` in control-plane logs while `discovery:nigeria` and `discovery:ghana` run in parallel (`Promise.all` in `market-intelligence-scan.ts`).

**Root cause:** Multiple writers target the same `ResearchRunState` DO (keyed by `runKey`). Even though NG/GH have separate checkpoint rows, workflow step retries and overlapping `persistCheckpoint` calls can present a stale `expectedRevision` at commit time.

**Decision:** Retry at the orchestration layer instead of serializing markets.

**Fix (implemented):**
- `persistCheckpoint()` in `workers/research-control-plane/src/workflows/run-market-discovery.ts` — up to 8 attempts, re-read latest, idempotent return if terminal or same fingerprint, `mergeCheckpointForRetry()` for monotonic counters.
- `initRun()` uses `INSERT OR IGNORE` for `market_checkpoints` (race-safe double-init).
- `memory-research-run-store.ts` — in-memory SQL shim matches `INSERT OR IGNORE`.

**Tests:** `durable-discovery-workflow.test.ts` (stale revision retry), `durable-discovery-state.test.ts` (concurrent init).

---

### ISSUE-002 — CAS retry silent no-op across DO RPC boundary

**Observed:** Scan 007 errored with CAS failures despite ISSUE-001 retry logic. Retry never fired.

**Root cause:** `ResearchRunRepositoryError` thrown inside the DO is deserialized as a plain `Error` on the workflow side. `instanceof ResearchRunRepositoryError` is **false** after RPC.

**Decision:** Classify stale revisions by error **message** as well as `instanceof`.

**Fix (implemented):** `isStaleRevisionError()` in `run-market-discovery.ts` also matches:
- `Checkpoint compare-and-swap failed`
- `Stale checkpoint revision`
- `Terminal checkpoint cannot be overwritten`

**Verified:** Scan 008 (`ebefb72d…`) completed after this fix.

---

### ISSUE-003 — Retry merge dropped required budget fields

**Observed:** Unit test / local parse failure: `Invalid key: Expected "maxSearches" but received undefined` after CAS retry.

**Root cause:** `mergeCheckpointForRetry()` rebuilt `budget` with only counter fields, dropping `maxSearches`, `maxFetches`, `maxRequests`, `maxCostUsd`.

**Fix (implemented):** Spread `...desired.budget` then apply `Math.max` on counters only.

---

### ISSUE-004 — Terminal hydrate & selected-source fidelity (pre-local review)

**Observed:** Review P1s before local pass — terminal results missing retained artifacts; selected sources stored as placeholders.

**Fix (implemented):** Terminal hydrate from retained receipts/sources/evidence; full `selection_json` for selected search results. Covered by invariant tests in `durable-discovery` test suite.

---

## Control plane ↔ Flue integration

### ISSUE-005 — Admission 503 / missing admin token

**Observed:** `POST /v1/research/scans` → 503; nested wrangler config did not load root `.dev.vars`.

**Fix (implemented):**
- Symlink `workers/research-control-plane/.dev.vars` → `../../.dev.vars`
- `control-plane:dev` script includes `--env-file .dev.vars`

---

### ISSUE-006 — Flue workflow calls fail via service binding locally

**Observed:** Control plane → `PUBLICATION_AGENT` service binding returned 403 / opaque failures during local dev.

**Decision:** Dev-only direct URL bypass; prod must use service binding (see OPEN-001).

**Fix (implemented):**
- `FLUE_EXECUTION_BASE_URL` only in `wrangler.jsonc` `env.local`; prod uses `PUBLICATION_AGENT` service binding
- `flue-client.ts` uses direct `fetch` when `executionBaseUrl` is set

---

### ISSUE-007 — `subagent_not_declared` for discovery workflows

**Observed:** `research-discovery-decision` 500 — `discovery_decision` not in coordinator subagents.

**Fix (implemented):** Register `discoveryDecision` and `discoveryFinalizer` in `.flue/agents/profiles/coordinator.ts`.

---

### ISSUE-008 — Discovery workflow HTTP routes unauthenticated

**Observed:** Flue discovery workflows callable without admin middleware.

**Fix (implemented):** Export `researchAdminFromEnv` as `route`/`runs` on all four discovery-related workflow files.

---

### ISSUE-009 — Flue SQLite migrations for new workflow DOs

**Observed:** 500 `SqlError` — new workflow durable objects missing SQLite tables.

**Fix (implemented):** `v3` migration in `wrangler.jsonc` and `.flue-vite.wrangler.jsonc` for:
- `FlueContinueMarketIntelligenceScanWorkflow`
- `FlueResearchDiscoveryDecisionWorkflow`
- `FlueResearchDiscoveryFinalizationWorkflow`
- `FlueResearchDiscoveryProviderActionWorkflow`

**Ops note:** Clear `.wrangler/state` after migration tag bumps during local dev.

---

### ISSUE-010 — Flue client import path & opaque errors

**Fix (implemented):**
- Import path `../../../.flue` (was one `../` too many)
- Error bodies included in thrown messages for debugging

---

## CLI & polling

### ISSUE-011 — Durable scan polling timed out at 120s

**Observed:** CLI threw `Durable scan polling timed out` while workflow still `running`. Real scans take 2–10+ minutes.

**Fix (implemented):**
- Default `RESEARCH_SCAN_POLL_SECONDS=600` (configurable)
- `RESEARCH_SCAN_POLL_INTERVAL_MS` optional

---

### ISSUE-012 — Wrong workflow terminal status detection

**Observed:** CLI only treated `complete` and `failed` as terminal. Cloudflare Workflows returns `complete` and `errored` (not `failed`), so successful runs never exited the poll loop until timeout.

**Fix (implemented):** `TERMINAL_DURABLE_SCAN_STATUSES` in `scripts/lib/durable-research-run-feed.mjs`: `complete`, `completed`, `errored`, `terminated`, `failed`.

**Follow-up (OPEN-002):** Fixed — `watchScan` throws on `errored`/`terminated`/`failed`; CLI exits 1.

---

## Durability & restart behavior

### ISSUE-013 — Killing control plane orphans local workflow

**Observed:** Durability test scan 009 — killed `wrangler dev` for control plane after 2 provider actions. Status stayed `running` indefinitely.

**Root cause:** Local workflow engine runs inside the killed wrangler process; no remote resume.

**Decision:** Document as **local-dev limitation**. Durability injection for prod must be tested against deployed Workers Workflows, not by killing local wrangler.

**Not fixing locally.**

---

### ISSUE-014 — Killing Flue mid-scan

**Observed:** Scan 010 — killed Flue after 2 provider completions, restarted Flue. Total provider completions = 5 (same as scan 008 baseline). Workflow ended `errored`.

**Interpretation:** No evidence of duplicate provider billing for committed actions (count did not exceed baseline). Late-stage failure likely from transient Flue unavailability during finalization/continue.

**Decision:** Treat provider idempotency as **provisionally OK**; re-test with deployed durability. Investigate graceful Flue outage handling (OPEN-003).

---

## Shadow compare (legacy vs durable)

Same `scan.json` limits (`maxProviderRequests: 40`, 2 briefs / 1 accepted):

| | Legacy 011 | Durable 012 |
|---|------------|-------------|
| Wall time | ~9m45s | ~2m18s (+ ~34s continue) |
| Outcome | `partial` (ceiling in remediation) | `complete` |
| Post-discovery audit provider $ | $0.147 (40 calls) | $0.007 (continue phase only) |

Discovery provider spend for durable mode is **not** in continue audit exports — it lives in control-plane + Flue discovery workflow logs. Compare using Flue `provider-action@… completed` counts or future unified audit projection.

---

## Prod deploy (2026-07-24)

| Worker | URL |
|--------|-----|
| `publication-agent` | https://publication-agent.ihunayamadu.workers.dev |
| `research-control-plane` | https://research-control-plane.ihunayamadu.workers.dev |

| Run | runKey | workflowInstanceId | Result | Wall time |
|-----|--------|-------------------|--------|-----------|
| prod smoke | `scan-prod-durable-2026-07-24-001` | `51e9b165-39e8-40d1-bfd0-2ae65f0e0d9b` | `complete` | ~3m18s |

Service-binding path verified (no `FLUE_EXECUTION_BASE_URL` on control plane).

| Run | runKey | workflowInstanceId | Injection | Result | Wall time |
|-----|--------|-------------------|-----------|--------|-----------|
| prod durability | `scan-prod-durability-2026-07-24-002` | `6226e4bf-8101-457d-80b0-7ecc4f6dac29` | CP redeploy @ poll 20 (~43s) | `complete` | ~3m17s |

---

## Open items

| ID | Item | Decision / next step |
|----|------|----------------------|
| OPEN-001 | ~~`FLUE_EXECUTION_BASE_URL` in prod wrangler~~ | **Fixed:** prod deploy has no var; `--env local` for dev |
| OPEN-002 | ~~CLI exit code on `errored` workflow~~ | **Fixed:** `watchScan` throws; CLI exits 1 |
| OPEN-003 | Flue outage during discovery | Define retry/backoff policy when Flue returns 5xx mid-loop |
| OPEN-004 | Durable eval suite | `evals/research/durable-discovery-evaluator.mjs` still stub |
| OPEN-005 | ~~Uncommitted durable code~~ | **Fixed:** pushed `efaebc8`, `cb2fa31` |
| OPEN-006 | ~~Prod durability test~~ | **Fixed:** redeploy CP at poll 20; `6226e4bf-…` resumed → `complete` (~3m17s) |
| OPEN-007 | Audit export for durable discovery | Continue run id ≠ runKey; export via `run_<continue-workflow-id>` |
| OPEN-008 | Flue DO per discovery micro-step | Biggest remaining `rows_written` amp — batch/in-process actions instead of Workflow DO per hop |
| OPEN-009 | ~~Control-plane artifact fan-out writes~~ | **Fixed:** one observation payload per action; no discovery_actions / artifact table fan-out; transition log no-op |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-25 | Prod durability: CP redeploy mid-scan; workflow resumed to `complete` |
| 2026-07-25 | Write-amp: collapse observation fan-out; slim terminal checkpoint; no-op transitions |
