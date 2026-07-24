# Research Quality Baseline — 2026-07-24

## Command

```bash
npm run eval:research:offline -- --out docs/evals/research-quality-baseline
```

## Evaluator

- Version: 1
- Suite: `evals/research/cases/suite.json`
- Generated at: 2026-07-24T06:39:28.963Z
- Overall result: PASS

## Case Results

| Case | Kind | Result | Observations |
|---|---|---|---|
| discovery-market-clean | discovery | PASS | none |
| discovery-cross-market | discovery | PASS | cross_market_contamination |
| evidence-clean | evidence | PASS | none |
| evidence-anchor-missing | evidence | PASS | material_anchor_missing |
| evidence-primary-missing | evidence | PASS | primary_source_rule_failed |
| evidence-social-only | evidence | PASS | social_only_material_support |
| review-false-pass | review | PASS | review_pass_with_readiness_blocked |
| efficiency-known-run | efficiency | PASS | none |

## Hard Gates

- none

## Known-Run Efficiency (`scan-smoke-2026-07-23-001`)

| Metric | Value |
|---|---|
| Provider attempts | 25 |
| Provider failures | 0 |
| Provider cost (USD) | 0.091 |
| LLM input tokens | 176,557 |
| LLM output tokens | 59,593 |
| LLM cost (USD) | 0.160 |
| Max structural-analysis calls per article | 1 |
| Max research-review calls per article | 1 |
| Discovery searches (Nigeria) | 2 |
| Discovery searches (Ghana) | 2 |

Raw artifacts: `docs/evals/research-quality-baseline/report.json`, `report.md`, `manifest.json`.
