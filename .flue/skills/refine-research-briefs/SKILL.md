---
name: refine-research-briefs
description: Apply one bounded validator change set to one research brief without searching, delegating, or changing its evidence.
---

# Refine Research Briefs

## Input

- One `ArticleResearchBrief`.
- One `BriefValidation` whose decision is `REFINE`.

## Method

1. Read `validation.requiredChanges`.
2. Apply each required change once.
3. Preserve all source IDs and evidence IDs exactly.
4. Preserve the brief ID and assigned markets.
5. Return one schema-valid `ArticleResearchBrief`.

## Boundaries

- Do not search, fetch, validate, analyze, review, write, or publish.
- Do not add facts, source IDs, evidence IDs, markets, or unsupported specificity.
- Do not call any tool.
- Do not delegate.
- If a required change cannot be applied from the supplied fields, preserve the original field instead of inventing information.
