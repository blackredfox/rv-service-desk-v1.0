# PRD — RU/EN Switch Parity Tests + Language Badge UI

## Original Problem Statement
Follow-up request:
1) Add RU/EN explicit language-switch parity tests.
2) Add a tiny UI badge in chat showing detected language per turn for transparency.

## Architecture Decisions
- Extended existing language-force detector rather than creating a new pathway.
- Kept server API/SSE contract stable; only expanded frontend event typing for already-emitted `language` events.
- Implemented badge as lightweight local UI state keyed by assistant message ID (no backend schema changes).

## What Has Been Implemented
### 1) RU/EN explicit language-switch parity
- Updated `src/lib/lang.ts`:
  - `detectForcedOutputLanguage(...)` now supports RU explicit phrases:
    - `говори по-русски`, `на русском`, `русский*`, `russian`
  - Supports EN explicit phrases:
    - `speak english`, `english`, `на английском`, `говори по-английски`, `английский*`
  - `detectLanguage(...)` now returns explicit reasons for RU/EN requests too:
    - `explicit-russian-request`, `explicit-english-request`.

### 2) Route parity validation
- Existing route logic already applies forced output from `detectForcedOutputLanguage(...)`.
- Added tests in `tests/chat-route.test.ts`:
  - force RU despite conflicting selector mode
  - force EN despite conflicting selector mode
  - assertions cover SSE language payload and prompt language directive.

### 3) Tiny UI language badge per turn
- Updated `src/lib/api.ts`:
  - expanded `ChatSseEvent` union to include `type: "language"` payload.
- Updated `src/components/chat-panel.tsx`:
  - listens for SSE `language` events
  - stores per-turn language info (`inputDetected`, `outputEffective`)
  - renders compact assistant badge:
    - `Detected <X> · Reply <Y>`
  - adds `data-testid` for badge: `chat-language-badge-<messageId>`.

### 4) Focused tests
- Updated `tests/lang-spanish-detection.test.ts`:
  - added RU explicit force tests
  - added EN explicit force tests.

## Verification
- Passed:
  - `yarn test tests/lang-spanish-detection.test.ts tests/chat-route.test.ts`
- Parse validation passed:
  - `src/components/chat-panel.tsx`
  - `src/lib/api.ts`

## Prioritized Backlog
### P0
- Add component-level UI test for the new language badge rendering in chat panel.

### P1
- Persist turn-level detected language metadata for historical messages after refresh/reload (currently strongest for active turn).

### P2
- Add explicit force-phrase parity for more variants/typos across RU/EN/ES.

## Next Tasks
1. Add a small chat-panel rendering test for `language` SSE event badge.
2. Optionally expose badge tooltip with detector confidence.
3. Keep final-report translation contract unchanged while iterating language UX.
