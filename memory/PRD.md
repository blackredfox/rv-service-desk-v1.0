# PRD — Prompt Persona Phase 1 Test/Validator Stabilization

## Original Problem Statement
Fix failing tests after the Prompt Persona Phase 1 refactor on branch `feat/prompt-persona-phase1` without reverting or modifying any frozen prompt files. Update outdated tests to the new prompt contract, fix validator/runtime logic where tests expose real issues, fix guided diagnostics behavior for unknown/no-information responses, preserve prompt file locations, and make `yarn vitest run` pass.

## Architecture Decisions
- Kept all prompt files frozen and unchanged.
- Updated prompt-facing tests to assert the new persona/tone/procedure wording instead of legacy wording.
- Fixed validator behavior in code only where contract logic was genuinely wrong or too narrow:
  - output-validator now normalizes legacy state aliases and catches numbered lists more robustly.
  - mode-validators now default unknown language fallback to EN.
- Fixed guided diagnostics progression in `diagnostic-registry` by closing the current next procedure step when the technician gives a generic unknown / unable-to-verify reply.
- Preserved prompt composer path behavior; tests continue to validate loading from `prompts/system` and `prompts/modes`.
- Generated Prisma client locally to restore the full test environment after dependency install.

## What’s Implemented
- Updated `tests/prompt-enforcement.test.ts` to match the new senior RV technician prompt contract.
- Updated `tests/tone-adjustment.test.ts` to match new tone/acknowledgment wording.
- Updated `tests/prompt-composer.test.ts` and `tests/lang-spanish-detection.test.ts` to align with current runtime behavior.
- Updated `tests/guided-diagnostics.test.ts` to verify actual state-machine progression rather than stale prompt text.
- Fixed `src/lib/output-validator.ts` state normalization + numbered-list detection.
- Fixed `src/lib/mode-validators.ts` fallback behavior for undefined/null/unknown language.
- Fixed `src/lib/diagnostic-registry.ts` so generic unknown replies advance the procedure instead of repeating the same step.
- Ran `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/rv_service_desk' npx prisma generate`.
- Verified full `yarn vitest run` passes.

## Prioritized Backlog
### P0
- Keep CI/test environment generating Prisma client deterministically before Vitest runs.
- Add one explicit regression test for `can't check` / `unknown` advancement on a second procedure path beyond water pump.

### P1
- Consolidate legacy vs current state naming in validator callers so alias normalization eventually becomes unnecessary.
- Review other prompt-content tests for any remaining brittle wording assertions.

### P2
- Improve lint/ESLint TypeScript parsing setup for tool-based linting consistency.
- Add a lightweight test helper for frozen prompt contract assertions to reduce repeated file reads.

## Next Tasks
- Validate the same branch in CI to confirm no environment-specific differences.
- If new prompt phases continue, keep tests wording-driven but anchored to stable contractual phrases only.
