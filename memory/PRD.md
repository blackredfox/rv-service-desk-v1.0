# RV Service Desk — PRD & Implementation Memory

## Original Problem Statement
Cases and messages are not persisted and disappear after session end. Implement minimal, safe persistence with 30-day retention and visible expiration indicator per case.

## Architecture
- **Stack**: Next.js (App Router), TypeScript, Vitest, OpenAI API
- **Key flow**: `diagnostic` → `labor_confirmation` → `final_report`
- **Persistence**: In-memory store (no DB required) with retention fields
- **Retention**: Single source of truth in `retention.ts` (30 days from lastActivityAt)

## What's Been Implemented

### Session 1 — Language Policy
- Declarative `LanguagePolicy` in `lang.ts`

### Session 2 — Labor Confirmation + Copy UX
- `labor_confirmation` mode, labor sum validation, copy button feedback

### Session 3 — Diagnostic Behavior Fix
- Diagnostic question registry, pivot rules, fact-locked reports, tone adjustment, labor input fix

### Session 4 (Jan 2026) — Case Persistence + Retention

#### A. Retention Logic (`src/lib/retention.ts`)
- `RETENTION_DAYS = 30` — single constant
- `computeExpiresAt(lastActivityAt)` — adds 30 days
- `computeTimeLeftSeconds(expiresAt)` — seconds until expiry
- `formatTimeLeft(seconds)` — compact display (Xd/Xh/Xm/Expired)
- `getUrgencyTier(seconds)` — normal/warning/urgent/expired
- `isExpired(lastActivityAt)` — boolean check

#### B. Storage Layer (`src/lib/storage.ts`)
- `CaseSummary` extended with `lastActivityAt`, `expiresAt`, `timeLeftSeconds`
- `withRetention()` helper enriches any case object
- All create/update/ensure/append operations compute retention fields
- `appendMessage` touches `lastActivityAt` (extending retention)
- `listCases` and `searchCases` filter expired cases
- Both in-memory and DB paths updated

#### C. API (`src/app/api/cases/route.ts`)
- `GET /api/cases` returns `lastActivityAt`, `expiresAt`, `timeLeftSeconds` per case
- Frontend uses `timeLeftSeconds` directly (no recomputation)

#### D. Sidebar Expiration Badge (`src/components/sidebar.tsx`)
- `ExpiryBadge` component per case
- Color-coded by urgency tier:
  - Normal (>= 7d): subtle zinc
  - Warning (1-6d): amber
  - Urgent (< 24h): red
  - Expired: deep red
- Tooltip shows context

#### E. Cleanup Script (`scripts/cleanup-retention.ts`)
- Deletes expired cases + messages from Prisma DB
- Supports `--dry-run` flag
- Logs count of deleted cases/messages

#### Tests
- `tests/retention.test.ts` — 25 tests
- Total: 472 tests passing, 34 test files

## Backlog
- P0: None
- P1: Add GitHub Actions cron workflow for daily cleanup
- P1: Add toast notification when case is about to expire (< 24h)
- P2: Configurable retention window per organization
- P2: Export case data before expiration
