# ADR: Context Engine (Conversation Manager) for RV Service Desk

**Status:** Accepted → **Finalized (Strict Mode)**  
**Date:** 2026-02-12 (updated 2026-02-23)  
**Author:** Neo (Emergent AI Agent)

## Context

The RV Service Desk agent previously had a dual-authority architecture:
- **Legacy diagnostic-registry**: Step tracking, topic detection, pivot logic
- **Context Engine**: Intent routing, replan, clarification, loop guard

This created risk of:
- Conflicting flow decisions
- Hard-to-debug state inconsistencies
- Regression when either system was modified

**Decision:** Make Context Engine the **single flow authority**. Legacy registry becomes a **data provider only**.

## Final Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CHAT ROUTE (route.ts)                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 CONTEXT ENGINE (FLOW AUTHORITY)              │   │
│  │  - Intent detection (LOCATE/EXPLAIN/HOWTO/NEW_EVIDENCE)      │   │
│  │  - Submode management (main/locate/explain/howto/replan)     │   │
│  │  - Topic stack (push/pop clarification subtopics)            │   │
│  │  - Replan triggers (new evidence after isolation)            │   │
│  │  - Loop guard (anti-fallback, anti-repeat)                   │   │
│  │  - Labor mode (non-blocking draft)                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │           DIAGNOSTIC REGISTRY (DATA PROVIDER ONLY)           │   │
│  │  - Procedure catalog (step definitions, questions)           │   │
│  │  - Step metadata (match patterns, how-to-check text)         │   │
│  │  - System detection (water_pump, roof_ac, etc.)              │   │
│  │  - buildRegistryContext() → step text for LLM prompt         │   │
│  │                                                               │   │
│  │  ⛔ NOT USED FOR:                                             │   │
│  │  - Flow decisions                                             │   │
│  │  - Pivot logic                                                │   │
│  │  - Step selection                                             │   │
│  │  - State machine transitions                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                        LLM (OpenAI)                          │   │
│  │  - Receives: system prompt + context engine directives       │   │
│  │  - Receives: step metadata from registry (data only)         │   │
│  │  - Generates: technician-facing response                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## State Machine Levels (Context Engine)

```
┌─────────────────────────────────────────────────────────────────┐
│                        MODE LAYER                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  diagnostic  │─▶│ authorization│─▶│    final_report      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SUBMODE LAYER (diagnostic only)             │   │
│  │  ┌──────┐  ┌────────┐  ┌────────┐  ┌────────────────┐   │   │
│  │  │ main │◀▶│ locate │◀▶│explain │◀▶│ howto/replan   │   │   │
│  │  └──────┘  └────────┘  └────────┘  └────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## What Remains of Legacy Registry

| Function | Status | Purpose |
|----------|--------|---------|
| `initializeCase()` | DATA PROVIDER | Detects system, loads procedure catalog |
| `buildRegistryContext()` | DATA PROVIDER | Provides step text/questions for LLM |
| `detectSystem()` | DATA PROVIDER | Maps initial message to procedure |
| `getProcedure()` | DATA PROVIDER | Returns step definitions |
| `processUserMessage()` | DEPRECATED | Legacy flow logic - NOT called |
| `shouldPivot()` | DEPRECATED | Legacy pivot logic - NOT called |

## Strict Mode

```typescript
// In route.ts
const STRICT_CONTEXT_ENGINE = true;
```

When enabled (default):
- All flow decisions come from Context Engine
- Registry is used ONLY as data provider
- Invalid Context Engine results trigger safe fallback (not legacy path)
- Logs clearly indicate Context Engine authority

## Known Limitations

1. **In-Memory Context Store**: Context is stored in module-level Map. For serverless environments with function cold starts, context may be lost between invocations.
   - **Planned fix**: Persist context to database (Prisma) or Redis
   - **Workaround**: Context is reconstructed from conversation history on each request

2. **Procedure Sync**: Pre-completed steps from `initializeCase()` must be synced to Context Engine manually.
   - Current implementation: Route calls `markContextStepCompleted()` for each

## Testing Strategy

Tests are organized to prevent regression:

1. **Unit Tests** (`tests/context-engine.test.ts`): 26 tests for engine internals
2. **Integration Tests** (`tests/context-engine-integration.test.ts`): 9 tests for route wiring
3. **Strictness Tests** (`tests/route-strictness.test.ts`): 12 tests ensuring:
   - Context Engine is always used
   - Legacy flow is not called
   - No dual-authority paths
   - Replan handled by engine only
   - Clarification handled by engine only

## Acceptance Criteria (Verified)

1. ✅ No "coin-operated" gating - diagnostics continue without labor blocking
2. ✅ Clarification support - brief answer + return to active step
3. ✅ Replan works - new evidence causes rollback and branch switch
4. ✅ No loops - never "provide more info" twice, never ask completed steps
5. ✅ Warranty-safe constraints preserved
6. ✅ **Single flow authority** - Context Engine governs all diagnostic decisions

## Consequences

**Positive:**
- Single source of truth for flow decisions
- Easier to reason about and debug
- Tests prevent accidental regression
- Clear separation: flow authority vs data provider

**Negative:**
- In-memory context requires careful handling in serverless
- Legacy registry code still exists (could be confusing)

**Neutral:**
- Performance unchanged (same number of function calls)
- API contract unchanged (external behavior identical)
