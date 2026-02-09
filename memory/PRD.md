# RV Service Desk — PRD & Implementation Memory

## Original Problem Statement
1. **Labor Time Consistency Bug**: When user asks to break down labor, the sum increases beyond the originally estimated total. Operation-level breakdown must sum exactly to the confirmed total.
2. **Missing Technician Confirmation Step**: Agent estimates time and proceeds directly to detailed report. Technician must be able to confirm/override total labor before breakdown.
3. **Copy Button UX Issue**: Copy button works but gives no visual feedback.

Previous session: Declarative language policy architecture fix (EN mode bilingual output bug).

## Architecture
- **Stack**: Next.js (App Router), TypeScript, Vitest, OpenAI API
- **Key flow**: `diagnostic` → `labor_confirmation` → `final_report`
- **Language policy**: `lang.ts` → `prompt-composer.ts` → `mode-validators.ts` → `route.ts`

## What's Been Implemented

### Session 1 (Jan 2026) — Language Policy
- Declarative `LanguagePolicy` in `lang.ts` (EN=no translation, RU/ES/AUTO=bilingual)
- Output-layer enforcement in `route.ts` strips translations for EN mode

### Session 2 (Jan 2026) — Labor Confirmation + Copy UX

#### A. Labor Confirmation Phase
- New `CaseMode: "labor_confirmation"` between diagnostic and final_report
- `prompts/modes/MODE_PROMPT_LABOR_CONFIRMATION.txt` — LLM generates labor estimate and asks for confirmation
- `src/lib/labor-store.ts`:
  - `setLaborEstimate()` / `confirmLabor()` / `getConfirmedHours()` — in-memory labor store
  - `extractLaborEstimate()` — parses LLM estimate response
  - `parseLaborConfirmation()` — parses technician confirmation/override (supports EN, RU, ES)
  - `validateLaborSum()` — validates breakdown sums to confirmed total
- `route.ts` flow: diagnostic → transition → labor_confirmation → technician confirms → final_report with labor budget constraint

#### B. Labor Sum Validation
- `validateLaborSum()` checks:
  - Stated total matches confirmed total
  - Sum of individual steps matches confirmed total
- Applied in route.ts after final report generation

#### C. Copy Button UX
- Per-message `copiedMessageId` state tracking in `chat-panel.tsx`
- Visual feedback: green border + checkmark + "Copied!" text
- Auto-reset after 1.5 seconds
- Independent from Report Copy button state

#### D. Tests Added
- `tests/labor-confirmation.test.ts` — 32 tests covering labor store, parsing, validation
- `tests/copy-button-ux.test.ts` — 9 tests covering copy feedback behavior
- Total: 394 tests passing (41 new)

## Ownership Model
| Concern | Owner |
|---------|-------|
| Content & format | Prompt files (`prompts/`) |
| Language rules | Config (`LanguagePolicy` in `lang.ts`) |
| Labor rules | Config (`labor-store.ts`) + validator |
| Enforcement | Validator (`mode-validators.ts`) + output layer (`route.ts`) |

## Backlog
- P0: None (all acceptance criteria met)
- P1: Add Prisma schema migration for `labor_confirmation` CaseMode + `confirmedLaborHours` field (currently in-memory only)
- P1: Integration test with mocked OpenAI to verify full labor confirmation flow end-to-end
- P2: Allow technician to re-confirm labor after report is generated (currently immutable)
- P2: Add labor estimation heuristics based on system type (water pump vs AC unit)
