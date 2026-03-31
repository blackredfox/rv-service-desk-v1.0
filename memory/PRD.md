# PRD / Task Handoff

## Original problem statement
Fix language leakage in diagnostic output where Russian input sessions were detected as RU but structured diagnostic output (headers, progress lines, step labels, and step content) still leaked English in diagnostic mode. Scope included prompt construction, LLM execution, diagnostic context injection, validation/repair, route assembly, and regression tests.

## Architecture decisions
- Kept the existing diagnostic flow authority in the context engine and registry.
- Fixed leakage deterministically at the server-side metadata layer instead of trusting prompt behavior alone.
- Hardened validation to use the effective output language and to explicitly detect English structured diagnostic leakage in non-English sessions.
- Kept the fix minimal and targeted to the reproduced water-heater path while making the fallback/validation path language-aware.

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

## Prioritized backlog
### P0
- Extend deterministic localization coverage beyond water-heater to the rest of the diagnostic procedure catalog.
- Add route/integration regression covering the exact RU reproduction flow end-to-end with mocked OpenAI output.

### P1
- Add localized procedure metadata for ES where deterministic server-side structured output is required.
- Add additional validator heuristics for mixed-language free-text leakage beyond structured headers.

### P2
- Move procedure localizations into a dedicated localization module or data file to reduce maintenance cost.
- Add snapshot-style tests for localized authoritative fallback blocks by language.

## Next tasks
- Localize the remaining diagnostic procedures.
- Add an end-to-end chat route regression for RU diagnostic sessions with active-step rendering and fallback/repair coverage.
