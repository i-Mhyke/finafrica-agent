---
name: african-financial-intelligence-pipeline
description: Run a production-grade African financial intelligence pipeline for Nigeria, Kenya, Ghana, South Africa, and Egypt, with escalation to other African markets when major signals appear. Use when asked to monitor a timeframe, find recent publishable signals, research a specific financial services topic, produce structured intelligence briefs, full analysis, company deep dives, policy explainers, or autopublish EmDash articles after hard-gated source review. Enforces Facts → Editor's Questions → Research → Analysis, seven-layer structural analysis, dependency mapping, source-first research, reviewer PASS/NEEDS_MORE_RESEARCH/REJECT gates, writing handoff to emma-finance-article-writer, and EmDash publication guardrails.
---

# African Financial Intelligence Pipeline

## Operating Standard

Run this as an accuracy-first, production-oriented research and publishing pipeline for African banking and financial services. The product is not news aggregation. It is decision-relevant intelligence for financial professionals.

Think like an industry analyst mapping an ecosystem, not a reporter summarising an event. Every publication must explain what changes about power, money, market structure, dependencies, and future possibilities.

Every research item must pass this test:

> Would a senior analyst at a Nigerian investment bank find this useful for making a decision?

If the answer is no, discard it.

## Required References

Read these before executing the pipeline:

- [references/source-map.md](references/source-map.md) for markets, source hierarchy, and search sequence.
- [references/vertical-playbooks.md](references/vertical-playbooks.md) for signal-specific research questions.
- [references/structural-analysis-framework.md](references/structural-analysis-framework.md) for editor's questions, dependency maps, seven-layer analysis, and story option selection.
- [references/reviewer-gate.md](references/reviewer-gate.md) for PASS/NEEDS_MORE_RESEARCH/REJECT criteria.
- [references/publication-pipeline.md](references/publication-pipeline.md) before writing or publishing.

For article drafting, load and follow the project skill `emma-finance-article-writer`. Do not duplicate its voice rules here.

## Trigger Modes

Classify the request before searching:

- **Scheduled scan:** Twice-daily production run across mandatory markets and verticals, intended to find multiple publishable signals.
- **Timeframe scan:** Search a user-specified window such as "today", "last 24 hours", "this week", or "since the last run".
- **Specific request:** Deep research on a named company, regulator, market, policy, transaction, technology, or signal.
- **General review:** Broad scan for important recent developments when the user asks to "find articles" or "review the market".

Mandatory markets on every scan: Nigeria, Kenya, Ghana, South Africa, Egypt. Escalate to other African markets only when a signal is materially important, cross-border, systemic, or creates a useful comparison.

## Pipeline

1. **Set the run brief.**
   - Define trigger mode, timeframe, mandatory markets, output targets, and publication count.
   - For scheduled scans, aim for multiple quality publications, but never fill volume with weak signals.
   - If no strong signals appear, treat it as a research failure and run a second pass with broader search terms and adjacent sources.

2. **Search source-first.**
   - Start with Tier 1 and Tier 2 sources in `source-map.md`.
   - Search each mandatory market across the split verticals in `vertical-playbooks.md`.
   - Use broad web search only after source-first search fails to produce enough decision-relevant signals.
   - Never use PR-wire or company promotional material as the only basis for inclusion.

3. **Strip the facts.**
   - State only what the source literally says.
   - Remove marketing language, institutional self-praise, and assumed benefits.
   - Separate confirmed facts from interpretation before asking any analytical questions.

4. **Generate editor's questions before analysis.**
   - Generate at least 10 uncomfortable questions for each serious candidate.
   - Include questions about assumptions, losers, pricing power, stack collapse, institutional power shifts, implementation gaps, existing alternatives, and what the announcement obscures.
   - Do not answer these questions until they have all been written.

5. **Research against those questions.**
   - Go back to Tier 1/Tier 2 sources to answer the questions.
   - If an answer cannot be found in a credible source, say so explicitly. Do not fill gaps with inference.
   - Gather the strongest available primary source for the core claim: law/gazette/circular, regulator note, filing, annual report, official dataset, exchange notice, or DFI disclosure. If the primary source is not available, record that gap explicitly and corroborate with at least two credible secondary sources where possible.

6. **Build the structural analysis packet.**
   - Create a dependency graph: primary actors, adjacent actors, infrastructure providers, regulators, customers, and capital markets.
   - Run all seven analysis layers from `structural-analysis-framework.md`.
   - Produce 3-5 distinct story options from different nodes in the dependency graph.
   - Recommend the lede: the single most important structural change a financial professional needs to understand.
   - Build an actionability packet answering what banks, fintechs, regulators, investors, telcos, insurers, lenders, market operators, or other affected players should do now.

7. **Build a source ledger.**
   - For every candidate signal, capture what happened, source URL, source tier, publication date, market, institutions, numbers, deadlines, source gaps, and missing facts.
   - Keep the original source trail visible enough that a reviewer can audit every claim.

8. **Score and select candidates.**
   - Prefer material changes in regulation, capital, performance, technology infrastructure, market structure, risk, credit, liquidity, or institutional strategy.
   - Reject awards, CSR, generic launches, rebrands, and "excited to announce" content unless a verifiable financial or regulatory consequence exists.

9. **Run the reviewer gate.**
   - Send the research packet to a reviewer model when available. If no reviewer model/tool is available, perform a clearly labeled reviewer pass and do not autopublish in production.
   - Reviewer must return exactly one decision: `PASS`, `NEEDS_MORE_RESEARCH`, or `REJECT`.
   - Only `PASS` can proceed to writing and publishing.

10. **Write with the article skill.**
   - Load `emma-finance-article-writer`.
   - Choose output type from the research, not from convenience.
   - Lead with the structural change, not the announcement.
   - Preserve source links and do not introduce unsupported claims during writing.

11. **Publish through EmDash only after PASS.**
   - Use the README EmDash CLI pattern.
   - Auto-publish by default for production runs.
   - Author is always `The Editorial Team` unless the user changes this policy.
   - Use publication metadata rules in `publication-pipeline.md`.

12. **Save artifacts.**
   - For production readiness, keep a run folder containing: `facts.md`, `editors-questions.md`, `structural-analysis.md`, `research-ledger.md`, `source-pack.md`, `review-report.md`, `article.md`, and `emdash-payload.json`.
   - If publication fails, preserve the passed article and payload for retry.

## Hard Guardrails

- Do not fabricate sources, figures, quotes, filings, dates, market events, or regulatory requirements.
- Do not go straight from facts to analysis.
- Do not publish analysis that only answers what happened and why it generally matters.
- Do not publish without a reviewer `PASS`.
- Do not publish social-media-only claims.
- Do not infer financial figures. If a number is not explicitly sourced, omit it or flag it as missing.
- Do not use a company announcement as fact without attribution and context.
- Do not let a policy, regulation, infrastructure, capital, fraud, identity, or institutional-impact article proceed without a concrete `What key players should do now` answer.
- Do not let an article proceed without naming likely losers or explicitly stating that research found no identifiable losers.
- Do not repeat an official benefit claim unless the research answers whether the change was actually impossible yesterday or merely inconvenient.
- Do not create filler when no signal is found. Run a second pass, then report the research failure.
- Do not use `--draft` in scheduled autopublish unless the user explicitly changes the automation policy.
- Do not alter EmDash content already published unless asked to correct or update it.

## Default Output Types

- **Structured intelligence brief:** Use for useful but narrower signals.
- **Full analysis:** Use when a signal has market-wide implications or needs a "why/how" explanation.
- **Company deep dive:** Use when the company, filing, strategy, funding, licence, or performance shift is the story.
- **Policy explainer:** Use when a regulation, circular, law, central bank action, tax change, or enforcement item changes institutional behaviour.

Weekly roundups and daily signal digests are separate newsletter/channel products. Do not default to them unless explicitly triggered.
