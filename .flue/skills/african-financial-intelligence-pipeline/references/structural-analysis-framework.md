# Structural Analysis Framework

## Contents

- [1. Facts](#1-facts)
- [2. Editor's Questions](#2-editors-questions)
- [3. Research Against the Questions](#3-research-against-the-questions)
- [4. Seven-Layer Analysis](#4-seven-layer-analysis)
- [5. Dependency Graph](#5-dependency-graph)
- [6. Kill the Press Release Check](#6-kill-the-press-release-check)
- [7. Story Options](#7-story-options)
- [8. Recommended Lede](#8-recommended-lede)
- [Required Research Packet](#required-research-packet)

Use this reference before writing any analysis. The required sequence is:

```text
FACTS -> EDITOR'S QUESTIONS -> RESEARCH AGAINST THOSE QUESTIONS -> ANALYSIS
```

Do not skip from source collection to article drafting. The questions are the product.

## 1. Facts

Strip the development down to sourced facts:

- What literally happened?
- Who announced it?
- What document, filing, circular, statement, report, or dataset supports it?
- What date or period does it apply to?
- What does the source not say?

Remove:

- "Leading", "transformative", "first", "seamless", "inclusive", and other unproven claims.
- Assumed benefits.
- Conclusions that belong in analysis.

## 2. Editor's Questions

Generate at least 10 uncomfortable questions before answering any of them.

Every set must include questions that probe:

1. Assumptions in the official announcement.
2. Which business models are affected.
3. Who loses money, relevance, access, margin, or defensibility.
4. Who gains pricing power.
5. Whether a layer of the stack collapses.
6. Which regulator, bank, infrastructure provider, vendor, creditor, DFI, incumbent, or other institution gains leverage.
7. What becomes possible or inevitable next.
8. Whether this is a legal change, implementation milestone, capability milestone, or enforcement signal.
9. What already existed informally or through alternatives.
10. What the announcement is trying to make the market not notice.

Do not answer the questions in this step. Generate them first.

## 3. Research Against the Questions

Return to sources and answer the questions one by one.

Rules:

- Answer with sourced facts where possible.
- If no credible source answers a question, say `No credible source found yet`.
- Do not invent numbers or fill evidence gaps with confident inference.
- Mark careful analysis as `Inference from sourced facts`, not fact.

## 4. Seven-Layer Analysis

Run every significant development through all seven layers. If a layer yields nothing, state that explicitly.

### Layer 1 - What Actually Changed?

Ask: What literally became possible today that was not possible yesterday?

If the honest answer is "nothing yet", say so. Many announcements are policy signals, not operational changes.

### Layer 2 - Is This Actually New?

Ask:

- Has the market already been doing this informally?
- Is this legal recognition of existing practice?
- Is this an implementation milestone or a capability milestone?
- Is this enforcement of an existing rule?
- Is this signalling future policy rather than present change?

### Layer 3 - Who Loses?

Always identify likely losers or explicitly state that no identifiable loser emerged from the research.

Ask:

- Which vendors or intermediaries become less valuable?
- Which revenue pools shrink?
- Which startups face a harder path to market?
- Which compliance businesses benefit at the expense of others?
- Which incumbents become harder to challenge?

### Layer 4 - Who Gains Pricing Power?

Ask:

- Who controls access to the new capability or infrastructure?
- Who owns the API, data, licence, settlement point, or integration point?
- Who sets pricing for access?
- Who controls uptime and therefore other institutions' reliability?
- Who becomes indispensable?

### Layer 5 - Does This Collapse a Layer of the Stack?

Draw the current dependency chain and possible future chain.

Example:

```text
Current:  Customer -> Bank -> Identity Vendor -> NIMC
Possible: Customer -> Bank -> NIMC
```

If a layer disappears or becomes less defensible, that is often the story.

### Layer 6 - Who Gains Institutional Power?

Sometimes the story is not technology or markets. It is power. The entity that gains power is not always a regulator; it can be a bank, infrastructure provider, payments switch, DFI, creditor, dominant market participant, or vendor.

Ask whether the development shifts leverage between:

- Central banks and other regulators.
- Federal and state institutions.
- Local and international bodies.
- Public and private infrastructure.
- Sector regulators such as banking, telecoms, insurance, pensions, securities, data protection, and tax.
- One bank and its peers.
- An incumbent and challengers.
- A vendor and its customers.
- A creditor and a debtor.
- A DFI or investor and the institution receiving capital.

Power shifts have long tails regardless of where they occur. An infrastructure provider gaining a monopoly position can matter as much as a regulator gaining new enforcement authority.

### Layer 7 - What Becomes Possible or Inevitable Next?

The announcement itself is rarely the most important story. What it enables usually is. Apply this layer to policy, competitor activity, capital flows, and technology.

For policy developments, ask:

- What new regulatory requirements could now be enforced?
- What new products or services does this now permit or mandate?
- What consolidation or market exit does this make logical or inevitable?

For competitor activity, ask:

- If a bank just reported record profits, what acquisition, expansion, pricing move, or balance-sheet shift becomes more probable?
- If an institution posted large impairments, what regulatory intervention, capital raise, risk tightening, or restructuring becomes more likely?
- What do competitors now have to do in response?

For capital flows, ask:

- If this investor entered, who follows?
- What signal does the capital source send to the next capital allocator?
- What follow-on products, infrastructure, or market behavior does this funding make possible?
- What does the source of capital want to see built next?

For technology developments, ask:

- If this capability now exists, what product was previously too expensive or risky but now becomes viable?
- What fraud or evasion pattern does this now enable?
- What regulatory response does this make inevitable?

## 5. Dependency Graph

Build this before choosing the story:

```text
Primary actors
  -> Adjacent actors
  -> Infrastructure providers
  -> Regulators
  -> Customers
  -> Capital markets
```

For each node, write what changes for them.

One development usually contains several possible stories. The dependency graph tells the writer which story is most valuable for the reader.

## 6. Kill the Press Release Check

Assume the official announcement is 30% marketing. For every claimed benefit or milestone, ask:

- Was this impossible yesterday, or merely inconvenient?
- Who already offered this capability?
- Who already solved this problem differently?
- What is genuinely different versus what existed before?
- What is this announcement trying to make the market not notice?

If you cannot answer what is genuinely different, do not repeat the claim as analysis.

## 7. Story Options

Produce 3-5 story options before writing. Each option should focus on a different dependency-graph node.

Template:

```markdown
1. [Story angle]
   - Core claim:
   - Main affected actors:
   - Evidence strength:
   - Why a financial professional would care:
```

## 8. Recommended Lede

The recommended lede is not a summary. It is the single most important structural change the reader needs to understand.

Good ledes answer:

- Who gains power?
- Who loses money or relevance?
- What dependency changes?
- What becomes possible now?

Weak ledes merely say an institution announced something.

## Required Research Packet

Every serious candidate must produce:

```markdown
FACTS:

EDITOR'S QUESTIONS:
1.
...
10.

RESEARCH AGAINST QUESTIONS:

DEPENDENCY GRAPH:

SEVEN-LAYER ANALYSIS:
- Layer 1 - What actually changed:
- Layer 2 - Is this actually new:
- Layer 3 - Who loses:
- Layer 4 - Who gains pricing power:
- Layer 5 - Stack collapse:
- Layer 6 - Who gains institutional power:
- Layer 7 - What becomes possible or inevitable next:

STORY OPTIONS:

RECOMMENDED LEDE:

SOURCES:
```
