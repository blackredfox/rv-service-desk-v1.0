# PRD — NEO TASK: Reduce Chat Latency with True OpenAI Streaming

## Original Problem Statement
Implement true OpenAI streaming in `src/app/api/chat/route.ts` to reduce perceived latency, while preserving existing behavior (modes, validators, labor override flow, translation policy), and add timing logs for observability.

## Architecture Decisions
- Kept implementation scoped to server route logic and existing chat route tests.
- Replaced buffered OpenAI completion handling with real fetch streaming parser for Chat Completions SSE.
- Preserved existing SSE contract to frontend (`type: token`, `mode`, `language`, `validation`, `done`, etc.).
- Maintained single-retry validation policy to bound latency.

## What Has Been Implemented
- Added true streaming OpenAI reader in `route.ts`:
  - uses `response.body.getReader()`
  - parses `data: ...` SSE lines
  - emits tokens to client immediately as they arrive
  - still accumulates full text for post-stream validation
  - supports non-stream fallback for mocked unit tests when `response.body` is absent
- Validation/retry flow updated to stream-first pattern:
  - stream first attempt immediately
  - validate after stream end
  - on invalid output: emit `[System] Repairing output...`, run one retry, stream retry
  - if still invalid: stream fallback and continue existing event behavior
- Applied streaming path consistently across:
  - main diagnostic/authorization/final report generation
  - labor override generation
  - auto-transition final report generation
- Added structured timing logs (no PII):
  - `loadHistoryMs`
  - `composePromptMs`
  - `openAiMs` (per call path)
  - `validateMs`
  - `totalMs`

## Prioritized Backlog
### P0
- Add optional metrics export/aggregation around p50/p95 first-token latency in production logs.

### P1
- Add dedicated unit tests for stream parser edge cases (multi-line chunk boundaries, partial trailing lines).

### P2
- Consider guard for suppressing known transition marker text from first-pass stream if needed for UX polish.

## Next Tasks
1. Validate first-token latency on real environment traffic (target <1–2s typical).
2. Review timing logs for slow paths and identify dominant bottleneck stage.
3. If needed, add parser edge-case fixtures in a separate test-focused PR.

## Incremental Bug Fix — chat-panel parsing recovery
- Fixed a structural TS syntax issue in `src/components/chat-panel.tsx` inside `send()`.
- Added the missing closing brace for `if (currentAttachments.length > 0)` before the API call.
- Scope intentionally limited to syntax restoration only; no behavior/refactor changes.

