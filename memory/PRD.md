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
- Runtime authority fix: widened `no_12v_supply` and `no_ignition` trigger patterns so bare technician negatives (`no` / `нет`) now activate the intended branch in the real `/api/chat` flow.
- Runtime authority fix: updated the legacy flat `getNextStep()` helper to skip branch steps, preventing branch-only steps like `wh_6a` from leaking into non-branch fallback contexts.
- Runtime authority fix: updated `buildRegistryContext()` to resolve fallback active steps with branch-aware resolution before building prompt context.
- Added `/api/chat` route-level regressions in `tests/chat-route-water-heater-dominance.test.ts` covering:
  - real RU transcript pivot from `wh_5 = нет` to `wh_5a`
  - `wh_6a` no-loop progression (`wh_6a → wh_6b → wh_6c`)
  - positive-path runtime progression
  - clarification preservation in the real route flow
- Added natural-language final-report command detection in `src/lib/prompt-composer.ts` for RU/EN/ES phrases such as `Напиши отчет`, `Напиши Report`, `Write report`, and `Generate report`.
- Route/runtime fix: suppressed diagnostic `procedureContext` fallback in `src/app/api/chat/route.ts` when `isolationComplete=true` or `terminalState.phase !== normal`, preventing `wh_5b`/other steps from leaking after repair-complete messages.
- Added route regressions for:
  - repair-complete runtime message from `wh_5a` stops diagnostic progression
  - RU repair-complete + report-request message transitions to `final_report`
  - EN natural-language `Write report` request transitions to `final_report`
  - clarification behavior remains unchanged
- Strengthened repair/restoration detection in `src/lib/context-engine/context-engine.ts` for explicit RU phrases like `Теперь водонагреватель работает` + `Проблема устранена`, and added fuse-specific fault patterns.
- Added runtime final-report authority facts in `src/lib/fact-pack.ts` (`deriveFinalReportAuthorityFacts`, `buildFinalReportAuthorityConstraint`) so repaired/restored terminal state overrides stale pre-repair findings.
- Updated final-report fallback path (`output-policy.ts`, `response-validation-service.ts`, `openai-execution-service.ts`) to use authoritative terminal facts deterministically when primary final-report output fails validation.
- Added route regressions proving:
  - the exact `wh_5a` Russian repair-complete transcript becomes terminal/isolation-complete with no further step injection
  - `START FINAL REPORT` after that transcript produces repaired/restored source-of-truth report content (failed fuse root cause, fuse replacement corrective action, water heater operational after repair)
- Fixed the real stale server-output authority path in `src/app/api/chat/route.ts`: when diagnostic `offer_completion` is reached with `isolationComplete=true`, the route now bypasses the normal diagnostic LLM/prompt path entirely and streams a deterministic server-built completion response.
- Root-cause documented: stale `Status: isolation not complete` / `Step 6` text was still coming from the standard diagnostic mode prompt path (`prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt`) because the route was still asking the model in diagnostic mode after terminal state had already latched.
- Updated route tests to assert the completion turn makes **no** upstream LLM call (`fetchTriggered=false`) and emits no stale `Step 6` / `Status: Isolation not completed` text.
- Completed a root-level test hygiene cleanup PR: removed zero-byte root junk files, removed unused legacy `vitest.setup.ts`, archived root `test_reports/` to `docs/archive/test-reports/2026-03/`, and added root hygiene rules to docs + `.gitignore`.
- Replaced `.gitignore` with a clean root-approved version to remove accumulated junk/duplicate entries while preserving the intended ignore policy (`coverage`, `test_reports`, Next build output, env files, secrets, etc.).
- Added documentation-only testing governance updates in `docs/TEST_STRATEGY_QA_CONTRACT.md` and `docs/REPO_STRUCTURE.md`: tests validate behavior contracts rather than incidental wording, exact-wording assertions are allowed only for contract-critical text, and assertion taxonomy/checklist guidance is now explicit.
- Applied the doctrine in the first narrow test-only refactor PR by updating exactly two files: `tests/prompts/tone-adjustment.test.ts` and `tests/prompts/prompt-composer.test.ts`.
- Refactor scope: replaced incidental exact-string prompt assertions with behavior/structure assertions around tone contracts, language-directive contracts, and final-report translation structure, while keeping exact checks only for contract-critical markers like mode headings and `--- TRANSLATION ---`.
- Added `rvsd-contract-check` v1 as a small pure evaluation layer in `src/lib/eval/rvsd-contract-check.ts` with machine-readable output (`passed`, `violations`, `checks`, `summary`).
- v1 contract checks cover: diagnostic drift/premature completion/question-shape boundaries, final-report shape + language-policy boundaries, authorization drift boundaries, and an explicit transition-doctrine helper (`semantic completion alone must not be treated as a valid mode switch`).
- Added a tiny fixture set in `tests/fixtures/rvsd-contract-check.ts` and focused tests in `tests/eval/rvsd-contract-check.test.ts`.
- Built benchmark pack v1 on top of the checker with 10 high-signal cases in `tests/fixtures/eval/rvsd-benchmark-pack.ts` and a single focused harness in `tests/eval/rvsd-benchmark-pack.test.ts`.
- Benchmark mix covers: diagnostic drift, premature completion / semantic transition, forbidden translation separator, question-shape violation, final-report missing header, final-report language mismatch, final-report prohibited wording, authorization drift, plus valid diagnostic/final-report controls.
- Aligned architecture test `tests/architecture/no-hidden-authority/chat-no-hidden-authority.test.ts` with current explicit-command behavior: semantic completion alone does not switch modes, but explicit natural-language report commands (e.g. `Write report`) now do.
- Re-ran the full `tests/architecture` block after the alignment; all 24 architecture tests pass with no additional outdated expectations.
- Added a dedicated RU explicit-command architecture assertion (`Напиши отчет`) so Russian natural-language report-mode switching is now locked alongside `Write report`.
- Ran one broader non-architecture test-alignment pass and found only wording/coverage updates — no runtime/code regression.
- Added mixed-language explicit-command coverage (`Напиши Report`) in non-architecture tests and updated outdated test titles/comments that previously implied `START FINAL REPORT` was the only explicit report command.

## Verified on 2026-03-31
- `yarn vitest run tests/water-heater-diagnostic.test.ts tests/diagnostic-language-lock.test.ts tests/branch-aware-resolution.test.ts`
- `yarn vitest run tests/p1.7-terminal-state.test.ts`
- `yarn vitest run tests/branch-runtime-integration.test.ts tests/p1-5-branch-runtime-integration.test.ts`
- `yarn vitest run tests/chat-route-water-heater-dominance.test.ts`
- `yarn vitest run tests/unit/diagnostic-procedures.test.ts tests/integration/diagnostic-how-to-check.test.ts`
- `yarn vitest run tests/chat-route-water-heater-dominance.test.ts tests/chat-transition-final-report.test.ts`
- `yarn vitest run tests/prompts/prompt-composer.test.ts tests/mode-validators.test.ts tests/unit/chat-route-decomposition-services.test.ts`
- `yarn vitest run tests/chat-route-water-heater-dominance.test.ts`
- `yarn vitest run tests/chat-route-water-heater-dominance.test.ts tests/chat-transition-final-report.test.ts tests/p1.7-terminal-state.test.ts tests/completion-detection.test.ts`
- `yarn vitest run tests/chat-route-water-heater-dominance.test.ts`
- `yarn vitest run tests/chat-transition-final-report.test.ts tests/p1.7-terminal-state.test.ts tests/completion-detection.test.ts`
- `yarn vitest run tests/architecture`
- `yarn test` (root hygiene PR validation attempt)
- `yarn vitest run tests/architecture/no-hidden-authority/chat-no-hidden-authority.test.ts`
- `yarn vitest run tests/prompts/prompt-composer.test.ts`
- `yarn vitest run tests/prompts/tone-adjustment.test.ts`
- `yarn vitest run tests/prompts/prompt-composer.test.ts`
- `yarn vitest run tests/eval/rvsd-contract-check.test.ts`
- `yarn vitest run tests/eval/rvsd-contract-check.test.ts tests/mode-validators.test.ts`
- `yarn vitest run tests/eval/rvsd-benchmark-pack.test.ts tests/eval/rvsd-contract-check.test.ts`
- `yarn vitest run tests/mode-validators.test.ts`
- Testing agent report: `/app/docs/archive/test-reports/2026-03/iteration_27.json` — 100% backend pass across 90 targeted tests, no issues.
- Testing agent report: `/app/docs/archive/test-reports/2026-03/iteration_28.json` — 100% backend pass across 158 tests in 9 targeted files, including the real `/api/chat` runtime regressions.
- Testing agent report: `/app/docs/archive/test-reports/2026-03/iteration_29.json` — 100% backend pass across 225 tests in 13 targeted files, including repair-complete/report-intent runtime regressions.
- Testing agent report: `/app/docs/archive/test-reports/2026-03/iteration_30.json` — 100% backend pass across 178 tests in 11 targeted files, including exact `wh_5a` repair transcript and repaired-state final-report authority regressions.
- Testing agent report: `/app/docs/archive/test-reports/2026-03/iteration_31.json` — 100% backend pass across 60 tests in 4 targeted files, confirming the route now bypasses the diagnostic LLM path on completion-offer turns and no longer emits stale `Status` / `Step` text.
- Root hygiene note: `yarn test` is currently blocked by unrelated pre-existing failures outside the hygiene scope (`tests/unit/chat-module-extraction.test.ts` Prisma client import, `tests/input-language-lock.test.ts`, `tests/retention.test.ts`, and `tests/org-activity.test.ts`).

## Dominance-rule expansion proposal (analysis only, not implemented)
- Best next step: introduce a small procedure-level blocker metadata layer in `src/lib/diagnostic-procedures.ts` for prerequisite facts that should dominate downstream steps.
- Suggested shape: `blockingRules[]` with fields like `triggerStepId`, `triggerPattern`, `blockDownstreamStepIds`, `entryBranchId | entryStepId`, `resolutionStepId`, and optional `clearPattern`.
- Runtime hook: evaluate blocking rules inside `src/lib/diagnostic-registry.ts` alongside branch processing, storing an active blocker state separate from ordinary branch state.
- Resolver hook: update next-step resolution so active blockers outrank ordinary main-flow progression until explicitly cleared.
- Good first candidates after `wh_5`: missing LP supply (`wh_2`/`wh_3`), closed manual gas valve (`wh_4`), and similar prerequisite failures in furnace, LP gas, 12V electrical, and awning procedures.
- Testing approach for future rollout: add one 3-case regression pack per blocker (`negative blocks downstream`, `positive keeps normal path`, `clarification preserved`) before expanding to the next procedure.
- Runtime RCA from this fix confirms the general direction is still correct: blocker rules should normalize bare yes/no trigger replies and must be applied before any fallback next-step rendering.
- Additional runtime RCA: explicit natural-language mode commands should be resolved before prompt generation, and terminal/isolation states must suppress any fallback step rendering.
- Additional runtime RCA: final-report generation needs an authoritative latest-state overlay from terminal context/history so earlier pre-repair observations cannot override the repaired/restored final state.
- Additional runtime RCA: suppressing stale `procedureContext` was not enough by itself; the route also needed a hard server-side short-circuit because the base diagnostic mode prompt still contained status/step rendering instructions that could leak into live output.

## Prioritized backlog
### P0
- Decide whether to generalize the new `wh_5` dominance behavior into reusable blocker metadata across procedures.
- Add route/integration regression covering the exact `wh_5` no-12V runtime path through the chat API.
- Review whether other branch trigger steps should accept bare yes/no confirmations in the real route flow, starting with LP/gas prerequisite checks.
- Review whether other natural-language mode commands need the same explicit detection treatment (e.g. authorization phrasing) without broadening to fuzzy inference.
- Generalize repaired-state authority facts beyond the fuse scenario so final reports in other procedures also prefer the latest restored state over stale pre-repair history.
- Review whether other diagnostic terminal/fault-candidate turns also need hard route-level short-circuits instead of relying on prompt compliance.

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
- Extend chat-route coverage to the next blocker candidates beyond `wh_5`.
- Add a small route-level regression pack for terminal/isolation states in other procedures so no fallback step leakage reappears outside water-heater.
- Expand final-report authority fact extraction for other common repair outcomes (wiring, valves, boards, pumps) using the same runtime-source-of-truth pattern.
- Audit other server-rendered diagnostic completion/fault-candidate responses for any remaining prompt-driven stale output paths.
- Continue localization hardening for remaining diagnostic procedures.
