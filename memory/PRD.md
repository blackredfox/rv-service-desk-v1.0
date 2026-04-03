# PRD — Missing Procedure Coverage for Customer-Requested Equipment

## Original Problem Statement
Add missing procedure coverage for customer-requested equipment that currently does not exist as dedicated procedure families in the codebase. This is a missing-procedure gap task, not a simple howToCheck wording task. Confirmed missing-procedure gaps: solar_system, aqua_hot_system, bmpro_system, ice_maker. Keep the PR narrow and limited to procedure/catalog/test files unless a tiny supporting type addition is strictly necessary. Do not touch route/orchestration/auth/billing/admin/prompt files. For each target item, add detection coverage where applicable, a dedicated procedure family or equivalent valid procedure coverage structure, minimal technician-facing steps, bounded howToCheck support, and minimal tests proving the family coverage exists and is wired as expected.

## Architecture Decisions
- Kept all runtime authority unchanged; only the existing procedure registry and its direct tests were updated.
- Added the four missing families directly inside `src/lib/diagnostic-procedures.ts` to match the current flat registry architecture.
- Avoided non-procedure file changes because existing type/schema files were not required for runtime or test validity.
- Extended only directly related tests in `tests/unit/diagnostic-procedures.test.ts` and `tests/procedures/procedure-contract-audit.test.ts`.

## What’s Implemented
- Added system detection patterns for `solar_system`, `aqua_hot_system`, `bmpro_system`, and `ice_maker`.
- Added dedicated procedure registrations for all four families with minimal technician-facing step sets.
- Added bounded `howToCheck` guidance for every new step.
- Added direct tests for detection and dedicated procedure retrieval.
- Extended contract audit coverage so the new customer-requested families are verified as registered and fully guided.

## Prioritized Backlog
### P0
- None for this scope; requested missing-family coverage is now present and verified.

### P1
- Optional follow-up: add deeper branch coverage for these new families if future diagnostic data shows repeated dead ends.
- Optional follow-up: add multilingual localizations for the newly added families if these procedures need RU/ES parity.

### P2
- Refactor `src/lib/diagnostic-procedures.ts` into smaller family modules for maintainability.
- Backfill older howToCheck gaps still warned in audit output for `slide_out` and `inverter_converter`.

## Next Tasks
- If requested, deepen one or more of the new families with manufacturer-specific variants or branches.
- If requested, add procedure-audit coverage for more family-specific ordering assumptions.
