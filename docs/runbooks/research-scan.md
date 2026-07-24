# Research Scan Runbook

## Prerequisites

```bash
cp .dev.vars.example .dev.vars
# Set: EXA_API_KEY, OPENCODE_API_KEY, RESEARCH_ADMIN_TOKEN (≥32 random bytes)
# Optional: APIFY_API_TOKEN, APIFY_FALLBACK_ENABLED=false
```

## Local Invocation

```bash
npm run dev

# Immediate admission + live audit watcher
npm run scan -- --input ./scan.json

# Blocking final result (unchanged)
curl -X POST http://localhost:3583/workflows/market-intelligence-scan?wait=result \
  -H "Authorization: Bearer $RESEARCH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "runKey": "scan-2026-07-23-am",
    "trigger": "manual",
    "window": {"start": "2026-07-22T00:00:00Z", "end": "2026-07-23T00:00:00Z"},
    "focus": null,
    "maxDiscoveredBriefs": 3,
    "maxAcceptedBriefs": 2,
    "maxProviderCostUsd": 1,
    "maxProviderRequests": 40
  }'
```

Or via CLI:

```bash
npx flue run market-intelligence-scan --input '{"runKey":"scan-2026-07-23-am","trigger":"manual","window":{"start":"2026-07-22T00:00:00Z","end":"2026-07-23T00:00:00Z"},"focus":null,"maxDiscoveredBriefs":3,"maxAcceptedBriefs":2,"maxProviderCostUsd":1,"maxProviderRequests":40}'
```

## Run Inspection

```bash
curl http://localhost:3583/runs/<runId> \
  -H "Authorization: Bearer $RESEARCH_ADMIN_TOKEN"
```

Live audit and export:

```bash
npm run audit:watch -- --run-id <runId>
npm run audit:export -- --run-id <runId> --out ./research-runs
```

See [research-audit.md](./research-audit.md) for report fields and incident handling.

## Interpreting Results

| Field | Meaning |
| --- | --- |
| `status: partial` | Some articles/regions failed or budget exhausted; completed work retained |
| `providerUsage.unpricedCallCount` | Vendor did not return cost; admission estimate charged |
| `providerUsage.overrunUsd` | Vendor cost exceeded estimate; new calls stopped |
| `providerUsage.effectiveRequestLimit` | Hard provider-request ceiling admitted for this run |
| `providerUsage.admittedRequestCount` | Provider HTTP attempts admitted, including failed vendor requests |
| `providerUsage.requestRejectionCount` | Attempts stopped before reaching a provider after the ceiling |
| `totals.incomplete` | Articles with `needs-more-research` after remediation pass |
| `discovery.coverage` | Must include Nigeria and Ghana; `failed` = market discovery gap |

Discovery runs as two independent tasks: `discovery_nigeria` and `discovery_ghana`. Each task may perform at most two searches and fetch four selected sources. Candidate slots are allocated before the tasks start, so `maxDiscoveredBriefs` must be at least `2`. A task cannot query with another market's provider policy or consume the other market's discovery budget.

Brief validation may perform one verification search and has a 60-second deadline. A `REFINE` decision starts the tool-free `brief_refiner` for one 45-second pass, followed by one revalidation. The refiner cannot search, fetch, or start another agent.

All stage changes are started by application code. A model-invoked `task` call from a discovery, validation, refinement, research, analysis, or review worker is denied before Flue creates a child session.

## Provider Receipt Reconciliation

Every admitted provider attempt produces a `ProviderCallReceipt` in `providerUsage.receipts`. `costUsd: null` means unpriced, not zero. Exa retries are disabled by default because failed calls may be billed.

## Safe Rerun

Use a new `runKey` for each run. Same `runKey` must not duplicate article work.

## Provider Outage

- Exa search down → affected market coverage `failed`, run returns `partial`/`failed`. No Apify search substitute.
- Exa extraction unusable → try Apify fallback if enabled and budget remains.
- Budget exhausted → `partial` with completed articles preserved.
- `research_nested_delegation_denied` → treat as an agent-policy violation. The nested child did not run. Inspect the parent stage and prompt; do not increase its timeout or delegation depth.

## Benchmark

```bash
npm run eval:research-provider
```

The npm command reads local credentials from `.dev.vars`. Environment variables supplied by CI or the shell remain supported. It needs `EXA_API_KEY` for live Exa measurements and `APIFY_API_TOKEN` when at least five Exa extraction cases require fallback. It writes JSON and Markdown reports, admits at most $2.00 of estimated benchmark spend by default, and exits non-zero when any required metric is missing or below its gate. Set a lower cap with `BENCHMARK_MAX_COST_USD`.

See `docs/evals/research-provider-baseline.md` for promotion gate status.
