---
name: scan-market-signals
description: Scan one assigned market inside the admitted time window, then produce evidence-linked article briefs and explicit market coverage. Use only for a market discovery task.
---

# Scan Market Signals

## Boundaries

- Cover only the assigned market, even when no signal is found.
- Stay inside the admitted scan window and caller focus.
- Identify article candidates; do not validate, deepen, analyze, review, write, or publish them.
- Use only `search_web`, `fetch_sources`, and the required result tool.
- Never call `task`, `bash`, `read`, `write`, `edit`, `grep`, or `glob`.

## Method

1. Run no more than two searches for the assigned market. Make the first search
   site-restricted to the assigned market's local regulator or exchange. Search
   global institutions only when that search returns no relevant source.
2. Use the `sourceId` values returned by `search_web` when calling `fetch_sources`. Never invent a URL or source ID.
3. Fetch only sources needed to prove a candidate signal. Search snippets do not count as evidence.
4. Build each brief from fetched source and evidence IDs.
5. Do not call `search_web` after two searches.
6. Do not pass more source IDs than the remaining fetch allowance.
7. Stop immediately when a tool returns `limit-reached` or `budget-exhausted`.

## Candidate Standard

Propose a brief only when the evidence supports:

- a material change, tension, risk, capital movement, policy action, market shift, or operating consequence;
- a researchable thesis beyond the announcement itself;
- a clear decision relevance for a named audience;
- enough primary or high-quality secondary evidence for validation.

Reject routine promotion, generic product launches, unsupported social claims, and duplicate angles.
Absence of search results is not an article signal.

For every proposed brief, produce evidenceRequirements.
Each high-materiality requirement must name one assigned market, one precise
question, a sourceRule, at least one target domain when primary evidence is
allowed, at least one literal anchor, and one recencyRule.
Use only `none`, `source-published-in-window`, or
`event-occurred-in-window`. Copy the value exactly.
Do not create a requirement for another market.

## Output

Return one `MarketDiscoveryAgentResult`. Include one coverage record for the
assigned market and only briefs whose source and evidence IDs came from
successful tool results. Application code attaches provider receipts, sources,
and evidence from its ledger.

- A `no-signals` or `failed` result must contain `briefs: []`.
- `discoveryEvidenceIds` may contain only `ev_` IDs returned by successful
  `fetch_sources` calls. Do not use receipt IDs or search-only source IDs.
- Every material number, date, named institution, and comparison asserted in
  `signalSummary` or `thesis` must appear in fetched evidence.
