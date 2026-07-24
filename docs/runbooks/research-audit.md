# Research Audit Runbook

## Purpose

Operators get live stage-aware visibility into research runs and can export compact JSON/Markdown audit artifacts. Raw prompts, thinking content, tool results, and fetched page bodies are excluded from exported reports.

## Prerequisites

```bash
cp .dev.vars.example .dev.vars
# Required: RESEARCH_ADMIN_TOKEN (≥32 random bytes)
# Optional: FLUE_BASE_URL (defaults to http://127.0.0.1:3583)
```

## Start a Scan With Live Audit

```bash
npm run dev

npm run scan -- --input ./scan.json
```

`scan.json` uses the same `DiscoveryRunRequest` shape as the workflow HTTP API. The command admits the workflow without `?wait=result`, prints `runId`, and attaches the live watcher.

Optional export on completion:

```bash
npm run scan -- --input ./scan.json --out ./research-runs
```

## Watch an Existing Run

```bash
npm run audit:watch -- --run-id <runId>
npm run audit:watch -- --run-id <runId> --replay
npm run audit:watch -- --run-id <runId> --json
npm run audit:export -- --run-id <runId> --out ./research-runs
```

`--replay` prints the historical timeline once after catch-up. Default late-attach output is silent for historical turns and tools.

### Watcher states

| Label | Meaning |
| --- | --- |
| `Connecting:` | Preflight to the run server has not completed |
| `Catch-up:` | Loading persisted events without live timeline output |
| `Live:` | Subscribed after opaque checkpoint resume |
| `Stale:` | Connected, but no persisted event within the stale window |
| `Disconnected:` | Run server unreachable after at least one confirmed event |
| `Completed:` | Engine status `completed`; research outcome may be `complete`, `partial`, or `failed` |
| `Errored:` | Engine status `errored` |

Engine status (`completed` / `errored` / `active`) is separate from research outcome (`complete` / `partial` / `failed`). A `Completed: partial` line is a research-quality outcome, not a watcher failure.

`--json` emits `watcher_state` records with sanitized `errorClass` values only. Raw exception text is never printed.

Completed runs show recorded `durationMs`, not wall time since attachment.

## Export Audit Artifacts

```bash
npm run audit:export -- --run-id run_... --out ./research-runs
```

Writes:

```text
research-runs/<runKey>/<runId>/audit.json
research-runs/<runKey>/audit.md
```

Exports are operator-owned artifacts. `research-runs/` is gitignored. No automatic retention deletion is implemented in this sprint.

## Report Semantics

| Field | Meaning |
| --- | --- |
| `efficiency.model` | Summed from terminal `turn` events only |
| `efficiency.provider.admittedEstimateUsd` | Admission estimates for admitted attempts |
| `efficiency.provider.reportedCostUsd` | Vendor-reported costs only |
| `efficiency.provider.unpricedCalls` | Terminal attempts with `reportedCostUsd: null` |
| `efficiency.provider.attemptCount` | Admitted provider attempts; budget rejections are excluded |
| `efficiency.provider.budgetRejectionCount` | Calls stopped before a provider request because budget admission failed |
| `activeTurns` | In-progress or interrupted model turns with scope and timing metadata |
| `stages[].status = interrupted` | Stage started but no terminal stage event before run close |
| `warnings` | Missing usage, unclosed stages, partial exports |

Unknown vendor cost is never copied into reported provider cost. Admission estimate and reported cost remain separate.

## Security

- CLI sends `RESEARCH_ADMIN_TOKEN` only in the `Authorization` header.
- Raw run streams may still contain model content and remain admin-only.
- Exported artifacts pass through the project redactor for configured secrets.
- Output paths only allow `runKey` segments matching `[A-Za-z0-9._-]`.

## Incidents

| Symptom | Action |
| --- | --- |
| Disconnected before first event | Confirm `npm run dev` is listening on `FLUE_BASE_URL`; confirm `RESEARCH_ADMIN_TOKEN` matches the dev server; run the watcher again |
| Stale while connected | Inspect current stage and active turn age; do not restart while persisted-event timestamps continue advancing |
| `Completed: partial` | Inspect review `missingItems`; this is a research-quality outcome, not a watcher failure |
| Unauthorized watch/export | Verify bearer token length and value in `.dev.vars` |
| Export blocked for unsupported `v` | Upgrade projector/fixtures after Flue event version change |
| `model_stream_interrupted` / `missing_finish_reason` | Flue retries the same conversation with its bounded transient-error policy. Completed tool receipts stay in the run. If retries are exhausted, inspect the failed turn and assigned `modelId`; do not restart the scan until the model endpoint is stable. |
| Failed discovery with non-zero provider usage | Inspect `discovery.coverage`, `discovery.receipts`, and retained sources/briefs. The failure result preserves completed searches even when the model never returns a final portfolio. |
| `research_nested_delegation_denied` | A delegated worker attempted to call Flue's `task` tool. The policy stopped it before child execution. Record the parent profile and stage as a prompt/profile defect; never permit the call to make the run pass. |
| Secret suspected in artifact | Delete files, rotate key, file redaction bug |

## HTTP Compatibility

Existing endpoints remain unchanged:

```bash
POST /workflows/market-intelligence-scan
GET /runs/:runId
```

Blocking `?wait=result` invocation still works for final-result workflows.
