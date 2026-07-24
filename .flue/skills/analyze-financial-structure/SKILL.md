---
name: analyze-financial-structure
description: Convert one normalized article research packet into a StructuralPacket covering dependencies, power, incentives, consequences, story options, and evidence gaps. Use only for structural analysis after regional evidence collection.
---

# Analyze Financial Structure

## Boundaries

- Work only from the supplied normalized packet.
- Do not search, fetch, delegate, change evidence, review the packet, write, or publish.
- Never call `task`, `bash`, `read`, `write`, `edit`, `grep`, or `glob`.
- Attach existing source and evidence IDs to every factual conclusion.

## Analysis

1. Separate observed facts from interpretation.
2. Answer at least ten editor questions or state a precise evidence gap.
3. Map primary actors, adjacent actors, infrastructure, regulators, customers, and capital markets.
4. Complete all seven layers: change, novelty, winners and losers, pricing power, stack effects, institutional power, and new possibilities.
5. Produce three to five distinct story options.
6. Recommend a lede, explain why the change matters and how it changes behavior, and identify actor-specific actions.

Return one `StructuralPacket`. State “no evidence found” where a required layer lacks support; do not invent an answer.
