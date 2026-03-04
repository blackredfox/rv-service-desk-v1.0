# PRD — Investigate First-Token Latency in /api/chat Streaming

## Original Problem Statement
Investigate ~20s first-token silence in `/api/chat` despite streaming, and add timing visibility to distinguish OpenAI pre-token latency vs server-side buffering.

## Scope Applied
- Updated only `src/app/api/chat/route.ts`
- No UI/API contract changes
- Kept existing SSE event schema unchanged

## What Was Implemented
1. **Precise latency instrumentation**
   - Added `openAiFirstTokenMs` directly inside OpenAI streaming reader (`callOpenAI`) when first delta token arrives.
   - Existing timing logs retained/used:
     - `loadHistoryMs`
     - `composePromptMs`
     - `validateMs`
     - `totalMs`
   - Added `sse_first_token` log to confirm first token dispatch timing to client side from server.

2. **Streaming-path confirmation (no buffering before token emit)**
   - `callOpenAI(..., onToken)` still uses `stream:true` and forwards upstream deltas immediately.
   - `emitToken(...)` sends SSE `type:"token"` as soon as tokens arrive.
   - No API shape changes.

3. **Validator/repair observability**
   - Added explicit flow logs:
     - `validation_post_stream` (proves validation runs after stream collection path)
     - `validation_failed`
     - `retry_triggered`
     - `safe_fallback_used`
   - Logged across primary path, labor override path, and transition final-report path.

## Acceptance Mapping
- First-token latency now explicitly visible via:
  - `openAiFirstTokenMs` (upstream first delta arrival)
  - `sse_first_token.firstSseTokenMs` (first token emitted to client)
- Validator behavior is observable and clearly post-stream via `validation_post_stream`.
- Retry/repair/fallback events are explicitly logged.

## Verification
- Passed regression tests:
  - `yarn test tests/chat-route.test.ts tests/chat-transition-final-report.test.ts`

## Next Actions
1. Run on real workload and compare `openAiFirstTokenMs` vs `firstSseTokenMs` to isolate upstream vs server delay.
2. Track p50/p95 of these metrics in log aggregation to validate <3s first-token goal where feasible.
3. If upstream dominates latency, evaluate model/region/request-size effects without changing API contract.
