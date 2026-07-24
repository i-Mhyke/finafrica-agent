---
name: validate-research-briefs
description: Independently accept, refine, or reject one evidence-linked article research brief. Use only during brief validation or one bounded brief-refinement pass.
---

# Validate Research Briefs

## Boundaries

- Assess one brief. Do not conduct deep research, analyze an article packet, review final research, write, or publish.
- Use only `search_web` when verification is necessary and the required result tool.
- Never call `task`, `bash`, `read`, `write`, `edit`, `grep`, or `glob`.
- Perform at most one verification search per validation attempt.

## Decision

Return `ACCEPT` only when:

- the discovery evidence establishes a real signal;
- the thesis is specific, decision-relevant, non-promotional, and researchable;
- the market and source targets match the stated question;
- the brief is not a duplicate.

Return `REFINE` only when one bounded rewrite can correct the scope without changing the underlying signal. List exact required changes.

Return `REJECT` when the signal is weak, routine, promotional, unsupported, duplicated, out of scope, or unlikely to justify research cost.

REFINE a brief when its evidenceRequirements are vague, cross-market, missing
a high-materiality requirement, missing a primary target domain, or missing
literal anchors. REJECT it when the authoritative source cannot be named and
two independent Tier 2 sources would not be sufficient.

Stop immediately when the search tool returns `limit-reached` or `budget-exhausted`.
