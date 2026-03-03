# PRD — Final Report Flow Hardening + Labor Total Override (No Mode Switch)

## Original Problem Statements
1. Remove labor-confirmation gate (`diagnostic -> labor_confirmation -> final_report`) and transition directly to Final Report with mandatory labor breakdown + total.
2. In `final_report` mode, allow technicians to request labor total recalculation (EN/RU/ES phrasing) and regenerate Final Report in place without switching back to diagnostics.

## Architecture Decisions
- Context Engine remains the only flow authority for diagnostics and pivot decisions.
- `labor_confirmation` is retired as a runtime chat mode; direct transition to `final_report` is deterministic.
- Labor override is implemented as an **edit-in-place** behavior only when `currentMode === "final_report"`.
- Canonical labor formatting is enforced as one decimal place: `Total labor: X.X hr`.
- Final report responses continue to pass through language policy enforcement (`enforceLanguagePolicy`) and mode validation.

## What Has Been Implemented
1. **Runtime flow update (`src/app/api/chat/route.ts`)**
   - Removed labor-confirmation runtime branches and events.
   - Direct transition path: diagnostic response streams, mode transitions to `final_report`, final report is generated immediately.

2. **Final Report labor override path (new)**
   - Added helpers:
     - `parseRequestedLaborHours(message)`
     - `detectLaborOverrideIntent(message)`
     - canonical format helpers (`normalizeLaborHours`, `formatLaborHours`)
   - Trigger rule:
     - only in `final_report`
     - requires numeric labor target + labor/total/time lexical intent
   - On trigger:
     - stays in `final_report` (no mode switch)
     - regenerates Final Report using final-report prompt + fact lock + mandatory labor override constraints
     - rewrites labor section to requested total and requires `Total labor: X.X hr`
     - blocks diagnostic bleed via correction constraints (no `Step`, no `wp_`, no follow-up questions)

3. **Fallback + validation hardening**
   - Final-report fallback now supports dynamic labor hours and canonical total format.
   - Added override-specific labor validations:
     - `validateLaborSum` on primary (non-translation) block
     - exact canonical total-line check (`Total labor: X.X hr`)
   - One retry with correction instruction before fallback.

4. **Tests added/updated**
   - `tests/chat-transition-final-report.test.ts`
     - existing transition tests preserved
     - added override tests:
       - no mode switch in final_report
       - canonical total output (`1.0` normalization)
       - RU override parsing (`сделай 1 час на все`)
       - non-keyword path does not trigger override
   - `tests/chat-final-report-override-intent-false-positive.test.ts`
     - regression guard: message `make step 2 clearer` must **not** trigger labor override.

## Validation Run
- `yarn lint`: **0 errors** (warnings only).
- Targeted tests:
  - `tests/chat-transition-final-report.test.ts` ✅
  - `tests/chat-final-report-override-intent-false-positive.test.ts` ✅
- Full suite (`yarn test`): still has unrelated pre-existing failures:
  - `tests/retention.test.ts` (5)
  - `tests/input-language-lock.test.ts` (6)

## Prioritized Backlog
### P0
- Stabilize unrelated failing suites (`retention`, `input-language-lock`) to restore green baseline.
- Add one E2E case asserting semantic preservation of non-labor sections after labor override.

### P1
- Modularize chat route override/transition generation into dedicated helpers to reduce route complexity.
- Add stricter semantic diff checks for non-labor sections (Complaint/Verified Condition/Parts).

### P2
- Add observability counters for override trigger, retry rate, and fallback usage.
- Optional structured extraction for labor breakdown analytics.

## Next Tasks
1. Add a deterministic semantic-preservation assertion helper for override responses.
2. Resolve unrelated failing suites so `yarn test` can pass fully.
3. Add translation-required (RU/ES) end-to-end fixtures for override flow.
