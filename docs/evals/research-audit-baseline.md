# Research Audit Baseline

Date: 2026-07-23

## Automated Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck | PASS | `npm run typecheck` |
| Research tests | PASS | `npm run test:research` |
| Offline research eval | PASS | `npm run eval:research:offline` |
| Cloudflare build | PASS | `npm run build` |
| Event emitter contract | PASS | `tests/research/run-audit-events.test.ts` |
| Projection replay/dedupe | PASS | `tests/research/run-audit-projection.test.ts` |
| CLI path safety / export | PASS | `tests/research/run-audit-cli.test.ts` |
| Watcher reliability / feed transport | PASS | `tests/research/run-audit-cli.test.ts`, `scripts/lib/research-run-feed.mjs` |
| Production-shaped attribution | PASS | `tests/fixtures/research/flue-run-events-production-shape.json` |
| Provider budget rejection audit | PASS | `tests/research/provider-router.test.ts` |
| Regression suite | PASS | existing `tests/research/*` |

## Review Corrections

The 2026-07-23 implementation review corrected:

- active-turn tracking with phase, agent, expected model, start time, and interrupted state;
- one-time live timeline output and sanitized JSON Lines output;
- stale-state output with last-event age and total input plus output tokens;
- provider-attempt totals that exclude budget rejections;
- separate budget-rejection and unpriced-terminal-call counts;
- tool usage grouped by tool name;
- artifact and decision summary idempotency by audit ID;
- failed run status when export receives no terminal stream event;
- secret redaction in both audit and scan CLI errors;
- provider budget reservation before concurrent calls begin;
- DeepSeek V4 Flash for structural analysis, Kimi K2.6 for brief validation, and Grok 4.5 for research review;
- one terminal pipeline/provider audit event with elapsed time;
- separate projection and report-output modules.

The 2026-07-24 recovery review added offline recapitalisation regression cases with explicit per-requirement readiness states:

| Case | Expected requirement states |
| --- | --- |
| `recapitalisation-evidence-contract` | `req_cbn_minimum_capital=satisfied`, `req_ndic_revocations=weak`, `req_sec_issuance=weak`, `req_33_compliance=weak`, `req_37_compliance=missing` |
| `recapitalisation-evidence-corrected` | four requirements `satisfied`, `req_37_compliance=weak` while `claim_37` stays unsupported |

Offline eval uses the production anchor matcher (`.flue/research/evidence-anchor-matcher.mjs`) and production readiness evaluator (`.flue/research/evidence-readiness.ts` via `node --experimental-strip-types`).

## Release Gates

The watcher is releasable only when:

- Initial connection failure is visible within 5 seconds.
- A completed 20,000-event run attaches and exits within 3 seconds on the local fixture.
- Default late-attach output remains below 100 lines.
- Live and exported token totals, model cost, provider cost, provider attempt count, stage count, and final outcome match exactly.
- Agent, market, phase, and model attribution contain no `unknown` values when the source events contain those fields.
- Secret-redaction tests pass.
- No paid provider endpoint is called.

## Manual Live Scan

Pending operator run with bounded provider ceiling (`maxProviderCostUsd <= 0.25`).

Expected operator evidence:

1. `npm run scan -- --input <bounded-scan.json>` prints `runId` before completion.
2. Live lines include stage, turn, tool, provider, usage, and cost summaries.
3. `npm run audit:export -- --run-id <runId> --out ./research-runs` writes JSON and Markdown.
4. JSON and Markdown totals match for status, tokens, known costs, and unpriced calls.
5. Secret scan of both artifacts returns no configured credentials.

## Notes

- Exported artifacts are gitignored under `research-runs/`.
- Unsupported Flue event versions fail export before file write.
- Raw run streams remain admin-only and may contain model content not present in compact exports.
