# ADR: Branch-Aware Step Resolution (P1.5)

**Date:** 2026-01-XX  
**Status:** Historical / Superseded — implementation memo, NOT current architecture authority  
**Task:** P1.5 — Branch-Aware Step Resolution

---

> ## ⚠️ Status warning (truth-hierarchy cleanup)
>
> This document is preserved as a **historical implementation memo** describing
> early branch-aware step-resolution work. It is **not** the current
> architecture authority for diagnostic flow, branch authority, or
> registry/route ownership of branch state.
>
> Current authoritative doctrine:
>
> - Behavioral authority: `docs/CUSTOMER_BEHAVIOR_SPEC.md`
> - Product memory: `PROJECT_MEMORY.md`
> - Architecture invariants: `ARCHITECTURE_RULES.md` (see Rule A1, B1, B3, G1b)
> - Single-authority doctrine: **the Context Engine is the single runtime
>   authority for diagnostic flow, including branch selection, branch
>   switching, branch entry/exit, and step resolution.**
>
> Specifically, the following parts of this memo MUST NOT be read as
> current active architecture:
>
> - any implication that the **registry** owns branch authority,
>   branch entry/exit, or mutual-exclusivity decisions,
> - any implication that **`route.ts`** owns branch synchronization,
>   branch advancement, or "sync branch state to context engine",
> - any implication that calling helpers such as `processResponseForBranch`
>   from a route handler is the canonical architectural pattern.
>
> Per `ARCHITECTURE_RULES.md` Rule G1b, no helper module, registry call,
> or route handler may shadow, replicate, or override Context Engine
> decisions about step selection, branch switching, completion,
> isolation, terminal state, or readiness.
>
> The behavioral and architectural intent expressed by this memo (one
> active branch at a time, mutually exclusive branches, no parallel
> branches, semantic stability of step IDs) remains directionally valid,
> but the **ownership** described here is historical. Any future work in
> this area MUST be designed against current `ARCHITECTURE_RULES.md` and
> the customer behavior spec, not against the route/registry-centric
> model described below.
>
> Use this file as implementation history and as a record of the original
> P1.5 decision. Do not use it as a current authority on where branch
> logic lives.

---

## 1. Problem Statement

The diagnostic system treated steps as a **flat list**. The registry tracked:
- `completedStepIds`
- `unableStepIds`

But did **NOT** track:
- Branch selection
- Decision path
- Causal progression

This caused:
- Same step ID potentially reused for different logical checks
- Parallel branches executed simultaneously
- Repeated steps with different semantics

---

## 2. Root Cause

`getNextStep()` operated on:

```typescript
completedStepIds + unableStepIds
```

**WITHOUT branch constraints.**

The registry had no concept of:
- Active branch
- Decision tree
- Path locking

---

## 3. Solution

### 3.1 Type Extensions

**DiagnosticStep** now includes optional `branchId`:
```typescript
export type DiagnosticStep = {
  id: string;
  question: string;
  prerequisites: string[];
  matchPatterns: RegExp[];
  howToCheck?: string;
  branchId?: string;  // NEW: Which branch this step belongs to
};
```

**ProcedureBranch** defines conditional paths:
```typescript
export type ProcedureBranch = {
  id: string;
  displayName: string;
  triggerStepId: string;      // Step that can trigger entry
  triggerPattern: RegExp;      // Pattern that activates branch
  entryStepId: string;         // First step in this branch
  mutuallyExclusive: string[]; // Branches that cannot coexist
};
```

**DiagnosticEntry** now includes branch state:
```typescript
type DiagnosticEntry = {
  // ... existing fields ...
  activeBranchId: string | null;
  decisionPath: Array<{ stepId: string; branchId: string | null; reason: string; timestamp: string }>;
  lockedOutBranches: Set<string>;
};
```

### 3.2 Branch-Aware Step Resolution

New function `getNextStepBranchAware()`:
```typescript
export function getNextStepBranchAware(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
  activeBranchId: string | null,
  lockedOutBranches: Set<string>,
): DiagnosticStep | null
```

**Rules:**
1. If `activeBranchId` is set → ONLY steps in that branch are considered
2. If no active branch → only main-flow steps (`branchId === undefined`) are considered
3. Locked-out branches are excluded entirely
4. Prerequisites must still be met

### 3.3 Branch Trigger Detection

```typescript
export function detectBranchTrigger(
  procedure: DiagnosticProcedure,
  stepId: string,
  technicianResponse: string,
): ProcedureBranch | null
```

### 3.4 Mutual Exclusivity Enforcement

When a branch is entered, mutually exclusive branches are locked out:
```typescript
const lockedOut = getMutuallyExclusiveBranches(procedure, triggeredBranch.id);
for (const lockedBranchId of lockedOut) {
  entry.lockedOutBranches.add(lockedBranchId);
}
```

---

## 4. Water Heater Procedure with Branches

Added three branches to the water heater procedure:

### Branch: `no_ignition`
- **Trigger:** Step `wh_6` response matches `/(?:no|nothing|none|didn't).*(?:click|spark|glow|ignit)/i`
- **Entry:** Step `wh_6a`
- **Steps:** `wh_6a`, `wh_6b`, `wh_6c`
- **Mutual Exclusion:** `flame_failure`

### Branch: `flame_failure`
- **Trigger:** Step `wh_7` response matches `/(?:flame|fire).*(?:goes?\s*out|drops?|dies|fails?)/i`
- **Entry:** Step `wh_7a`
- **Steps:** `wh_7a`, `wh_7b`, `wh_7c`
- **Mutual Exclusion:** `no_ignition`

### Branch: `no_gas`
- **Trigger:** Step `wh_8` response matches `/(?:no|none|nothing).*(?:gas|flow|smell)/i`
- **Entry:** Step `wh_8a`
- **Steps:** `wh_8a`, `wh_8b`, `wh_8c`
- **Mutual Exclusion:** None

---

## 5. Expected Behavior

### Before (Flat System)
```
Step 6 → Step 7 (can repeat with different meanings)
         ↘ Step 8 (can run in parallel)
```

### After (Branch-Aware)
```
Step 6 → "no spark" → Branch: no_ignition
         │              ├─ wh_6a (12V at igniter?)
         │              ├─ wh_6b (electrode gap?)
         │              └─ wh_6c (ground?)
         │              → [flame_failure LOCKED OUT]
         │
         "clicking" → Step 7
                      │
                      "flame goes out" → Branch: flame_failure
                      │                   ├─ wh_7a (how long?)
                      │                   ├─ wh_7b (millivolt?)
                      │                   └─ wh_7c (positioning?)
                      │                   → [no_ignition LOCKED OUT]
                      │
                      "flame stays lit" → Step 9 (main flow continues)
```

---

## 6. Files Modified

| File | Change |
|------|--------|
| `src/lib/context-engine/types.ts` | Added `BranchDefinition`, `BranchState`, `BranchDecision` types |
| `src/lib/context-engine/context-engine.ts` | Initialize `branchState` in context |
| `src/lib/context-engine/index.ts` | Export new types |
| `src/lib/diagnostic-procedures.ts` | Added `ProcedureBranch` type, `branchId` to steps, `branches` to procedures, `getNextStepBranchAware()`, `detectBranchTrigger()`, `getMutuallyExclusiveBranches()` |
| `src/lib/diagnostic-registry.ts` | Added branch state to entries, `processResponseForBranch()`, `getBranchState()`, `setActiveBranch()`, `exitBranch()` |

---

## 7. Tests

**New test file:** `tests/branch-aware-resolution.test.ts` (18 tests)

Test coverage:
- `getNextStepBranchAware()` returns correct steps based on branch state
- `detectBranchTrigger()` identifies branch triggers
- Mutual exclusivity is enforced
- Registry branch state management
- Linear progression through branches
- Locked-out branch prevention

---

## 8. Backward Compatibility

- **`getNextStep()`** (legacy function) is preserved unchanged
- Procedures without `branches` array work as before
- Steps without `branchId` are considered main-flow steps
- Existing tests continue to pass (665 total)

---

## 9. Runtime Integration Fix (P1.5b)

**Issue Identified:**
The branch-aware infrastructure was built but NOT integrated into the runtime path (`route.ts`). Steps remained on the same ID (`wh_7`) while asking different semantic questions.

**Missing Integration Point:**
After step completion in `route.ts`, `processResponseForBranch()` was never called.

**Fix Applied (route.ts lines 345-405):**

```typescript
// After marking step complete:
registryMarkStepCompleted(ensuredCase.id, currentActiveStep);

// ── BRANCH TRIGGER CHECK (P1.5) ──────────────────────────────────
const branchResult = processResponseForBranch(ensuredCase.id, currentActiveStep, message);
if (branchResult.branchEntered) {
  console.log(`[Chat API v2] Branch entered: ${branchResult.branchEntered.id}`);
  // Sync branch state to context engine
  engineResult.context.branchState.activeBranchId = branchResult.branchEntered.id;
  // ... update decision path and locked branches
}

// Advance to next step (now branch-aware via getNextStepId)
const nextStep = getNextStepId(ensuredCase.id);
if (nextStep) {
  engineResult.context.activeStepId = nextStep;
} else {
  // Check if we need to exit branch
  const branchState = getBranchState(ensuredCase.id);
  if (branchState.activeBranchId) {
    exitBranch(ensuredCase.id, "Branch steps exhausted");
    // Try main flow again
    const mainFlowNext = getNextStepId(ensuredCase.id);
    if (mainFlowNext) {
      engineResult.context.activeStepId = mainFlowNext;
    }
  }
}
```

**Additional Fix (processResponseForBranch):**
Added check for locked-out branches before entering:
```typescript
if (entry.lockedOutBranches.has(triggeredBranch.id)) {
  console.log(`[DiagnosticRegistry] Branch ${triggeredBranch.id} is locked out, not entering`);
  return { branchEntered: null, lockedOut: [] };
}
```

---

## 10. Summary

Branch-aware step resolution ensures:
- ✅ Only ONE branch active at a time
- ✅ Branch selected based on technician answer
- ✅ Mutually exclusive branches locked out
- ✅ Same step ID = same semantic meaning
- ✅ Linear progression with clear branching
- ✅ Registry = passive storage (no inference)
- ✅ **Runtime integration complete** — branch triggers checked after step completion
- ✅ **Auto branch exit** — when branch steps exhausted, returns to main flow
- ✅ **Locked-out branch enforcement** — cannot enter locked branches

---

## 11. Remaining Work

1. Add branch definitions to furnace, roof AC, refrigerator procedures
2. Consider adding branch state to response metadata for UI display
