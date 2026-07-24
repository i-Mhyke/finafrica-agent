# Durable Research Runbook

**Issue log:** [durable-discovery-issue-log.md](./durable-discovery-issue-log.md) — observed failures, fixes, and open decisions.

## Modes

- `legacy` (default): `POST /workflows/market-intelligence-scan` on the Flue worker.
- `durable`: `POST /v1/research/scans` on `research-control-plane`.

Set mode explicitly:

```bash
RESEARCH_SCAN_MODE=legacy npm run scan -- --input fixtures/scan.json
RESEARCH_SCAN_MODE=durable RESEARCH_CONTROL_PLANE_URL=http://127.0.0.1:8788 npm run scan -- --input fixtures/scan.json
```

## Rollback

Rollback is configuration-only: set `RESEARCH_SCAN_MODE=legacy` (or unset it). No data migration is required.

## Verification checklist

1. Both markets reach a terminal state.
2. Paid-call ledger equals retained receipt totals.
3. Every successful fetch has source/evidence artifacts.
4. Injected restart does not repeat committed provider calls.
5. At least one shadow run reaches brief validation before promoting durable default.

## Operations

- Deploy Flue worker first: `npm run deploy` (secrets via `wrangler secret bulk .dev.vars` on first deploy)
- Deploy control plane: `npm run control-plane:deploy`
- Set `RESEARCH_ADMIN_TOKEN` on both workers (same value, ≥32 bytes)
- Dry-run: `npm run deploy:dry-run` and `npm run control-plane:deploy:dry-run`
- Local dev: `npm run control-plane:dev` (uses `--env local` + `FLUE_EXECUTION_BASE_URL`)

### Prod durable scan

```bash
export RESEARCH_CONTROL_PLANE_URL=https://research-control-plane.ihunayamadu.workers.dev
RESEARCH_SCAN_MODE=durable npm run scan -- --input scan.json
```

Prod control plane calls Flue via `PUBLICATION_AGENT` service binding — no `FLUE_EXECUTION_BASE_URL`.

## Failure classes

- `agent_task_timeout`: model decision/finalization timeout (not provider timeout)
- `provider_outcome_unknown`: committed action with unknown provider outcome; do not silently replay
- `workflow_interrupted`: resume from last committed workflow step
- `stale_revision`: checkpoint CAS conflict — retried in `persistCheckpoint` (see issue log ISSUE-001/002)

## Local dev pitfalls

See issue log for full detail. Quick list:

1. Bump `runKey` in `scan.json` before each new durable run.
2. Control plane port varies (`8787` vs `8788`) — set `RESEARCH_CONTROL_PLANE_URL` explicitly.
3. After Flue migration tag bumps, clear `agent/.wrangler/state` and restart `npm run dev`.
4. Do not kill local control-plane wrangler to test durability — workflow orphans (ISSUE-013).
5. Use `scan.json.example` as template; local `scan.json` is gitignored.

## DO write budget (prod)

Control-plane persistence is optimized for resume, not full audit replay:

- One `provider_reservations` row + one `provider_observations` payload per action (artifacts embedded).
- Checkpoint terminal results omit artifact bodies; hydrated from observations on return.
- `state_transitions` are not written.
- Legacy fan-out tables remain readable for older runs.

Largest remaining prod `rows_written` cost is Flue Workflow DOs per discovery micro-step (see OPEN-008). Workers Paid is still required for scheduled prod load.
