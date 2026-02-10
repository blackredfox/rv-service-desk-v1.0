# RV Service Desk — PRD & Implementation Memory

## Original Problem Statement
Diagnostic behavior feels mechanical and template-driven. Five targeted fixes:
1. Agent repeatedly asks same diagnostic questions after technician answered
2. No diagnostic pivoting when key findings are discovered
3. Unverified facts (invented symptoms) in final reports
4. Over-polite/unnatural tone ("Thank you" after every reply)
5. Labor confirmation input bug (rejects "2.5", "2.5h")

## Architecture
- **Stack**: Next.js (App Router), TypeScript, Vitest, OpenAI API
- **Key flow**: `diagnostic` → `labor_confirmation` → `final_report`
- **Language policy**: `lang.ts` → `prompt-composer.ts` → `mode-validators.ts` → `route.ts`
- **Diagnostic state**: `diagnostic-registry.ts` (per-case in-memory)
- **Fact extraction**: `fact-pack.ts` (conversation scanning)

## What's Been Implemented

### Session 1 (Jan 2026) — Language Policy
- Declarative `LanguagePolicy` in `lang.ts`
- Output-layer enforcement for EN/RU/ES/AUTO modes

### Session 2 (Jan 2026) — Labor Confirmation + Copy UX
- `labor_confirmation` mode between diagnostic and final_report
- Labor sum validation in `labor-store.ts`
- Copy button visual feedback with auto-reset

### Session 3 (Jan 2026) — Diagnostic Behavior Fix (MVP)

#### A. Diagnostic Question Registry (`diagnostic-registry.ts`)
- Per-case in-memory tracking: `answeredKeys`, `unableToVerifyKeys`, `keyFindings`
- Detects "already checked/answered/told you" → marks topic as answered
- Detects "don't know/can't see/unable to verify" → closes topic permanently
- `buildRegistryContext()` injects closed topics into diagnostic prompt
- Multi-language support (EN, RU, ES patterns)

#### B. Diagnostic Pivot Rules
- `detectKeyFinding()` — 17 key finding patterns (missing blade, seized motor, cracked housing, zero current, etc.)
- `shouldPivot()` — when key finding detected, forces immediate transition to labor_confirmation
- Implemented in `route.ts` — if LLM doesn't self-transition, pivot forces it

#### C. Fact-Locked Final Report (`fact-pack.ts`)
- `buildFactPack()` — scans ONLY user messages for symptoms, observations, test results
- `buildFactLockConstraint()` — generates prohibition string injected into final report prompt
- Rules: "Do NOT add, infer, or assume any symptoms not listed", "not verified" for unconfirmed

#### D. Tone Adjustment
- `SYSTEM_PROMPT_BASE.txt`: "Do NOT say Thank you", "Prefer silence over politeness", "Never use filler phrases"
- `MODE_PROMPT_DIAGNOSTIC.txt`: Professional communication style, one-word acknowledgments only ("Noted.", "Understood.", "Copy.")
- Diagnostic Registry Rules and Pivot Rules embedded in diagnostic prompt

#### E. Labor Confirmation Input Parsing (Bug Fix)
- `parseLaborConfirmation()` now accepts: `2.5`, `2.5h`, `2.5 hours`, `2.5hr`, `2.5hrs`
- Regex updated: `h\b` as standalone unit match

#### Tests Added
- `tests/diagnostic-registry.test.ts` — 26 tests
- `tests/fact-pack.test.ts` — 10 tests
- `tests/tone-adjustment.test.ts` — 9 tests
- Updated `tests/labor-confirmation.test.ts` — +2 tests
- Total: 447 tests passing (53 new), 33 test files

## Ownership Model
| Concern | Owner |
|---------|-------|
| Content & format | Prompt files (`prompts/`) |
| Language rules | Config (`LanguagePolicy` in `lang.ts`) |
| Labor rules | Config (`labor-store.ts`) + validator |
| Diagnostic state | Registry (`diagnostic-registry.ts`) |
| Fact extraction | `fact-pack.ts` |
| Enforcement | Validator (`mode-validators.ts`) + output layer (`route.ts`) |

## Backlog
- P0: None (all acceptance criteria met)
- P1: Integration test with mocked OpenAI — full diagnostic → pivot → labor → report flow
- P1: Expand key finding patterns based on customer field testing
- P2: Persist diagnostic registry to DB for cross-session continuity
- P2: Confidence scoring for fact extraction (high/medium/low)
