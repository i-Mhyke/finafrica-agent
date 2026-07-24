# Reviewer Gate

## Contents

- [Reviewer Contract](#reviewer-contract)
- [Review Dimensions](#review-dimensions)
- [Decision Rules](#decision-rules)
- [Reviewer Output Template](#reviewer-output-template)
- [Red Flags](#red-flags)

## Reviewer Contract

Every selected research packet must pass review before writing and publishing. The reviewer returns exactly one decision:

- `PASS`
- `NEEDS_MORE_RESEARCH`
- `REJECT`

Only `PASS` proceeds to article writing and EmDash publication.

Use a separate reviewer model/tool when available. Pass the reviewer the research packet, source ledger, candidate decision, and proposed output type. Do not pass hidden conclusions that are not visible in the evidence.

If no reviewer model/tool is available, perform a separate labeled reviewer pass. In production, do not autopublish without an actual reviewer gate.

## Review Dimensions

Score each dimension from 0 to 3.

| Score | Meaning |
| --- | --- |
| 0 | Fails requirement |
| 1 | Weak, risky, or incomplete |
| 2 | Adequate with minor gaps |
| 3 | Strong and publishable |

Dimensions:

1. **Source quality:** Are sources named, verifiable, and appropriate to the claim?
2. **Decision relevance:** Would a senior financial professional care?
3. **Factual support:** Is every material claim traceable to evidence?
4. **Signal strength:** Is this a real institutional signal, not noise or PR?
5. **Financial/material impact:** Are money, risk, regulation, strategy, market access, or institutional behaviour affected?
6. **Non-promotional filter:** Has company marketing been challenged or contextualized?
7. **Libel and allegation risk:** Are accusations handled only with credible reporting and right-of-response context?
8. **Why/how depth:** Does the packet explain significance and mechanism?
9. **Actionability:** Does the research identify what affected actors should do now?
10. **Structural analysis:** Does the packet complete facts, editor's questions, question-led research, dependency graph, seven-layer analysis, story options, and recommended lede?
11. **Reporter vs analyst test:** Does it explain who loses money, who gains power, and what becomes possible that was not possible before?

## Decision Rules

### PASS

Use only when:

- No dimension scores 0.
- Source quality, factual support, structural analysis, reporter-vs-analyst test, and libel risk each score at least 2.
- At least 10 editor's questions are present and were researched.
- All seven analysis layers are present. Empty layers explicitly say no evidence found instead of disappearing.
- A dependency graph and 3-5 story options are present.
- The packet has a clear `WHY IT MATTERS` and `HOW IT CHANGES THINGS`.
- Policy, regulation, market-structure, infrastructure, fraud, identity, capital, and institutional-impact packets include `WHAT KEY PLAYERS SHOULD DO NOW`.
- The proposed article type fits the evidence.
- Any uncertainty is explicitly labeled.

### NEEDS_MORE_RESEARCH

Use when:

- The signal is likely valuable but evidence is incomplete.
- The packet jumps from facts to analysis without editor's questions.
- Fewer than 10 uncomfortable questions were generated.
- The dependency graph, story options, or one of the seven layers is missing.
- The analysis does not identify losers, pricing power, stack changes, institutional power shifts, or what becomes possible or inevitable next.
- A key number, date, source, affected institution, or deadline is missing.
- The story relies too heavily on a company claim.
- A Tier 2 report needs primary-source corroboration.
- Social signal evidence is interesting but not yet pattern-backed.
- The actionability section is generic, missing, or not actor-specific.

The reviewer must list exact missing items and suggested source targets.

### REJECT

Use when:

- The signal is not decision-relevant.
- The story is promotional or a routine announcement.
- A material claim is unsourced and cannot be removed without collapsing the story.
- The research includes unverified allegations.
- The item creates unacceptable libel, hallucination, or credibility risk.
- The item would be filler for publication volume.
- The output is only a competent summary of what happened and why it generally matters.

## Reviewer Output Template

```markdown
# Review Report

DECISION: PASS / NEEDS_MORE_RESEARCH / REJECT

SCORES:
- Source quality:
- Decision relevance:
- Factual support:
- Signal strength:
- Financial/material impact:
- Non-promotional filter:
- Libel and allegation risk:
- Why/how depth:
- Actionability:
- Structural analysis:
- Reporter vs analyst test:

BLOCKERS:
- ...

REQUIRED FOLLOW-UP:
- ...

APPROVED OUTPUT TYPE:
- Structured intelligence brief / Full analysis / Company deep dive / Policy explainer

PUBLICATION NOTES:
- Signal field:
- Location:
- Tags/categories:
- Cautions for writer:
```

## Red Flags

Block or reject when you see:

- Figures with no source, period, or denominator.
- "According to reports" without naming the report.
- One social post treated as a trend.
- A press release rewritten as analysis.
- A policy or regulatory article with no primary-source status and no explanation of the missing document.
- A serious institutional-impact article that does not say what affected players should do now.
- No editor's questions.
- No losers.
- No dependency graph.
- No distinction between legal change and operational market change.
- Layer 6 only checks regulators while ignoring banks, infrastructure providers, vendors, creditors, DFIs, incumbents, and other institutions that may gain leverage.
- Layer 7 only checks policy follow-ons while ignoring competitor responses, capital allocation signals, and technology-enabled possibilities.
- Official benefits repeated without the kill-the-press-release check.
- "First", "largest", "leading", or "transformative" with no evidence.
- Claims about fraud, insolvency, misconduct, sanctions, or breaches without credible sourcing.
- Africa-wide conclusions from one-country evidence.
