# PRD / Task Handoff

## Original problem statement
1. Fix language leakage in diagnostic output where Russian input sessions were detected as RU but structured diagnostic output (headers, progress lines, step labels, and step content) still leaked English in diagnostic mode.
2. Fix water-heater dominant-fact step resolution so a negative `wh_5` finding (`No 12V DC`) does not continue into downstream ignition checks and instead pivots into upstream 12V supply diagnostics.
3. Preserve clarification behavior, existing branch behavior, and the recently fixed RU language behavior.

## Architecture decisions
- Kept diagnostic flow authority in the existing context engine + diagnostic registry.
- Fixed RU leakage deterministically at the server-side metadata/rendering layer instead of trusting prompt behavior alone.
- Implemented the `wh_5` fix as a narrow deterministic branch extension inside the existing water-heater procedure model instead of rewriting the broader diagnostic engine.
- Reused the current branch-runtime flow (`processResponseForBranch` + branch-aware next-step resolution) so the fix remains localized and regression-testable.

## Implemented
- Added deterministic RU localization for water-heater procedure display name, active-step questions, and how-to-check instructions in `src/lib/diagnostic-procedures.ts`.
- Updated `buildProcedureContext`, `buildRegistryContext`, and `getActiveStepMetadata` to render localized structured diagnostic context using the effective output language.
- Updated `src/app/api/chat/route.ts` to pass the effective output language into registry context and active-step metadata retrieval.
- Strengthened `buildLanguageDirectiveV2` so prompt instructions explicitly require translating any injected procedure metadata into the output language.
- Hardened `validateLanguageConsistency` to catch English diagnostic markers like `Progress:` / `Step wh_*:` in RU/ES sessions.
- Updated primary response validation to validate against the effective output language, not only tracked input language.
- Updated retry correction + safe fallback so language mismatches fall back to a localized authoritative active-step response instead of leaking English fallback text.
- Added regression tests in `tests/diagnostic-language-lock.test.ts`.
- Installed project dependencies after upgrading Node to v22 so Vitest could run in this container.
- Added a new water-heater `no_12v_supply` branch triggered by negative `wh_5` responses in `src/lib/diagnostic-procedures.ts`.
- Added upstream 12V supply diagnostic steps `wh_5a`, `wh_5b`, and `wh_5c` with RU localizations so `wh_5` negative answers now pivot upstream before ignition diagnostics.
- Added 3 targeted regressions in `tests/water-heater-diagnostic.test.ts` for:
  - negative `wh_5` blocks downstream path and enters upstream branch
  - positive `wh_5` still continues to `wh_6`
  - clarification at `wh_5` does not advance or trigger the branch
- Updated water-heater RU language-lock expectations from 21 to 24 total steps to reflect the new deterministic branch steps.

## Verified on 2026-03-31
- `yarn vitest run tests/water-heater-diagnostic.test.ts tests/diagnostic-language-lock.test.ts tests/branch-aware-resolution.test.ts`
- `yarn vitest run tests/p1.7-terminal-state.test.ts`
- `yarn vitest run tests/branch-runtime-integration.test.ts tests/p1-5-branch-runtime-integration.test.ts`
- Testing agent report: `/app/test_reports/iteration_27.json` — 100% backend pass across 90 targeted tests, no issues.

## Dominance-rule expansion proposal (analysis only, not implemented)
- Best next step: introduce a small procedure-level blocker metadata layer in `src/lib/diagnostic-procedures.ts` for prerequisite facts that should dominate downstream steps.
- Suggested shape: `blockingRules[]` with fields like `triggerStepId`, `triggerPattern`, `blockDownstreamStepIds`, `entryBranchId | entryStepId`, `resolutionStepId`, and optional `clearPattern`.
- Runtime hook: evaluate blocking rules inside `src/lib/diagnostic-registry.ts` alongside branch processing, storing an active blocker state separate from ordinary branch state.
- Resolver hook: update next-step resolution so active blockers outrank ordinary main-flow progression until explicitly cleared.
- Good first candidates after `wh_5`: missing LP supply (`wh_2`/`wh_3`), closed manual gas valve (`wh_4`), and similar prerequisite failures in furnace, LP gas, 12V electrical, and awning procedures.
- Testing approach for future rollout: add one 3-case regression pack per blocker (`negative blocks downstream`, `positive keeps normal path`, `clarification preserved`) before expanding to the next procedure.

## Prioritized backlog
### P0
- Decide whether to generalize the new `wh_5` dominance behavior into reusable blocker metadata across procedures.
- Add route/integration regression covering the exact `wh_5` no-12V runtime path through the chat API.

### P1
- Extend dominance-rule candidates to LP-supply and manual-valve blockers in water-heater and furnace procedures.
- Add localized procedure metadata for ES where deterministic server-side structured output is required.
- Add additional validator heuristics for mixed-language free-text leakage beyond structured headers.

### P2
- Move procedure localizations into a dedicated localization module or data file to reduce maintenance cost.
- Add snapshot-style tests for localized authoritative fallback blocks by language.
- Refactor branch and future blocker metadata into a shared diagnostic rule schema.

## Next tasks
- If approved, design the reusable blocker metadata shape and wire it into the registry without refactoring unrelated flows.
- Add chat-route coverage for the `wh_5` dominant no-12V path.
- Continue localization hardening for remaining diagnostic procedures.
