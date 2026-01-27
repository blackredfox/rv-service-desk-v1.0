# RV Service Desk - PRD

## Original Problem Statement
Replace /api/auth/* backend implementation with Firebase Auth (Option B / enterprise-ready):
- POST /api/auth/register and POST /api/auth/login no longer return 503 locally
- Session managed via Firebase session cookies (httpOnly)
- GET /api/auth/me works (returns 200 when logged in, 401 when not)
- DB user record + subscription kept in sync in Prisma

## Architecture
- **Framework**: Next.js 16 (App Router)
- **Database**: Neon Postgres via Prisma
- **Auth**: Firebase Auth with session cookies
- **Session**: httpOnly cookie `rv_session` containing Firebase session cookie

## What's Been Implemented (Jan 2026)

### Prisma Schema Changes
- `User.password` → nullable (`String?`)
- Added `User.firebaseUid` (`String? @unique`)
- Added index on `firebaseUid`

### Auth Backend Routes (Firebase-based)
1. **POST /api/auth/register**
   - Validates email + password (>=8 chars)
   - Creates user in Firebase via Admin SDK
   - Upserts user + subscription in Prisma
   - Returns 201 with user data

2. **POST /api/auth/login**
   - Verifies credentials via Firebase REST API (Identity Toolkit)
   - Creates Firebase session cookie via Admin SDK
   - Sets `rv_session` httpOnly cookie
   - Upserts user + subscription in Prisma
   - Returns 200 with user data

3. **GET /api/auth/me**
   - Reads `rv_session` cookie
   - Verifies via `verifySessionCookie(cookie, true)`
   - Returns 200 with user data or 401 if not authenticated

4. **POST /api/auth/logout**
   - Clears `rv_session` cookie (maxAge 0)
   - Returns `{ success: true }`

### Supporting Files
- `/app/src/lib/auth.ts` - Firebase auth utilities
- `/app/src/lib/firebase-admin.ts` - Firebase Admin initialization (unchanged)
- `/app/.env.example` - Updated with Firebase env vars

## Required Environment Variables
- `DATABASE_URL` - Neon Postgres connection string
- `FIREBASE_ADMIN_KEY_PATH` - Path to service account JSON (default: secrets/firebase-admin.json)
- `FIREBASE_WEB_API_KEY` - Firebase Web API Key for password sign-in
- `SESSION_COOKIE_DAYS` - Cookie duration (default: 7)

## Core Requirements (Static)
- No secrets committed to repo
- Firebase Admin service account at secrets/firebase-admin.json (git-ignored)
- No UI changes (backend-only task)

## Next Tasks / Backlog
- P0: Test full flow with real Firebase credentials
- P1: Add password reset flow (Firebase sendPasswordResetEmail)
- P2: Add email verification flow
- P2: Add OAuth providers (Google, etc.)
