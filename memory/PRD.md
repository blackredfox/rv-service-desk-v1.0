# RV Service Desk — PRD

## Project Overview
RV Service Desk is a professional RV diagnostic and service authorization engine for the US RV industry. It assists technicians through guided diagnostics, report generation, and authorization workflows.

## Architecture
- **Stack**: Next.js (TypeScript), Prisma, OpenAI API
- **Runtime**: Context Engine (single diagnostic-flow authority), Diagnostic Registry, Prompt Composer
- **Output Surfaces**: diagnostic, portal_cause, shop_final_report, authorization_ready, labor_confirmation

## What's Been Implemented (2026-01-28)

### PR: fix/customer-fidelity-report-readiness-and-subtype-gates

**Fixes applied (Case-54 acceptance):**

1. **Subtype gating (A)**: Added `subtypeGate` field to `DiagnosticStep`. When technician says "gas only" / "not combo" at wh_1, combo-only steps (wh_11) are excluded from future step serving. Detection works in EN/RU/ES.

2. **No false final-report invitation (B)**: Added anti-invitation directive to prompt context when isolation is NOT complete. LLM is explicitly prohibited from suggesting START FINAL REPORT during unresolved diagnostics.

3. **No unresolved repair-summary questionnaire (C)**: When diagnostics are in active procedure and isolation is not complete, START FINAL REPORT triggers a "diagnostics not ready" response instead of the repair-summary questionnaire. The questionnaire is preserved for non-procedure cases where technician provides partial summary data.

4. **Reduced status-screen over-scripting (D)**: Updated MODE_PROMPT_DIAGNOSTIC.txt so System/Classification/Mode/Status block is first-response-only. Subsequent responses use natural diagnostic dialogue. Removed trailing example that taught the LLM to repeat the block.

5. **Surface preservation (E)**: No changes to output surface resolution. portal_cause, shop_final_report, and authorization_ready remain distinct surfaces.

**Files changed:**
- `prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt`
- `src/app/api/chat/route.ts`
- `src/lib/context-engine/context-engine.ts`
- `src/lib/diagnostic-procedures.ts`
- `src/lib/diagnostic-registry.ts`
- `tests/chat-route-water-heater-dominance.test.ts`
- `tests/chat-transition-final-report.test.ts`
- `tests/case54-acceptance-regression.test.ts` (new)

**Test results:** 1252/1252 pass (72 test files), including 16 new regression tests.

## Backlog
- P0: None
- P1: Consider extending subtypeGate to other procedures (e.g. AC heat-pump-only steps)
- P2: Add more language variants for subtype detection patterns
