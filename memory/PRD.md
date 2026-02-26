# RV Service Desk — PRD

## Original Problem Statement
Build and iteratively upgrade the "RV Service Desk" chat agent into a senior RV technician persona with disciplined behavior, server-authoritative orchestration, and resilient LLM integration. Defined across task briefs v3 (persona/prompts), v4 (orchestration/flow), and v5 (resilience/fallback).

## Architecture Decisions
- Server-authoritative state machine: the server controls all mode transitions, business logic, and gating.
- LLM's role is strictly conversational text generation within server-set boundaries.
- Single `OPENAI_MODEL` constant; model fallback via allowlist on `model_not_found`.
- Circuit breaker pattern (90s TTL) to halt API calls on hard failures (401, 429, 5xx).
- Deterministic "Checklist Mode" fallback when LLM is down.
- `pendingReportRequest` persisted in Prisma `Case.metadata` (JSON) — survives refreshes.
- Command router (`detectUserCommand`) handles report/continue/retry intents server-side.
- Telemetry scrubber removes internal labels from user-facing output.
- SSE badges emitted from backend; frontend renders a dedicated badge panel.

## Implemented (Completed)

### V3: Persona & Prompts
- Refactored system prompts (SYSTEM_PROMPT_BASE_v3, MODE_PROMPT_DIAGNOSTIC_v3, MODE_PROMPT_FINAL_REPORT_v3).
- Diagnostic submodes: main, clarification, unable.
- Server-side language policy and cause gating.

### V4: Orchestration & Flow
- Removed `labor_confirmation` mode entirely.
- `detectUserCommand` for report/continue routing.
- Telemetry scrubber removes `Система:`, `Шаг wp_...`, etc.
- SSE `badges` event and frontend badge panel.
- Labor estimates only in final report.

### V5: Resilience & Fallback (Feb 2026)
**PR1 — LLM Resilience:**
- `src/lib/llm-resilience.ts`: model allowlist, error classifier, circuit breaker.
- `callOpenAIWithFallback` in route.ts: sequential model retry on MODEL_NOT_FOUND, circuit trip on hard errors, clear on success.
- Structured SSE `status` payload to frontend (llm up/down, reason, fallback mode).

**PR2 — Checklist Mode & Pending Reports:**
- `buildChecklistResponse`: deterministic question from `diagnostic-procedures.ts` when LLM down.
- `setPendingReportRequest` with enriched metadata: `{ requestedAt, language, reason, requestedBy, lastKnownMode, lastKnownSystem }`.
- Auto-generate pending report when LLM recovers AND `causeAllowed=true`.
- Retry AI: UI button + chat command (EN/RU/ES).
- LLM down banner: blunt "senior tech" style (EN/RU/ES).
- Report command tightened: standalone + leading command only; no mid-sentence false positives.
- Expanded retry commands: EN (retry, try again), RU (повтори, попробуй снова), ES (reintentar, intenta de nuevo).

### Test Coverage
- 656 tests across 42 test files, all passing.
- `tests/v5-resilience-behavioral.test.ts`: 94 behavioral tests covering circuit breaker lifecycle, TTL expiry, shouldTripCircuit, model allowlist, error classification edge cases, report false-positive guards, Spanish/Russian command triggers, retry AI EN/RU/ES, banner copy, metadata contract, checklist mode structure, recovery path, UI data-testids.

## Prioritized Backlog

### P0
- (none — V5 complete)

### P1
- Report refusal text localization unit tests.
- Expand telemetry scrub patterns if new internal labels appear.

### P2
- Badge persistence on page reload.
- UI compact badge layout for mobile.
- Add analytics events for circuit breaker trips and checklist mode activations.

## Key Files
- `src/app/api/chat/route.ts` — Main orchestration handler
- `src/lib/llm-resilience.ts` — Model allowlist, error classifier, circuit breaker
- `src/lib/storage.ts` — CaseMetadata type with PendingReportPayload
- `src/lib/diagnostic-procedures.ts` — Checklist mode question source
- `src/components/chat-panel.tsx` — Frontend: LLM status banner, Retry AI button, badges
- `tests/v5-resilience-behavioral.test.ts` — P0 behavioral tests
