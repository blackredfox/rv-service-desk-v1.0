# ADR-002: Safe Decomposition of `src/app/api/chat/route.ts`

**Date:** 2026-03-18  
**Status:** Revised / Active  
**Owners:** RV Service Desk Architecture  
**Decision Type:** Architecture / Maintainability / Flow-Authority Preservation

---

## Context

`src/app/api/chat/route.ts` remains a high-risk concentration point in the system.

Even after prior helper extraction work, the route still carries a large amount of orchestration and policy-adjacent logic, including:
- request normalization and language tracking,
- case initialization and message persistence,
- Context Engine orchestration,
- prompt composition,
- OpenAI request execution,
- validation / retry / fallback orchestration,
- labor override handling,
- response streaming lifecycle,
- post-response side effects.

This means the route is not yet a thin boundary-only controller.

At the same time, decomposition is dangerous if done incorrectly:
- moving logic out of `route.ts` can improve readability,
- but can also create **hidden diagnostic authority** in helper modules,
- which is worse than a large file.

The architecture must preserve a single flow authority:
> **Context Engine remains the only authority for diagnostic flow decisions.**

This ADR updates the prior route decomposition record so it matches current reality and the current project plan.

---

## Problem Statement

The system has two simultaneous risks:

### Risk A — Oversized orchestration boundary
If too much logic remains inside `route.ts`, the file becomes:
- hard to audit,
- hard to refactor safely,
- hard to test in isolation,
- easy to break during maintenance.

### Risk B — Hidden distributed authority
If decomposition is done carelessly, flow logic becomes scattered across:
- `route.ts`,
- helper modules,
- prompt composition,
- fallback utilities,
- report helpers.

That creates:
- dual or fragmented state machines,
- semantic mode inference outside contracts,
- invisible branching logic,
- architecture drift.

For this product, **Risk B is worse than Risk A**.

Therefore:
- decomposition is required,
- but it must be **boundary-first** and **authority-preserving**.

---

## Decision

We will decompose `src/app/api/chat/route.ts` into smaller modules **only** under the following rule set:

### Core Rule
`route.ts` must become a **thin orchestration boundary**.

### Core Authority Rule
All diagnostic flow authority remains in the Context Engine.

### Extraction Rule
Only pure utilities, boundary adapters, and orchestration-support services may be extracted.

### Prohibition Rule
No extracted module may become a hidden second diagnostic brain.

---

## Architectural Intent

Target architecture:

- `src/app/api/chat/route.ts`
  - HTTP boundary
  - SSE lifecycle boundary
  - top-level orchestration
  - top-level error handling
  - explicit mode orchestration
  - calls into Context Engine and extracted services

- `src/lib/chat/*`
  - transport helpers
  - request preparation helpers
  - logging
  - language/output policy helpers
  - final report formatting / report-flow utilities
  - execution wrappers
  - validation services
  - persistence-side-effect helpers

- `src/lib/context-engine/*`
  - all diagnostic flow decisions
  - next-step selection
  - completion tracking
  - branch switching
  - clarification return behavior
  - terminal-state determination
  - future signal-aware branch semantics

---

## Non-Negotiables

### 1. Single Flow Authority
The Context Engine is the only authority for:
- next-step selection,
- branch switching,
- completion inference,
- clarification return behavior,
- terminal-state logic,
- report-ready detection logic at the diagnostic-flow layer.

### 2. Explicit-Only Mode Transitions
Mode transitions remain explicit-only.
No helper module may infer mode transitions from meaning.

### 3. No Hidden Diagnostic State Machine
No extracted module may implement:
- alternate next-step selection,
- semantic fallback branching,
- hidden completion logic,
- hidden diagnostic recovery state machine.

### 4. Prompts Are Not Flow Authority
Prompts may shape wording and delivery,
but they must not become the hidden source of:
- branch logic,
- transition logic,
- completion logic,
- report-readiness logic.

### 5. Runtime Behavior Must Not Drift Accidentally
Refactor for structure is allowed.
Behavior change is not allowed unless explicitly covered by:
- a separate contract change,
- benchmark coverage,
- dedicated task.

---

## What `route.ts` Must Own

After safe decomposition, `route.ts` should own only:

- request/response boundary,
- request parsing entrypoint,
- auth/session entrypoint,
- SSE stream creation and lifecycle,
- top-level orchestration,
- top-level try/catch and abort handling,
- calls to pure services / execution services,
- explicit mode command handling at boundary level,
- final emission of case/language/mode/done/error events.

`route.ts` may coordinate.
It must not become the hidden place where business truth lives.

---

## What May Be Extracted

The following are valid extraction targets because they are boundary/policy/support concerns:

- SSE encoding / protocol helpers
- OpenAI transport wrappers
- attachment validation
- request normalization helpers
- language/output policy helpers
- final-report formatting helpers
- labor override parsing / report-flow utilities
- logging / telemetry
- validation services
- persistence-side-effect services
- prompt context builders
- top-level application orchestration services

These extracted modules must remain auditable and bounded.

---

## What Must NOT Be Extracted Into Helpers

The following are explicitly forbidden outside Context Engine:

- next-step selection
- hidden branch choice
- semantic mode inference
- fallback diagnostic state machine logic
- hidden completion inference
- alternate terminal-state logic
- “smart” repair recommendation logic
- report-readiness determination that contradicts product contracts
- any flow control that can diverge from Context Engine authority

If a module contains diagnostic authority, it belongs in Context Engine, not in chat helpers.

---

## Current Reality Check (2026-03-18)

The earlier version of this ADR described route decomposition as fully implemented.

That is no longer an accurate architecture statement.

Current route reality still includes substantial orchestration and behavior-adjacent logic in `route.ts`, including:
- case management,
- Context Engine invocation,
- directive assembly,
- prompt construction,
- labor override path branching,
- validation/retry/fallback orchestration,
- assistant persistence and side effects.

Therefore:

> prior helper extraction is acknowledged, but the target state is **not yet complete**.

This ADR supersedes any interpretation that route decomposition is “done”.

---

## Safe Decomposition Strategy

### Phase 0 — Verify Actual Repo State
Before further decomposition, verify:
- actual current size/shape of `route.ts`,
- actual existing `src/lib/chat/*` modules,
- current active branch / commit reality,
- whether current documents match actual code.

This prevents refactoring against stale docs.

### Phase 1 — Preserve Contracts First
Do not mix route decomposition with:
- benchmark redesign,
- signal-layer introduction,
- major flow-rule changes.

Contracts first, decomposition second.

### Phase 2 — Boundary-First Decomposition
Decompose by responsibility, not by arbitrary helpers.

Recommended order:

#### Step 2.1 — Request Preparation
Extract:
- body parsing,
- attachment validation,
- language detection/resolution,
- case ensuring,
- history loading.

#### Step 2.2 — Diagnostic Orchestration Bundle
Extract orchestration support for:
- registry initialization,
- Context Engine call,
- directive assembly,
- procedure context assembly.

Important:
this service may orchestrate Context Engine usage,
but must not replace Context Engine authority.

#### Step 2.3 — Final Report / Labor Flow
Extract:
- labor override path,
- final report retry logic,
- labor sum validation helpers,
- final report fallback support.

#### Step 2.4 — Validation / Retry Pipeline
Extract:
- output validation,
- language consistency validation,
- retry decisioning,
- fallback decisioning.

Important:
policy enforcement may be extracted;
diagnostic authority may not.

#### Step 2.5 — Persistence / Side Effects
Extract:
- assistant message append,
- agent action recording,
- context cleanup side effects,
- route-adjacent persistence glue.

---

## Preferred Decomposition Shape

Recommended bounded modules include:

- `chat-request-preparer`
- `chat-mode-resolver`
- `diagnostic-flow-service`
- `prompt-context-builder`
- `openai-execution-service`
- `response-validation-service`
- `final-report-flow-service`
- `chat-persistence-service`
- optional top-level `runChatTurn(...)` orchestration entrypoint

This is preferred over vague “helpers1 / helpers2 / utils” decomposition.

---

## Testing Requirements

Safe decomposition is incomplete unless it is protected by structure-preserving tests.

Required test categories:

### 1. Route Wiring Tests
Prove:
- stream lifecycle remains valid,
- `done`/`error`/`mode`/`language` emissions remain correct,
- no duplicated close/return behavior is introduced.

### 2. No-Hidden-Authority Tests
Prove:
- extracted modules do not select steps,
- extracted modules do not infer mode by meaning,
- flow authority remains in Context Engine.

### 3. Extracted Module Unit Tests
Cover:
- request preparation,
- mode resolution,
- report helpers,
- validation services,
- persistence helpers,
- execution helpers.

### 4. Integration Tests
Prove:
- behavior remains unchanged after extraction,
- known benchmark cases do not regress.

### 5. Strictness / Authority Tests
Prove:
- no dual state machine appears,
- no shadow branching logic appears outside Context Engine.

---

## Consequences

### Positive
- route becomes auditable,
- maintenance risk drops,
- responsibilities become clearer,
- testability improves,
- future Context Engine work becomes easier to isolate.

### Negative
- more files to navigate,
- orchestration paths become more indirect,
- bad decomposition could hide architecture drift if not tested strictly.

### Critical Warning
A “cleaner-looking” route is **not** a success if authority becomes fragmented.

For this system:
> a larger file is preferable to a deceptively clean architecture with hidden distributed flow logic.

---

## Rejected Alternatives

### Alternative A — Leave route.ts as-is
Rejected because maintainability and auditability remain poor.

### Alternative B — Extract everything aggressively
Rejected because it would spread logic across helpers and increase hidden-authority risk.

### Alternative C — Let prompts absorb more logic
Rejected because prompt-level control is not trustworthy enough to serve as architecture authority.

---

## Decision Outcome

This ADR remains active until all of the following are true:

- `route.ts` is boundary-only in practice,
- extracted modules are bounded and authority-safe,
- no hidden flow logic exists outside Context Engine,
- structure-preserving tests exist,
- benchmark and integration checks confirm no regression.

Until then, route decomposition is considered:
> **partially implemented, not complete**.

---

## Related Documents

- `docs/CUSTOMER_BEHAVIOR_SPEC.md` (canonical behavioral mirror)
- `PROJECT_MEMORY.md`
- `ROADMAP.md`
- `README.md`
- `ARCHITECTURE_RULES.md`
- `RV_SWE_BENCHMARK_v1.md`
- `route.ts-decomposition-plan.md`
- current working plan / baseline verification notes

---

End of file.