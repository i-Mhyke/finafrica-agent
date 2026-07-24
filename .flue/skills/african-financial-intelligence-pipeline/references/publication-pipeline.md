# Publication Pipeline

## Contents

- [Writing Handoff](#writing-handoff)
- [Output Type Routing](#output-type-routing)
- [EmDash Metadata](#emdash-metadata)
- [EmDash Publishing](#emdash-publishing)
- [Artifact Folder](#artifact-folder)
- [Autopublish Guardrails](#autopublish-guardrails)
- [Post-Publication Corrections](#post-publication-corrections)

## Writing Handoff

After reviewer `PASS`, load `emma-finance-article-writer` and use its article architecture and voice guide.

The writer receives:

- Review report with `PASS`.
- Facts stripped of marketing language.
- Editor's questions and answers.
- Dependency graph.
- Seven-layer analysis.
- Story options and recommended lede.
- Research ledger.
- Source pack with URLs and supported claims.
- Approved output type.
- Required cautions and missing facts to avoid.

Do not add new factual claims during writing unless they are sourced and added to the source ledger.

Lead with the structural change, not the announcement. If the draft reads like "X announced Y" rather than "Y shifts power/cost/dependency for Z", revise before publication.

## Output Type Routing

### Structured Intelligence Brief

Use for narrower but useful signals. Keep it concise and structured.

Required sections:

- WHAT
- WHO
- WHEN
- WHERE
- WHY IT MATTERS
- HOW IT CHANGES THINGS
- SOURCE

### Full Analysis

Use for market-wide, cross-market, or structurally important signals.

Expected shape:

- Lead with the structural change, power shift, dependency shift, or new market possibility.
- Explain the development.
- Quantify scale.
- Explain mechanism.
- Name likely losers or say research found no clear losers yet.
- Identify who gains pricing power or operational leverage.
- Map winners, losers, constraints, and second-order effects.
- Include `## What key players should do now` with actor-specific actions.
- End with what to watch.

### Company Deep Dive

Use for bank, fintech, DFI-backed institution, market operator, or infrastructure company stories.

Expected shape:

- What changed.
- Why the company matters.
- Financial or strategic evidence.
- Market context and competitors.
- Risks, constraints, and execution questions.
- What key players should do now when the company's move affects customers, competitors, regulators, investors, partners, or infrastructure providers.
- What the move signals.

### Policy Explainer

Use for circulars, laws, tax changes, central bank action, capital rules, licensing changes, or enforcement.

Expected shape:

- What changed.
- Who is affected.
- What must change, and by when.
- Whether the change is actually new, newly enforceable, or only a policy signal.
- Compliance burden or opportunity.
- Market impact.
- Losers, pricing power, stack collapse, institutional power shifts, or what becomes possible or inevitable next.
- `## What key players should do now`.
- Open questions.

## EmDash Metadata

Use these defaults unless the user changes policy:

- `author`: `The Editorial Team`
- `signal`: choose one of `policy`, `regulation`, `news`, `investment`, `markets`, `analysis`
- `location`: primary market city or country signal, for example `Lagos`, `Nairobi`, `Accra`, `Johannesburg`, `Cairo`, or `Africa`
- `excerpt`: one or two sentences explaining the decision-relevant significance
- `content`: Markdown article body

Signal mapping:

- Central bank, fiscal, rates, FX, capital controls: `policy`
- Circulars, compliance rules, licences, sanctions, enforcement: `regulation`
- M&A, appointments, product shifts, market events: `news`
- Funding, DFI, PE/VC, capital raises, bonds: `investment`
- Exchanges, rates, inflation, banking performance, liquidity, public markets: `markets`
- Deep explainers and cross-market interpretation: `analysis`

## EmDash Publishing

Use the README CLI pattern for production publication:

```bash
node node_modules/emdash/dist/cli/index.mjs content create articles \
  --url https://finafrica.ihunayamadu.workers.dev \
  --file article.json --json
```

Important:

- Scheduled production runs autopublish by default. Do not add `--draft` unless the user changes policy.
- `EMDASH_TOKEN` must already be available in `.env`.
- Markdown in `content` is automatically converted to Portable Text.
- Preserve source links in the article body where appropriate.
- Save `emdash-payload.json` before publishing.
- If the CLI errors, do not retry blindly. Preserve the payload and report the failure.

## Artifact Folder

For each publishable signal, create or maintain this artifact set where the calling system expects run artifacts. If no path is provided, use `research-runs/YYYY-MM-DD-HHMM-slug/`.

```text
research-runs/YYYY-MM-DD-HHMM-slug/
├── research-ledger.md
├── source-pack.md
├── review-report.md
├── article.md
└── emdash-payload.json
```

## Autopublish Guardrails

Before publishing, verify:

- Reviewer decision is `PASS`.
- The review packet includes facts, editor's questions, question-led research, dependency graph, seven-layer analysis, story options, and recommended lede.
- The article has no unsourced financial figures.
- The article does not rely on social media as sole factual support.
- The article does not contain unverified allegations.
- The article has a valid EmDash `signal`.
- The author is `The Editorial Team`.
- The excerpt is analytical, not promotional.
- The title does not overclaim.
- The article leads with structural change, not the announcement.
- The article names likely losers or explicitly states that research found no clear losers yet.
- Full analysis, company deep dive, and policy explainer articles include `## What key players should do now` unless the review report explicitly says no actor can act differently yet.
- Every material source is present in source artifacts.

## Post-Publication Corrections

When a human editor requests corrections after publication:

1. Retrieve the published article and `_rev`.
2. Identify whether the correction is factual, stylistic, metadata, or source-related.
3. Re-check affected claims against sources.
4. Update with the EmDash CLI `content update` pattern from the README.
5. Do not silently remove material errors. Preserve a correction note if editorial policy requires it.
