# Test-Driven Development Flows

This directory contains TDD flow documents that trace complete request scenarios through the SmartScraper architecture. Each document maps steps to testable units.

## Index

| TDD | Title | Scenarios |
|-----|-------|-----------|
| [001](001-nypost-article-flow.md) | NYPost.com Article Flow | Discovery, Known-Config, Rediscovery |

## Purpose

TDD flows serve as:

1. **Test specifications** - Each step maps to unit or integration tests
2. **Architecture validation** - Verify ADR decisions work together
3. **Onboarding docs** - Show how the system handles real requests
4. **Debugging guides** - Trace issues through the pipeline

## Related ADRs

- [ADR-003: Core Engine Architecture](../adr/003-core-engine.md)
- [ADR-009: Decision Rules and Scraping Flow](../adr/009-decision-rules.md)

## Adding New TDD Flows

1. Create `NNN-scenario-name.md` with next sequential number
2. Include:
   - Complete step-by-step trace
   - Test assertions at each step
   - Failure scenarios and recovery
3. Update this README index
