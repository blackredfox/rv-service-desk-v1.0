# ADR-002: Safe Decomposition of app/api/chat/route.ts

**Date:** 2026-03-16  
**Status:** Implemented  
**Context:** Route file complexity and maintainability

## Decision

Decompose `app/api/chat/route.ts` into smaller, single-purpose modules without changing runtime behavior or introducing new diagnostic authority.

## Context

The `route.ts` file had grown to ~1,767 lines, mixing:
- HTTP boundary handling
- SSE streaming protocol
- OpenAI client transport
- Attachment validation
- Labor override logic
- Output policy enforcement
- Final report generation
- Logging utilities

This made the file difficult to:
- Review and audit for correctness
- Test individual components
- Maintain without regression risk

## Extraction Boundaries

### New Modules Created

| Module | Responsibility | Lines |
|--------|---------------|-------|
| `lib/chat/sse.ts` | SSE protocol encoding | ~50 |
| `lib/chat/openai-client.ts` | OpenAI streaming transport | ~200 |
| `lib/chat/attachment-validator.ts` | Image attachment validation | ~80 |
| `lib/chat/labor-override.ts` | Labor hours parsing and detection | ~130 |
| `lib/chat/output-policy.ts` | Language policy enforcement, fallbacks | ~150 |
| `lib/chat/final-report-service.ts` | Report generation helpers | ~100 |
| `lib/chat/logging.ts` | Structured logging | ~20 |
| `lib/chat/index.ts` | Module exports | ~60 |

### What route.ts Still Owns

- HTTP request/response boundary
- Request orchestration and flow
- Top-level error handling
- Calling extracted services
- Mode transition orchestration

### What Extracted Modules Do NOT Own

- Hidden diagnostic flow control
- Mode inference by semantic meaning
- Alternate next-step selection
- Fallback diagnostic state machine behavior
- Any diagnostic authority (remains in Context Engine)

## Architectural Non-Negotiables Preserved

1. **Explicit-only mode transitions** — No change
2. **Single diagnostic authority** — Context Engine remains sole authority
3. **No dual state machines** — Extracted modules are pure utilities
4. **Translation enforcement** — Output-layer policy enforcement preserved

## Test Coverage

- All existing tests pass (588/605, same 17 pre-existing failures)
- New test file: `tests/chat-module-extraction.test.ts` (29 tests)
- Tests cover:
  - SSE encoding
  - OpenAI message building
  - Attachment validation
  - Labor override detection
  - Output policy enforcement
  - Final report fallback generation
  - Diagnostic mode guard

## Consequences

### Positive
- `route.ts` reduced from ~1,767 to ~800 lines
- Each module has single responsibility
- Easier to test individual components
- Clearer import boundaries

### Negative
- More files to navigate
- Slightly more indirection

### Neutral
- Runtime behavior unchanged
- No performance impact (same code, different files)

## Files Changed

### Modified
- `src/app/api/chat/route.ts` — Refactored to use extracted modules

### Created
- `src/lib/chat/sse.ts`
- `src/lib/chat/openai-client.ts`
- `src/lib/chat/attachment-validator.ts`
- `src/lib/chat/labor-override.ts`
- `src/lib/chat/output-policy.ts`
- `src/lib/chat/final-report-service.ts`
- `src/lib/chat/logging.ts`
- `src/lib/chat/index.ts`
- `tests/chat-module-extraction.test.ts`
- `docs/ADR-002-ROUTE-DECOMPOSITION.md` (this file)
- `docs/BASELINE_BEHAVIOR_2026-03-16.md` (Task 01 baseline)
