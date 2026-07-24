# Research Provider Baseline — 2026-07-23

## Fixture Coverage
- Discovery cases: 25
- Extraction cases: 20

## Metrics
- **exaDiscoveryRecallByMarket:** not measured
- **exaExtractionAttribution:** not measured
- **apifyFallbackRecovery:** insufficient fallback cases
- **apifyP95CostUsd:** not measured

## Promotion Gates
- **exaDiscovery:** not measured (no API key)
- **exaExtraction:** not measured (no API key)
- **apifyFallback:** APIFY_FALLBACK_ENABLED=false (benchmark gate pending)

## Routing Decision
- Exa: primary search and first-pass extraction
- Apify: fetch fallback only (disabled until benchmark passes)
- Apify search: benchmark comparison only, not in runtime routing
