# RV Service Desk - Product Requirements Document

## Overview
RV Service Desk is a Next.js web application for RV technicians to structure diagnostics and generate service documentation with AI assistance.

## Original Problem Statement
Implement Org Setup & Admin Dashboard for RV Service Desk:
1. Org Setup: First user with corporate domain becomes admin. All others need explicit invite.
2. Access Reasons: Backend returns `not_a_member` when org exists but user not added
3. AccessBlockedScreen: Must have Logout button and Contact Support link
4. Admin Dashboard at /admin/members: List members, add member (status=active), update member status/role
5. Support Button: Floating bottom-right on blocked screens and chat workspace
6. Admin Onboarding: Show 'Invite your team' CTA after org setup

### UX Polish (Feb 3, 2026)
A) Session Behavior - Session-based cookies (expires when browser closes)
B) Navigation Consistency - Single global header, "Back to Dashboard" routes to /?from=admin
C) Admin Onboarding Flow - Removed "All Set / Start" screen, go directly to dashboard
D) Admin Members Dashboard - Seat counter updates immediately after add/remove
E) Help/Support Button - Renamed "Copy Diagnostics" → "Copy Account Details"
F) Top Bar Label - Renamed "Input" → "Input language"

### UAT Fixes (Feb 3, 2026)
A) Back to Dashboard - Routes to /?from=admin to skip welcome for authenticated users
B) Copy Report Button - Added in chat workspace to copy generated report (not chat transcript)
C) Stripe Billing Portal - Enabled subscription upgrades with STRIPE_PORTAL_CONFIGURATION_ID support

### Member Claim Fix (Feb 3, 2026)
- Pre-added members can now claim their org membership on first sign-up
- Placeholder UIDs (`pending_xxx`) are automatically replaced with real Firebase UID
- Inactive members see "Account Inactive" message with admin contact
- Seat limit blocking shows clear upgrade message
- Security: Cannot claim if email already has non-placeholder UID
- Added comprehensive logging for debugging claim flow

### Stripe Webhook Sync Fix (Feb 3, 2026)
- Webhook now looks up org by `stripeCustomerId` when `metadata.orgId` is missing
- This fixes seat limit not updating after Portal upgrades
- Both `customer.subscription.updated` and `customer.subscription.deleted` events now fallback to customer ID lookup
- Added comprehensive logging:
  - `[Stripe Webhook] Received event: X`
  - `[Stripe Sync] Updating org X seatLimit to Y`
  - `[API /api/auth/me] Returning org data: seatLimit=X`
- Added `/api/debug/org-seats` endpoint for troubleshooting
- Webhook always saves `stripeCustomerId` to ensure future lookups work

### Member Invitation Emails (Feb 3, 2026)
- **MVP Implementation**: Plain transactional email sent when admin adds a new member
- **Email Provider**: Resend (easily swappable via `/app/src/lib/email.ts`)
- **Email Content**: 
  - Subject: "You've been invited to join {orgName}"
  - Body: Org name, inviter email (if available), sign-in link, domain guidance
- **Behavior**: 
  - Fire-and-forget (email failure doesn't block member creation)
  - HTML sanitization to prevent XSS
  - Lazy client initialization for test compatibility
- **Configuration**: 
  - `RESEND_API_KEY` - API key from resend.com
  - `SENDER_EMAIL` - Defaults to onboarding@resend.dev
  - `APP_NAME` - Defaults to "RV Service Desk"
### Payload v2: Input Language Detection + Output Policy (Feb 4, 2026)
- **Problem**: Selector value was corrupting `inputLanguage`, making detection impossible
- **Solution**: Payload v2 contract separating detection from output policy
- **New Types** (`/app/src/lib/lang.ts`):
  - `InputLanguageV2`: `{ detected, source, confidence, reason }`
  - `OutputLanguagePolicyV2`: `{ mode, effective, strategy }`
  - `detectInputLanguageV2(text)`: Always detects from message text
  - `computeOutputPolicy(mode, detected)`: Computes effective output
- **SSE Event**: New `{type:"language"}` event with detection results
- **Prompt Composer v2** (`composePromptV2`):
  - Uses `inputDetected` for "Technician input language"
  - Uses `outputEffective` for "All dialogue MUST be in"
  - Final report translates to `inputDetected` (what tech reads)
- **Fallback**: Uses `outputEffective` language for dialogue
- **Tests**: 19 new tests in `payload-v2.test.ts`

### Fix Spanish Validation Fallback Drift (Feb 4, 2026)
- **Problem**: EMPTY_OUTPUT validation fallback was hardcoded in Spanish, causing all fallback responses to appear as Spanish regardless of selected language
- **Fix**: Localized fallback messages for all modes
  - `FALLBACK_QUESTIONS`: EN/RU/ES diagnostic questions
  - `FALLBACK_AUTHORIZATION`: EN/RU/ES authorization messages
  - `FALLBACK_FINAL_REPORT`: EN/RU/ES report messages
- **`getSafeFallback(mode, language)`** now returns localized text
- **Default behavior**: Unknown/AUTO language defaults to EN (with warning log)
- **Tests**: 6 new localization tests added to `mode-validators.test.ts`

### Input Language Lock Fix (Feb 4, 2026)
- **Problem**: Russian input treated as Spanish, language drift across messages
- **Fix**: Server-controlled language lock per case
- **Logic**:
  - Explicit language selection (EN/RU/ES) always overrides
  - AUTO mode: locks to detected language on first message
  - Once locked, AUTO respects case language (no re-detection)
  - Mid-case dropdown change updates case language immediately
- **Hard Language Directive**: Added to every LLM call
  - Diagnostic/Auth: "All dialogue MUST be in {language}. Do not respond in any other language."
  - Final Report: "English first, then --- TRANSLATION --- into {language}"
- **New function**: `buildLanguageDirective()` in `prompt-composer.ts`
- **Tests**: 19 new tests in `input-language-lock.test.ts`

### Fix Duplicate System Prompt Sources (Feb 4, 2026)
- **Problem**: Two competing system prompt sources causing language drift
  - `prompts/system/SYSTEM_PROMPT_BASE.txt` (correct runtime source)
  - `prompts/system-prompt-final.ts` (legacy, causing confusion)
- **Fix**: Single runtime source = `prompts/system/SYSTEM_PROMPT_BASE.txt`
  - Created shared types file: `src/lib/types/diagnostic.ts`
  - Updated `output-validator.ts` to use shared types
  - Fixed comment in `system-prompt-v1.ts` to point to correct source
  - Updated tests to validate actual runtime behavior
  - Deleted legacy `prompts/system-prompt-final.ts`
  - Removed `@prompts` alias from vitest.config.ts
- **Tests**: All 212 tests pass

### Prompt Split & Composer Architecture (Feb 4, 2026)
- **D1 - Split Prompts**: Customer prompt split into 4 operational blocks:
  - `prompts/system/SYSTEM_PROMPT_BASE.txt` - Immutable laws/guardrails
  - `prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt` - Diagnostic form behavior
  - `prompts/modes/MODE_PROMPT_AUTHORIZATION.txt` - Authorization text generation
  - `prompts/modes/MODE_PROMPT_FINAL_REPORT.txt` - Portal-Cause format
- **D2 - Prompt Composer** (`/app/src/lib/prompt-composer.ts`):
  - Deterministic composition based on `case.mode`
  - Explicit command transitions only: `START FINAL REPORT`, `START AUTHORIZATION REQUEST`
  - Memory window (N=12 messages)
  - Never infers mode from meaning
- **D3 - Mode Validators** (`/app/src/lib/mode-validators.ts`):
  - Diagnostic: Must be single question, blocks final report content
  - Final Report: Requires `--- TRANSLATION ---`, labor, correct format
  - Prohibited words detection: broken, failed, defective, etc.
  - Retry once with correction, then safe fallback
- **D4 - Tests**: 42 new tests in `prompt-composer.test.ts` and `mode-validators.test.ts`
- **Schema**: Added `mode` field to Case model (diagnostic | authorization | final_report)

### Prompt Enforcement & API Contract Fix (Feb 4, 2026)
- **System Prompt v3.2**: Model-agnostic, deterministic diagnostic engine
- **STATE Machine**: Explicit `DIAGNOSTICS` and `CAUSE_OUTPUT` states
- **API Contract**:
  - `dialogueLanguage` passed explicitly on every request
  - `currentState` passed explicitly (or inferred from history)
  - Validation of response language and format
- **Output Validator** (`/app/src/lib/output-validator.ts`):
  - Detects English during non-EN diagnostics
  - Detects translation separator in wrong state
  - Detects multiple questions (only ONE allowed)
  - Validates Cause format (no headers, no numbered lists)
  - Logs violations (non-blocking)
- **Complex Equipment Classification**: Locked list, water pump = NON-COMPLEX
- **Tests**: 23 new tests in `/app/tests/prompt-enforcement.test.ts`

### Stripe Seat Limit Sync Fix - Source of Truth (Feb 4, 2026)
- **Root cause**: Refresh button only refetched cached data, didn't sync from Stripe
- **Fix**: Created `POST /api/billing/sync-seats` endpoint that fetches subscription from Stripe
- **Architecture**:
  - `b2b-stripe.ts` is the ONLY source of truth for B2B subscriptions
  - `stripe.ts` is for individual subscriptions (Prisma) - separate concern
  - seatLimit calculated: `subscription.items.data.reduce((sum, item) => sum + item.quantity, 0)`
- **Refresh button now**:
  1. Calls `POST /api/billing/sync-seats` (syncs from Stripe)
  2. Calls `refresh()` (refetch /api/auth/me)
  3. Calls `fetchMembers()` (refetch member list)
- **Webhook**: Already correctly uses `b2b-stripe.ts`, fixed to sum ALL item quantities
- **New endpoint**: `POST /api/billing/sync-seats` (admin only)
- **Tests**: 11 new tests in `/app/tests/stripe-seat-sync.test.ts`

## Architecture

### Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend**: Next.js API Routes, Firebase Admin SDK
- **Database**: Firestore (primary), PostgreSQL/Prisma (optional)
- **Auth**: Firebase Auth with server-side session cookies (browser session persistence)
- **Billing**: Stripe (seat-based subscriptions)

### Data Model (Firestore)
- `organizations/{orgId}` - Company info, subscription status, seat limits
- `orgMembers/{memberId}` - User membership with role (admin/member)

## User Personas

### Organization Admin
- Creates and manages organization
- Sets approved email domains
- Selects seat count and manages billing
- Invites/removes team members

### Technician (Member)
- Signs up with corporate email
- Uses app within seat limits
- Cannot access billing

## Core Requirements (Static)
1. ✅ Firebase Auth with session cookies
2. ✅ Terms acceptance flow
3. ✅ Organization creation with domain validation
4. ✅ Seat-based Stripe subscription checkout
5. ✅ Webhook handler for subscription events
6. ✅ Access gating based on subscription + seat limits
7. ✅ Admin/Member role differentiation
8. ✅ Invite-only access enforcement
9. ✅ Admin Dashboard for member management
10. ✅ Support button on blocked screens and chat

## What's Been Implemented (Feb 3, 2026)

### Session & Auth (UX Polish)
- Session cookies no longer have `maxAge` → expire when browser closes
- No custom "logout on window close" hacks needed

### Backend - Org Setup & Admin Dashboard
- `/api/auth/me` - Returns access reasons:
  - `not_a_member` - When org exists but user not added
  - `no_organization` - When no org exists for domain (canCreateOrg flag)
  - `blocked_domain` - For personal email domains
  - `subscription_required` - When org needs subscription
  - `seat_limit_exceeded` - When seats are full
  - `inactive` / `pending` - Member status issues

- `/api/org/members` (GET) - List all members (admin only)
- `/api/org/members` (POST) - Add member with `status: active`
  - Validates email domain matches org
  - Rejects if subscription inactive
  - Rejects if seat limit reached
- `/api/org/members` (PATCH) - Update member status/role
  - Prevents demoting/deactivating last admin

- `/api/org/activity` (GET) - Get team activity metrics (admin only)
  - Last login timestamp per member
  - Cases created (7d / 30d)
  - Total messages sent
  - Sorted by most inactive first (default)

### Frontend
- `AccessBlockedScreen` - Shows Logout button and Contact Support
- `SupportButton` - Floating button with modal for contact + **Copy Account Details** (renamed from diagnostics)
  - Copies: Email, Role, Organization, Org ID, Seats (X/Y), Current page, App version, Timestamp
  - Does NOT include chat messages or case content
- `LanguageSelector` - Label renamed from "Input" to **"Input language"**
- `/admin/members` - Admin dashboard with tabs:
  - **Members tab**: Member list with add/activate/deactivate/promote controls
  - **Activity tab**: Sortable table (last login, cases, messages)
  - Navigation: "Back to Dashboard" link (no standalone logout button)
  - Seat counter updates immediately after member changes
- Admin onboarding: Dismissible banner on app (not separate screen)

### Tests (253 total passing)
- `tests/org-access-reasons.test.ts` - 6 tests for access reason codes
- `tests/org-admin-members.test.ts` - 9 tests for admin member APIs
- `tests/org-activity.test.ts` - 4 tests for activity API
- `tests/access-blocked.test.tsx` - 11 tests for UI component
- `tests/seat-counter-refresh.test.ts` - 13 tests for seat counter and refresh button
- `tests/member-invitation-email.test.ts` - 8 tests for invitation email functionality
- `tests/stripe-seat-sync.test.ts` - 11 tests for Stripe seat limit sync
- `tests/prompt-enforcement.test.ts` - 35 tests for runtime prompt and output validation
- `tests/prompt-composer.test.ts` - 16 tests for prompt composition and mode transitions
- `tests/mode-validators.test.ts` - 29 tests for mode validation, prohibited words, and localized fallbacks
- `tests/input-language-lock.test.ts` - 19 tests for language lock and directive
- `tests/payload-v2.test.ts` - 19 tests for v2 detection/policy separation

## Prioritized Backlog

### P0 (Critical) - DONE
- ✅ Organization model and CRUD
- ✅ Seat-based Stripe checkout
- ✅ Webhook handling
- ✅ Access gating with proper reason codes
- ✅ Invite-only enforcement (not_a_member reason)
- ✅ Admin Dashboard for member management

### P1 (Important) - DONE
- ✅ Member invitation emails (transactional, MVP)

### P1 (Important) - Remaining
- [ ] Seat increase/decrease via Stripe portal integration

### P2 (Nice to Have)
- [ ] Multi-org support (user in multiple orgs)
- [ ] Organization settings page
- [ ] Usage analytics per org

## Next Tasks
1. Set up real Firebase project and Stripe account for production
2. Create Stripe Product with seat-based Price
3. Configure Stripe webhook endpoint
4. Test full signup → org creation → subscription → access flow
5. Consider adding email invitations for better UX

## Environment Variables
See `.env.example` for required configuration:
- `FIREBASE_ADMIN_KEY_PATH` - Firebase Admin SDK key
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature secret
- `STRIPE_PRICE_SEAT_MONTHLY` - Price ID for seat subscription
- `REQUIRE_SUBSCRIPTION` - Feature flag (true/false)

## Branch
`feat/org-setup-admin-dashboard` - Created from main
