# PRD — NEO TASK: Fix Prisma FK crash for new caseId on /api/chat

## Original Problem Statement
`POST /api/chat` could return 500 with Prisma `P2003` (`Message_caseId_fkey`) when appending a message for a caseId that does not exist in DB. Goal: make chat robust for new/missing case IDs without changing streaming/SSE behavior.

## Architecture Decisions
- Implemented DB integrity fix in `src/lib/storage.ts` only.
- Kept route streaming + SSE contract untouched.
- Used atomic `case.upsert` before `message.create` in DB path.
- Preserved memory-mode behavior, with explicit memory fallback when user context is unavailable.

## What Has Been Implemented
- Updated `appendMessageDb(args)`:
  - If Prisma unavailable: unchanged fallback to memory.
  - If `userId` is missing: fallback to memory to avoid invalid DB writes (Case requires `userId`).
  - If `userId` exists: ensures Case exists via `case.upsert(...)` and then inserts message in a transaction path.
  - Touches `case.updatedAt` after insert as before.
- Added focused tests to validate no-FK-crash behavior:
  - `tests/storage-append-message-case-autocreate.test.ts`
  - Covers:
    1) new-chat style flow (`caseId` generated upstream) persists case + first message
    2) explicit non-existent `caseId` is auto-created before message insert

## Verification
- Passed: `yarn test tests/storage-append-message-case-autocreate.test.ts`
- Passed regression: `yarn test tests/chat-route.test.ts tests/chat-transition-final-report.test.ts`

## Prioritized Backlog
### P0
- Add route-level integration test (mock auth cookie + DB mock) that simulates curl path end-to-end.

### P1
- Add explicit ownership guard in append path for edge-case direct writes with mismatched `caseId`/`userId`.

### P2
- Add low-overhead DB telemetry counter for auto-created cases from append path.

## Next Tasks
1. Optionally add one e2e-style `/api/chat` unit test for unauthenticated curl path to assert SSE starts and no 500.
2. Decide policy for handling mismatched `caseId` ownership in direct append calls.
3. Keep this fix scoped (no streaming/UI changes).
