# Durable Research Runbook

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

- Deploy control plane: `npm run control-plane:deploy`
- Dry-run: `npm run control-plane:deploy:dry-run`
- Local dev: `npm run control-plane:dev`

## Failure classes

- `agent_task_timeout`: model decision/finalization timeout (not provider timeout)
- `provider_outcome_unknown`: committed action with unknown provider outcome; do not silently replay
- `workflow_interrupted`: resume from last committed workflow step
