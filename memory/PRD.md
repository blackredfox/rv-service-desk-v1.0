# PRD — Spanish Detection + Language Fallback Update

## Original Problem Statement
Fix Spanish language detection and stop English-only fallback behavior for inputs like:
- "LA BOMBA DE AGUA NO FUNCIONA"
- "habla espanol" / "habla español" / "spanish"

Keep final-report rules unchanged (English + translation for RU/ES).

## Architecture Decisions
- Kept changes scoped to language handling and route language-policy selection only.
- Added explicit forced-language detection helper in `lang.ts`.
- Preserved streaming/SSE shape, mode flow, and final-report translation policy.
- Added focused deterministic tests without network or UI changes.

## What Has Been Implemented
1. `src/lib/lang.ts`
   - Added Spanish RV keyword heuristics: `bomba, agua, funciona, grifo, voltios, fusible, cable, relé/rele`.
   - Added explicit forced Spanish detection for:
     - `habla espanol`
     - `habla español`
     - `spanish`
   - `detectLanguage(...)` now returns ES with high confidence for explicit Spanish requests and for strong RV Spanish keyword hits.
   - Added neutral language-choice fallback helper:
     - `Please choose language: English / Русский / Español`

2. `src/app/api/chat/route.ts`
   - Uses `detectForcedOutputLanguage(message)` before output policy resolution.
   - If explicit Spanish request is present, output mode is forced to `ES` and tracked dialogue language is set to `ES` for this turn.
   - Diagnostic dialogue therefore follows Spanish for detected/forced Spanish inputs.
   - Final-report logic remains unchanged.

3. `src/lib/mode-validators.ts`
   - Unknown language fallback no longer defaults silently to EN.
   - Returns neutral fallback message instead:
     - `Please choose language: English / Русский / Español`

4. Tests
   - Updated `tests/chat-route.test.ts` with two acceptance-oriented route tests:
     - Uppercase Spanish RV input produces `outputEffective: ES` and Spanish dialogue directive.
     - `habla espanol` forces Spanish output even if request asks EN.
   - Added `tests/lang-spanish-detection.test.ts`:
     - ES detection for uppercase RV phrase
     - explicit Spanish force phrases
     - neutral language-choice fallback behavior

## Validation Run
- Passed:
  - `yarn test tests/lang-spanish-detection.test.ts tests/chat-route.test.ts`

## Prioritized Backlog
### P0
- Add an end-to-end API test fixture for mixed-case/ASCII Spanish (`rele`, uppercase variants, punctuation-free phrases).

### P1
- Extend forced-language parser to support explicit RU/EN switch phrases with same deterministic precedence.

### P2
- Add lightweight telemetry counter for language override usage and confidence buckets.

## Next Tasks
1. Add multilingual language-switch acceptance tests at API level (RU/EN parity with ES).
2. Consider surfacing detected language + reason in internal diagnostics panel (server-only logs already present).
3. Keep prompt/content contracts unchanged while improving language UX robustness.
