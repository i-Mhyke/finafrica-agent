# Source Map

## Contents

- [Mandatory Markets](#mandatory-markets)
- [Source Hierarchy](#source-hierarchy)
- [Search Sequence](#search-sequence)
- [Research Depth Standard](#research-depth-standard)
- [Candidate Ledger Fields](#candidate-ledger-fields)
- [Search Query Patterns](#search-query-patterns)

## Mandatory Markets

Search these markets every scan:

- Nigeria
- Kenya
- Ghana
- South Africa
- Egypt

Escalate other African markets when a development is systemic, cross-border, DFI-backed, regionally comparable, unusually large, or directly affects the mandatory markets.

## Source Hierarchy

### Tier 1 - Primary Sources

Use first. These can carry factual claims when directly relevant.

- Central banks and financial regulators: CBN, CBK, Bank of Ghana, SARB, Central Bank of Egypt, SEC Nigeria, NDIC (Nigeria deposit insurance, resolution, liquidation, and revoked institutions), CMA Kenya, FSCA South Africa, FRA Egypt, capital markets authorities.
- Official gazettes, policy documents, laws, bills, circulars, guidelines, enforcement notices.
- Stock exchanges and market operators: NGX, NSE Kenya, GSE, JSE, EGX, bond market and depository notices.
- Audited financial statements, quarterly results, annual reports, investor presentations, exchange filings.
- Government ministries, debt management offices, statistics agencies, tax authorities.
- DFI and multilateral disclosures: IFC, AfDB, Proparco, BII, World Bank, IMF, USAID DCA, EBRD where Africa-relevant.

### Tier 2 - Credible Secondary Sources

Use for discovery, context, and corroboration:

- Reuters Africa
- Bloomberg African coverage
- Financial Times Africa
- BusinessDay Nigeria
- Nairametrics
- The Exchange Africa
- African Business Magazine
- African Banker
- TechCabal for fintech-specific developments
- This Is Africa
- Credible local business publications with named reporting and source trails

### Tier 3 - Social and Behavioural Signals

Use only for pattern detection, not as sole factual support:

- Verified financial professionals, fintech operators, economists, bankers, regulators, and informed users on LinkedIn and X/Twitter.
- Multiple posts across distinct credible voices are required before calling something a signal.
- Treat complaints, workarounds, and product failures as leads requiring verification from stronger sources.

### Avoid or Downgrade

- PR Newswire, Business Wire, sponsored posts, corporate award announcements, generic interviews, CSR updates.
- Anonymous blogs, unattributed posts, republished press releases, sensational outlets.
- Vendor claims about AI, inclusion, transformation, or innovation with no adoption evidence.

## Search Sequence

1. Search Tier 1 sources for each mandatory market and vertical.
2. Search Tier 2 sources for recent reporting and context.
3. Search company investor relations and exchange filings for named institutions found in steps 1-2.
4. Search DFI/multilateral sources for funding, guarantees, credit lines, and market programs.
5. Search social sources only for behavioural patterns or professional commentary.
6. Use broad web search only when source-first search does not yield enough signals or when a specific item needs corroboration.

## Research Depth Standard

Before a candidate can be sent to review, complete this source layer:

- **Primary-source status:** identify the actual law, gazette, regulator circular, official statement, filing, annual report, exchange notice, DFI disclosure, or official dataset behind the signal. If unavailable, say so directly.
- **Corroboration:** use at least one independent credible secondary source for context. If relying on a Tier 2 report for the core fact, look for a Tier 1 confirmation or a second Tier 2 source.
- **Freshness:** prefer the latest official figure or most recent filing. If using older data, state the year and why it is still useful.
- **Implementation detail:** capture deadlines, affected institutions, penalties, compliance steps, transition windows, and regulator follow-up expected.
- **Actionability:** name what each affected actor should do now. If no actor can act differently, the signal is probably too weak for a full article.
- **Source gap:** record missing primary documents, unreleased guidelines, unavailable filings, or unverified figures. Gaps do not automatically block publication, but they must be visible to the reviewer and writer.

## Candidate Ledger Fields

Record every candidate in this structure. Do not send a candidate to review until the editor's questions, dependency graph, and seven-layer analysis have been completed.

```markdown
## Candidate: [working title]

FACTS:
- [Sourced fact stripped of marketing language]

WHO:
WHEN:
WHERE:
VERTICAL:
PRIMARY SOURCE STATUS:
SOURCE TRAIL:
- [Source name] - [tier] - [date] - [URL] - [claims supported]

KEY NUMBERS:
- [number] - [source] - [date/period] - [context]

EDITOR'S QUESTIONS:
1.
...
10.

RESEARCH AGAINST QUESTIONS:

DEPENDENCY GRAPH:
- Primary actors:
- Adjacent actors:
- Infrastructure:
- Regulators:
- Customers:
- Capital markets:

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

WHY IT MATTERS:

HOW IT CHANGES THINGS:

WHAT KEY PLAYERS SHOULD DO NOW:
- [Actor]: [specific near-term action]

MISSING FACTS:

INITIAL DECISION: INCLUDE / HOLD / DISCARD
```

## Search Query Patterns

Combine market, institution, vertical, and timeframe:

- `[market] central bank circular bank capital requirements [month year]`
- `[market] bank results net interest margin impairments NPL [quarter year]`
- `[institution] annual report capital adequacy loan impairment [year]`
- `[market] payment system interoperability settlement fraud central bank`
- `[DFI] [market] bank credit line SME trade finance guarantee`
- `[market] open banking API regulation bank fintech`
- `[market] treasury bill bond issuance Eurobond sukuk bank underwriter`
- `[market] mobile money active accounts transaction value central bank`
