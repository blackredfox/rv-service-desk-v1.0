# RV Service Desk — PRD & Implementation Memory

## Original Problem Statement
Fix bilingual output bug: EN mode sometimes appends an additional translated section (ES/RU) to the final report. This behavior is correct for RU/ES/AUTO modes but incorrect for EN mode. Root cause: implicit/mixed responsibility between prompt composition, output validation, and language logic. Goal: make translation behavior fully declarative, not prompt-driven.

## Architecture
- **Stack**: Next.js (App Router), TypeScript, Vitest, OpenAI API
- **Key flow**: `lang.ts` (policy) → `prompt-composer.ts` (directives) → `mode-validators.ts` (enforcement) → `route.ts` (wiring + output-layer enforcement)

## What's Been Implemented (Jan 2026)

### Declarative Language Policy Architecture
1. **`src/lib/lang.ts`** — Added `LanguagePolicy` type and `resolveLanguagePolicy()` as single source of truth
   - EN → `includeTranslation: false`
   - RU → `includeTranslation: true, translationLanguage: "RU"`
   - ES → `includeTranslation: true, translationLanguage: "ES"`
   - AUTO → depends on detected input language

2. **`src/lib/prompt-composer.ts`** — `buildLanguageDirectiveV2` and `composePromptV2` now accept `includeTranslation` / `translationLanguage` from policy. EN mode directive says "English only" (no translation mention).

3. **`src/lib/mode-validators.ts`** — `validateFinalReportOutput(text, includeTranslation)` enforces:
   - `includeTranslation=true` → must contain `--- TRANSLATION ---`
   - `includeTranslation=false` → must NOT contain `--- TRANSLATION ---`

4. **`src/lib/output-validator.ts`** — Updated `validateResponse` and `isCauseFormatCorrect` to accept `includeTranslation` param.

5. **`src/app/api/chat/route.ts`** — Wired `LanguagePolicy` through entire pipeline. Added `enforceLanguagePolicy()` output-layer enforcement that strips translation blocks for EN mode as final safety net.

6. **Prompt files** — Removed hardcoded translation rules from `SYSTEM_PROMPT_BASE.txt` and `MODE_PROMPT_FINAL_REPORT.txt`. Translation is now controlled by dynamic directives based on policy.

7. **Tests** — Added `tests/language-policy.test.ts` (28 new tests). Updated `tests/payload-v2.test.ts` for policy-driven API. All 353 tests pass.

## Ownership Model
| Concern | Owner |
|---------|-------|
| Content & format | Prompt files (`prompts/`) |
| Language rules | Config (`LanguagePolicy` in `lang.ts`) |
| Enforcement | Validator (`mode-validators.ts`) + output layer (`route.ts`) |

## Backlog
- P0: None (all acceptance criteria met)
- P1: Consider adding integration tests with mocked OpenAI responses to verify end-to-end behavior
- P2: Add language policy admin UI for dynamic mode configuration
- P2: Improve AUTO mode language detection (consider using LLM-based detection for ambiguous inputs)
