---
name: research-regional-evidence
description: Collect attributable evidence and claim candidates for one accepted article brief in one assigned African market. Use only for deep-research or remediation work that must return an ArticleRegionResearchResult.
---

# Research Regional Evidence

## Boundaries

- Research only the assigned brief and assigned market.
- Do not make cross-market conclusions, redesign the brief, run structural analysis, review the packet, write, or publish.
- Use only `search_web`, `fetch_sources`, and the required result tool.
- Never call `task`, `bash`, `read`, `write`, `edit`, `grep`, or `glob`.

## Method

1. List every unsatisfied high- and medium-materiality requirement.
2. Run the primary-source searches needed to cover those requirements before
   spending all fetch attempts.
3. Reserve at least one fetch attempt for every unresolved high-materiality
   requirement.
4. Fetch context sources only after coverage sources have been selected.
5. Never send more sourceIds than the remaining fetch allowance.
6. Record literal evidence, then derive claim candidates. Mark company statements as `reported-claim` unless independently supported.
7. Record unresolved questions as gaps instead of spending past the cap.

## Stop Conditions

- Deep research permits at most twelve searches and sixteen source attempts for the article-market pair.
- Remediation permits at most six searches and ten source attempts.
- Stop immediately on `limit-reached` or `budget-exhausted`.
- Do not retry a rejected tool call with altered dates, URLs, or delegated work.

## Evidence Standard

- Search snippets are leads, not passing evidence.
- Tier 3 or social sources cannot solely support a material factual claim.
- Keep fact, reported claim, and inference distinct.
- Preserve contradictions and stale-data gaps.

Every medium- or high-materiality factual ClaimCandidate must list the
requirementIds it answers. Retained evidence must contain the literal anchors
for those requirements. In remediation phase, use only the supplied
remediationBrief. Do not reopen satisfied requirements. Do not fetch a URL in
remediationBrief.excludedUrls.
Search only `remediationBrief.requirements`. Permit URLs in each requirement's
`refetchUrls`; forbid URLs in `remediationBrief.excludedUrls`.

Return one `ArticleRegionResearchResult` with receipts, sources, evidence, claims, gaps, status, and any error.
