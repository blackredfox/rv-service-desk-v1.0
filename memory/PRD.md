# NEO TASK — Safe `route.ts` Decomposition (Boundary-First, No Hidden Authority)

## Original Problem Statement
Safe maintainability refactor of `src/app/api/chat/route.ts` so it becomes a thinner orchestration boundary without introducing hidden diagnostic authority outside Context Engine. Preserve runtime behavior, do not mix in diagnostic logic fixes, and add direct tests for route wiring, no hidden authority, extracted modules, and strictness.

## Architecture Decisions
- Kept Context Engine as the sole diagnostic flow authority; route still invokes `processContextMessage(...)` directly.
- Extracted bounded chat services only for request preparation, explicit mode resolution, prompt assembly, OpenAI execution, response validation, final-report transport setup, and persistence side effects.
- Left diagnostic step/branch/terminal orchestration inside `route.ts` rather than moving it into helpers, to avoid creating a second controller.
- Preserved explicit-only mode transitions and existing validation / fallback behavior.

## What's Implemented
- Reduced `src/app/api/chat/route.ts` from 1128 lines pre-refactor to 661 lines while keeping HTTP/SSE orchestration at the boundary.
- Added bounded modules:
  - `src/lib/chat/chat-request-preparer.ts`
  - `src/lib/chat/chat-mode-resolver.ts`
  - `src/lib/chat/prompt-context-builder.ts`
  - `src/lib/chat/response-validation-service.ts`
  - `src/lib/chat/final-report-flow-service.ts`
  - `src/lib/chat/openai-execution-service.ts`
  - `src/lib/chat/chat-persistence-service.ts`
- Added/updated direct tests for extracted modules, no-hidden-authority guardrails, execution services, and route wiring.
- Verified focused suite passes:
  - `tests/chat-route-decomposition-services.test.ts`
  - `tests/chat-openai-execution-service.test.ts`
  - `tests/chat-no-hidden-authority.test.ts`
  - `tests/chat-route-wiring.test.ts`
  - `tests/chat-module-extraction.test.ts`
  - `tests/route-strictness.test.ts`
  - `tests/chat-route.test.ts`

## Prioritized Backlog
### P0
- Separate targeted fix for the known water-heater / “no 12V” branch-handling defect inside Context Engine behavior.
- Reduce remaining route-owned diagnostic glue only if it can be moved without fragmenting authority.

### P1
- Consolidate existing route comments and historical patch notes into architecture-safe inline docs or ADR references.
- Add broader integration safety coverage around labor override and diagnostic validation paths.

### P2
- Improve logging consistency for extracted persistence-side-effect helpers.
- Tighten prompt/validator fixtures used in service-level tests.

## Next Tasks
- If requested, do a separate Context Engine task focused only on the active signal/branch defect.
- If requested, continue shrinking `route.ts` only around non-authoritative transport/persistence concerns.
