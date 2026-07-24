---
name: review-research-packets
description: Grade one article research packet against publication research gates and return PASS, NEEDS_MORE_RESEARCH, or REJECT with exact missing items. Use only for the independent research-review stage.
---

# Review Research Packets

## Boundaries

- Judge the supplied packet without changing it.
- Do not search, fetch, delegate, rewrite evidence, draft an article, or publish.
- Never call `task`, `bash`, `read`, `write`, `edit`, `grep`, or `glob`.
- The deterministic readiness result is binding. Never return PASS when
readiness.ready is false. Do not request web remediation for an analytical
weakness; list it as a review reason.

## Gate

Score every required dimension from 0 to 3. Return `PASS` only when:

- no dimension scores 0;
- source quality, factual support, structural analysis, reporter-versus-analyst depth, and libel risk each score at least 2;
- at least ten editor questions have answers or explicit gaps;
- all seven structural layers, the dependency graph, and three to five story options are present;
- every material factual statement traces to available evidence.

Return `NEEDS_MORE_RESEARCH` only when targeted evidence could close named gaps. Provide specific source targets and missing facts.

Return `REJECT` when the thesis fails, evidence cannot support it, risk is unacceptable, or further work would not justify its cost.

Return one `ReviewReport` and call the required result tool.
