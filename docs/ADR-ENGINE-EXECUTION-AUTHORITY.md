# ENGINE EXECUTION AUTHORITY FIX

**Date:** 2026-01-XX  
**Task:** P1 — Engine Execution Authority  
**Status:** COMPLETE

---

## 1. Root Cause Confirmed

### The Gap
The Context Engine was correctly computing `activeStepId`, but the runtime used it only as **advisory prompt context** — the LLM could ignore, paraphrase incorrectly, or substitute a different step.

### Evidence
1. **Context Engine computes state** (route.ts:257-303) ✓
2. **Active step is passed as prompt text** (route.ts:318-321) — advisory only
3. **LLM generates freely** (route.ts:630-641) — no enforcement
4. **No validation** that output matches `activeStepId` (mode-validators.ts:196-240)
5. **Loop recovery detected but not applied** (loop-guard.ts:45-109)

---

## 2. Architectural Fix Applied

### A. Step Compliance Validation (mode-validators.ts)
- `validateStepCompliance()` — Validates LLM response matches the engine-selected step
- `isStepAnswered()` — Contextual completion detection (accepts short answers like "yes", "12V", "да")

### B. Loop Recovery Enforcement (route.ts:307-345)
- `checkLoopViolation()` is now called **before** generating output
- `suggestLoopRecovery()` returns actionable recovery
- Recovery is **applied**: steps are force-completed and engine advances to next step

### C. Contextual Step Completion (route.ts:347-365)
- Technician responses are checked against `isStepAnswered()`
- Steps are marked complete even with short answers ("yes", "12V")
- This prevents the "I already told you" loop

### D. Authoritative Fallback (output-policy.ts)
- `buildAuthoritativeStepFallback()` — When LLM fails, returns exact step question
- Includes procedure name, progress, and step ID

### E. Registry Extensions (diagnostic-registry.ts)
- `getActiveStepQuestion()` — Get exact question text
- `getActiveStepMetadata()` — Get full step metadata for authoritative rendering
- `forceStepComplete()` — Loop recovery mechanism
- `isProcedureFullyComplete()` — Check if all steps done

---

## 3. New Code Flow

```
BEFORE:
  Engine → computes activeStepId
  Prompt → "Ask EXACTLY: ..." (advisory)
  LLM → generates freely (may ignore)
  Validator → checks format only
  
AFTER:
  Engine → computes activeStepId (AUTHORITATIVE)
  Loop Guard → checks for violation, applies recovery
  Contextual → checks if technician already answered
  Prompt → "Ask EXACTLY: ..." (advisory)
  LLM → generates response
  Validator → checks format + STEP COMPLIANCE
  Fallback → if invalid, render exact step authoritatively
```

---

## 4. Files Modified

| File | Changes |
|------|---------|
| `src/app/api/chat/route.ts` | Loop recovery enforcement, contextual completion, step compliance validation |
| `src/lib/mode-validators.ts` | Added `validateStepCompliance()`, `isStepAnswered()` |
| `src/lib/diagnostic-registry.ts` | Added `getActiveStepQuestion()`, `getActiveStepMetadata()`, `forceStepComplete()`, `isProcedureFullyComplete()` |
| `src/lib/chat/output-policy.ts` | Added `buildAuthoritativeStepFallback()` |
| `src/lib/chat/index.ts` | Export `buildAuthoritativeStepFallback` |

---

## 5. Files NOT Modified (Preserved)

- `src/lib/context-engine/context-engine.ts` — No changes
- `src/lib/context-engine/loop-guard.ts` — No changes (recovery already implemented)
- `src/lib/diagnostic-procedures.ts` — No changes

---

## 6. Test Updates

| File | Changes |
|------|---------|
| `tests/chat-transition-final-report.test.ts` | Added mock for `checkLoopViolation`, `suggestLoopRecovery` |
| `tests/chat-labor-override-drift-guard.test.ts` | Added mock for `checkLoopViolation`, `suggestLoopRecovery` |
| `tests/chat-final-report-override-intent-false-positive.test.ts` | Added mock for `checkLoopViolation`, `suggestLoopRecovery` |
| `tests/step-compliance.test.ts` | **NEW** — Tests for step compliance validation and contextual completion |

---

## 7. Orphaned File Audit

**No orphaned duplicate files found.**

All step selection logic flows through:
- `diagnostic-procedures.ts::getNextStep()` — Core step selection algorithm
- `diagnostic-registry.ts::getNextStepId()` — Registry wrapper

---

## 8. Test Results

```
Test Files: 45 passed (excluding pre-existing Prisma issues)
Tests: 633 passed

New tests:
- step-compliance.test.ts: 14 tests passed
```

---

## 9. Behavior Changes

| Scenario | Before | After |
|----------|--------|-------|
| LLM ignores active step | Allowed (advisory only) | Blocked by validation, fallback used |
| Technician says "yes" | May not match regex | Accepted by contextual completion |
| Loop detected | Directive added to prompt | Recovery applied, step force-completed |
| LLM references wrong step | Undetected | Flagged in validation |
| All retries fail | Generic fallback | Authoritative step fallback with exact question |

---

## 10. What This Does NOT Change

- **No redesign of the engine** — Engine logic preserved
- **No broad refactors** — Only targeted additions
- **No procedure rewrites** — Framework ready but not applied yet
- **Procedures still drive step selection** — Engine authority enhanced, not replaced
