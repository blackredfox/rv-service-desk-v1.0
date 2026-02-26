# V5 Resilience & Fallback — Merge Handoff

**Branch:** `feat/v5-resilience-fallback-checklist`

---

## Files Touched

| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Integrated circuit breaker, model fallback, checklist mode, enriched `setPendingReportRequest`, tightened report/retry command patterns, updated banner copy |
| `src/lib/llm-resilience.ts` | Model allowlist, error classifier, circuit breaker (created in prior session, unchanged this session) |
| `src/lib/storage.ts` | `CaseMetadata.pendingReportRequest` changed from `boolean` to `PendingReportPayload \| null`; added `PendingReportPayload` export |
| `src/components/chat-panel.tsx` | LLM status banner, Retry AI button, badges panel (created in prior session, unchanged this session) |
| `tests/v5-resilience-behavioral.test.ts` | **New.** 94 behavioral tests covering all P0 edge cases |
| `memory/PRD.md` | Updated with V5 completion status |

---

## Manual Validation Checklist (once OpenAI access returns)

### 1. Report request while LLM is down → queued + checklist

1. Trip the circuit breaker (e.g., set `OPENAI_API_KEY` to an invalid value, send a message, wait for 401 → circuit trips).
2. Send `report` (EN), `отчёт` (RU), or `reporte` (ES).
3. **Expected:**
   - SSE `status` event with `llm.status: "down"`, `fallback: "checklist"`.
   - Banner: "AI temporarily unavailable. Use Checklist Mode to continue. Your report request will be queued."
   - Response is a deterministic checklist question (not an LLM response).
   - `Case.metadata.pendingReportRequest` is set with `{ requestedAt, language, reason: "llm_down", requestedBy: "command", lastKnownMode, lastKnownSystem }`.

### 2. Recovery → auto-report only when causeAllowed=true

1. Restore a valid `OPENAI_API_KEY`.
2. Wait for circuit TTL (90s) to expire, or send `retry ai`.
3. Send any diagnostic message.
4. **Expected (causeAllowed=false):** Normal diagnostic response. `pendingReportRequest` remains set. No report generated.
5. **Expected (causeAllowed=true):** Auto-transition to `final_report` mode. Report generated. `pendingReportRequest` cleared.

### 3. Retry command/button behavior

- **Button:** Click "Retry AI" in the bottom toolbar → sends `retry ai` as a chat message.
- **Chat commands (case-insensitive):**
  - EN: `retry ai`, `retry`, `try again`
  - RU: `повтори`, `повтори ai`, `попробуй снова`
  - ES: `reintentar`, `reintentar ai`, `intenta de nuevo`
- **Expected:** If circuit is still open, checklist response. If circuit has recovered, LLM response resumes.

### 4. Banner + badges rendering (left panel)

- **LLM down banner:** Appears above chat messages when `llmStatus.status === "down"`. Amber background, blunt text.
- **Badges panel (left sidebar):** Shows System, Complexity, Mode, Isolation, Finding, Active Step. Updated via SSE `badges` event on every request.
- **data-testid coverage:** `llm-status-banner`, `retry-ai-button`, `badges-panel`, `badge-system`, `badge-mode`, etc.

### 5. False positive guard

- Send `I will write report later` → must NOT trigger report generation.
- Send `What about the report?` → must NOT trigger.
- Send `El reporte no está listo` → must NOT trigger.

---

## Known Limitations

- **Testing agent not run.** 94 unit/behavioral tests pass (`yarn test` — 656/656). No live integration test against OpenAI API (blocked by Identity review).
- **Badge persistence (P2).** Badges reset on page reload. State lives in React component state, not persisted.
- **Mobile badge layout (P2).** Badges panel is functional but not optimized for small screens.
- **Circuit breaker metrics (P2).** No admin dashboard tracking for trip events or recovery times.

---

## Test Commands

```bash
# Run all tests
yarn test

# Run only V5 behavioral tests
npx vitest run tests/v5-resilience-behavioral.test.ts

# Run all resilience-related tests
npx vitest run tests/v5-resilience-behavioral.test.ts tests/llm-resilience.test.ts tests/orchestration-fallback.test.ts
```
