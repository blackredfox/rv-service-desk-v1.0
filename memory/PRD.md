# PRD — Language Stability Fix + First-Token Latency Investigation (Follow-up)

## Original User Report
1) Language switched incorrectly in the same Spanish diagnostic thread (`"Sí"` caused ES → EN).
2) First-token latency still ~20s; continue investigation with actionable logs.

## Scope Applied
- Updated only:
  - `src/app/api/chat/route.ts`
  - `src/lib/lang.ts`
  - `tests/chat-route.test.ts`
  - `tests/lang-spanish-detection.test.ts`
- No SSE event schema changes.
- No UI contract changes.

## What Was Implemented

### A) Language detection stability fix (Spanish thread)
- In `route.ts`, dialogue language switching for existing cases is now **guarded**:
  - Keeps previous case language on short acknowledgements (`Sí`, `ok`, `yes`, etc.)
  - Auto-switches only on strong detection confidence (>= 0.85) and non-ack turns
  - Explicit forced language commands still override immediately
- In `lang.ts`, expanded explicit English switch detection to include Spanish phrasing:
  - `en inglés` now maps to forced `EN`

### B) Latency investigation resumed with deeper timing
- Added `openAiStartMs` to each OpenAI call log (offset from request start), in addition to:
  - `openAiFirstTokenMs`
  - `openAiMs`
- Existing key timing/flow logs preserved and now form full chain:
  - `loadHistoryMs`
  - `composePromptMs`
  - `openAiStartMs`
  - `openAiFirstTokenMs`
  - `validateMs`
  - `totalMs`
  - `sse_first_token`
- Repair path observability retained:
  - `validation_failed`
  - `retry_triggered`
  - `safe_fallback_used`

## Why this helps
- Language bug: prevents accidental ES→EN drift on short user confirmations in active Spanish sessions.
- Latency: logs now clearly separate:
  - pre-OpenAI delay (`openAiStartMs`)
  - upstream first-token delay (`openAiFirstTokenMs`)
  - server-to-client first token emission (`sse_first_token`)
  This pinpoints whether 20s silence is upstream model latency or internal buffering/prework.

## Validation
- Passed:
  - `yarn test tests/lang-spanish-detection.test.ts tests/chat-route.test.ts tests/chat-transition-final-report.test.ts`

## Prioritized Backlog
### P0
- Collect 5–10 real request log samples and compare `openAiStartMs` vs `openAiFirstTokenMs`.

### P1
- Add percentile summary logging (p50/p95) for first-token latency.

### P2
- Add similar acknowledgement-lock behavior for RU/EN if needed.

## Next Tasks
1. Run one real request and capture timing lines for diagnosis.
2. If `openAiFirstTokenMs` dominates, optimize model/Prompt size path; if `openAiStartMs` dominates, optimize pre-call stages.
3. Keep streaming/validation contract unchanged while tuning latency.
