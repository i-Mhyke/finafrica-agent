# Research Quality Campaign

## Stages

### Stage A: Offline suite

Run the network-free evaluation suite and confirm every hard gate passes.

```bash
npm run eval:research:offline -- --out docs/evals/research-quality-baseline
```

Stage A passes when `report.json` has `passed: true` and `hardGateFailures` is empty.

### Stage B: Paid canary calibration

Run three paid canaries per market (Nigeria and Ghana) using the opt-in command:

```bash
npm run eval:research:canary -- \
  --live \
  --run-key <unique-key> \
  --window-start <ISO timestamp> \
  --window-end <ISO timestamp> \
  --out <file.json>
```

Canary limits are fixed in the request body:

- `maxDiscoveredBriefs: 2`
- `maxAcceptedBriefs: 1`
- `maxProviderRequests: 30`
- `maxProviderCostUsd: 0.25`

Three canaries per market are calibration only. They do not authorize adding markets.

### Stage C: Regression remediation

Fix every safety or cost regression found in Stage B before promotion.

Compare offline reports after fixes:

```bash
npm run eval:research:compare -- \
  --baseline docs/evals/research-quality-baseline/report.json \
  --candidate <candidate-report.json>
```

### Stage D: Promotion evidence

Collect ten independent article outcomes per market with every promotion gate satisfied.

## Promotion Gates

- 0 false PASS outcomes
- 100% material-anchor coverage on passing articles
- 100% high-materiality source-rule satisfaction on passing articles
- >=95% provider attempt success
- <=30 provider attempts per run
- <=1 evidence-remediation pass per article
- <=1 structural-analysis call per ready article on the standard path
- <=1 research-review call per ready article on the standard path
- equal configured discovery-search allocation for Nigeria and Ghana
- complete cost, token, market, article, stage, latency, and terminal-status audit fields

## Scale Restriction

Do not add a third market until Nigeria and Ghana each have ten independent article outcomes and every promotion gate passes.
