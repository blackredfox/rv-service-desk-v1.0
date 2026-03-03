# PRD — Chat API Route Update

## Original Problem Statement
Replace code behavior in `src/app/api/chat/route.ts` by applying only two logic updates (not full file replacement):
1. Update `isLaborOverrideRequest` to use `shouldTreatAsFinalReportForOverride(...)`
2. Add a diagnostic-mode validation guard after `validateOutput(...)` calls

## Architecture Decisions
- Kept existing Next.js API route architecture unchanged.
- Added minimal helper logic inside `route.ts` only; no cross-file refactors.
- Preserved current flow/state handling and fallback behavior.

## What Has Been Implemented
- Added final-report heuristic helpers:
  - `looksLikeFinalReport(...)`
  - `lastAssistantLooksLikeFinalReport(...)`
  - `shouldTreatAsFinalReportForOverride(...)`
- Updated labor override gate:
  - from strict `currentMode === "final_report"`
  - to `shouldTreatAsFinalReportForOverride(currentMode, history)`
- Added route-level diagnostic guard:
  - `applyDiagnosticModeValidationGuard(...)`
  - applied immediately after `validateOutput(...)` results to force invalidation when diagnostic output drifts into final-report section format.

## Prioritized Backlog
### P0
- Add focused unit tests for:
  - labor override detection when final report exists in history but mode is not yet switched
  - diagnostic guard invalidation behavior

### P1
- Deduplicate/centralize final-report detection heuristics between route and validators.
- Add structured metrics for guard-trigger frequency.

### P2
- Expand multilingual labor-override intent patterns and synonym coverage.

## Next Tasks
1. Add/update tests around `POST /api/chat` for labor override and diagnostic drift scenarios.
2. Validate end-to-end behavior with representative conversation fixtures.
3. Consider consolidating guard logic into shared validator module for single-source enforcement.
