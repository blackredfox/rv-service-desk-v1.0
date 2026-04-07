# PRD

## Original problem statement
NEO TASK — Empty Case Draft + Admin-Managed Display Name for RV Service Desk.

Primary requirements:
1. `New Case` must open a local unsaved draft instead of persisting immediately.
2. A case must be persisted only when the first meaningful user-authored input is submitted.
3. Empty abandoned drafts must never appear in the sidebar or emit premature `case.created` analytics.
4. Organization admins must be able to create and edit member `displayName` values in the real member source of truth.
5. `/api/auth/me` must expose `displayName`, and the header must prefer it over raw email with a compact-email fallback.
6. Keep scope narrow and production-reasonable.

## Architecture decisions
- Kept case creation authoritative on the existing chat-first path: local draft state lives in `src/app/page.tsx`, while persistence remains server-side through the first `/api/chat` submission path.
- Rejected blank `/api/cases` creation attempts so empty drafts cannot be persisted through the old eager-create endpoint.
- Extended Firestore `OrgMember` as the source of truth for `displayName`, then surfaced it through org member APIs, `/api/auth/me`, and the header UI.
- Hardened Prisma initialization in `src/lib/db.ts` so missing generated Prisma artifacts fall back to memory mode instead of crashing route imports in dev preview.
- Kept analytics authoritative on the server-side case creation path only.

## What's been implemented
- `New Case` now resets into a local draft workspace instead of calling eager case creation.
- First real message still creates the real case through the chat flow.
- Empty abandoned drafts no longer persist or appear in the case list.
- Admin member add/edit UI now supports `displayName`.
- Org member APIs now create, update, and return `displayName`.
- `/api/auth/me` now exposes `displayName`, and the header prefers it with a compact email fallback.
- Added focused regression tests for draft behavior, display name APIs, `/api/auth/me`, and header rendering.
- Fixed live preview runtime route loading by making Prisma initialization fail over safely when generated client artifacts are unavailable.

## Prioritized backlog
### P0
- Add documented seeded authenticated test credentials so authenticated browser screenshots and live admin/header flows can be verified end-to-end.

### P1
- Add authenticated browser regression for admin display name add/edit and live header rendering.
- Consider replacing the header `<img>` with `next/image` to remove the existing lint warning.

### P2
- Optionally add a lightweight visual indicator for an unsaved local draft state if product wants stronger affordance later.

## Next tasks
- Verify authenticated admin flow with a working local seeded session.
- Capture the missing authenticated screenshots once credentials are available.
- Keep the PR narrow: avoid unrelated auth or billing changes.
