# PRD — NEO TASK: Labor Override Detection + Diagnostic Drift Guard

## Original Problem Statement
Implement a clean, scoped update on branch `feat/final-report-labor-override` to:
1. Improve labor-override intent detection (RU/EN/ES)
2. Allow labor override when a final report exists in history even if mode drifted
3. Add diagnostic drift guard so diagnostic mode cannot emit final-report sections
4. Add focused deterministic tests

## Architecture Decisions
- Kept all runtime behavior changes isolated to `src/app/api/chat/route.ts`.
- Added local helpers in `route.ts` only (no public API shape changes).
- Added test-only exports via `__test__` for deterministic unit assertions.
- Added one focused test file for this task with dependency mocks and no network calls.

## What Has Been Implemented
- Expanded `detectLaborOverrideIntent(message)` vocabulary:
  - EN: change/edit/update/make/set/adjust/override/recalculate/revise
  - RU: includes existing words plus typo `зделай`
  - ES: imperative + infinitive variants (recalcula/recalcular, ajusta/ajustar, hazlo/hacer, cambia/cambiar, edita/editar, actualiza/actualizar)
- Enforced labor override intent shape: valid numeric hours + explicit time unit required.
- Added `computeLaborOverrideRequest(...)` and now computes override path using:
  - `shouldTreatAsFinalReportForOverride(currentMode, history)`
- Added stricter diagnostic drift handling:
  - `applyDiagnosticModeValidationGuard(...)` with dedicated violation code
  - correction instruction when drift is detected
  - deterministic diagnostic fallback question aligned to active step when retry still fails
- Added test-only exports in `route.ts`:
  - `parseRequestedLaborHours`, `detectLaborOverrideIntent`, `looksLikeFinalReport`, `shouldTreatAsFinalReportForOverride`, `applyDiagnosticModeValidationGuard`, `computeLaborOverrideRequest`
- Added tests: `tests/chat-labor-override-drift-guard.test.ts` covering:
  - RU override detection (including typo)
  - ES override detection
  - override path when mode=diagnostic but history already has final report
  - diagnostic drift correction back to guided diagnostic question

## Test Status
- Passed targeted tests:
  - `tests/chat-labor-override-drift-guard.test.ts`
  - `tests/chat-transition-final-report.test.ts`
  - `tests/chat-final-report-override-intent-false-positive.test.ts`
- Full suite `yarn test` has pre-existing unrelated failures in:
  - `tests/retention.test.ts`
  - `tests/input-language-lock.test.ts`

## Prioritized Backlog
### P0
- Stabilize unrelated failing suites (`retention`, `input-language-lock`) outside this scoped task.

### P1
- Add additional negative intent tests (e.g., action words without time unit).
- Add assertions for one-question diagnostic correction consistency across locales.

### P2
- Consolidate final-report drift heuristics between route and validators into one shared utility.

## Next Tasks
1. If desired, address the unrelated failing test suites in a separate scoped PR.
2. Add more multilingual edge-case fixtures for labor intent parsing.
3. Keep monitoring drift guard metrics to tune strictness vs false positives.
