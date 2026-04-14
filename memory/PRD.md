# RV Service Desk — PRD

## Project
RV Service Desk — professional RV diagnostic and service authorization engine for the US RV industry.

## Architecture
- Next.js + TypeScript + Prisma + Firebase Auth
- LLM-backed diagnostic flow (OpenAI GPT)
- Context Engine as single flow authority
- Deterministic server-side routing + terminal state machine

## Current PR: fix/object-routing-dirty-input-and-report-readiness

### Problem Addressed
Four defect classes from manual testing:
- A. Object routing failure (jack/water pump misrouted to converter)
- B. Dirty-input collapse (typos, mixed-language, noisy input)
- C. Report-readiness ask-only-missing failure
- D. False terminal / premature report prompting

### What Was Implemented (2026-01-XX)
1. **Object-first routing** — Added tongue_jack system patterns before inverter_converter in detectSystem(); expanded water_pump patterns for dirty Russian input
2. **Dirty-input normalization** — Added Cyrillic typo normalization (водяноя → водяной) in input-normalization.ts
3. **Ask-only-missing extraction** — Expanded COMPLAINT_PATTERNS, FINDING_PATTERNS, CORRECTIVE_ACTION_PATTERNS in repair-summary-intent.ts for water pump scenarios
4. **False terminal prevention** — Added UNRESOLVED_DIAGNOSTIC_PATTERNS in context-engine.ts that block premature fault_candidate/terminal transitions for intermittent behavior

### Files Changed
- `src/lib/diagnostic-procedures.ts` — tongue_jack patterns, expanded water_pump patterns
- `src/lib/chat/input-normalization.ts` — Cyrillic typo normalization
- `src/lib/chat/repair-summary-intent.ts` — expanded report readiness patterns
- `src/lib/context-engine/context-engine.ts` — unresolved diagnostic signal blocking

### Tests Added
- `tests/object-routing-report-readiness.test.ts` — 28 focused regression tests covering all 4 defect classes

### Backlog
- P0: None remaining for this PR scope
- P1: Tongue jack diagnostic procedure (currently detected but no full procedure)
- P2: Broader dirty-input transliteration (beyond single-word typo fixes)
- P2: Work-list drafting, labor editing workflow (out of scope for this PR)
