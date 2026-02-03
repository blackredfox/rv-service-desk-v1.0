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

## Architecture

### Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend**: Next.js API Routes, Firebase Admin SDK
- **Database**: Firestore (primary), PostgreSQL/Prisma (optional)
- **Auth**: Firebase Auth with server-side session cookies
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

### Frontend
- `AccessBlockedScreen` - Shows Logout button and Contact Support
- `SupportButton` - Floating button with modal for contact + copy diagnostics
- `AdminOnboardingScreen` - "Invite your team" CTA after org setup
- `/admin/members` - Admin dashboard for member management
  - Members list with email, role, status, created date
  - Add member form with domain validation
  - Activate/deactivate and promote/demote controls
  - Last admin protection
- Main app shows "Manage Members" link in user menu for admins

### Tests (72 total passing)
- `tests/org-access-reasons.test.ts` - 6 tests for access reason codes
- `tests/org-admin-members.test.ts` - 9 tests for admin member APIs
- `tests/access-blocked.test.tsx` - 11 tests for UI component

## Prioritized Backlog

### P0 (Critical) - DONE
- ✅ Organization model and CRUD
- ✅ Seat-based Stripe checkout
- ✅ Webhook handling
- ✅ Access gating with proper reason codes
- ✅ Invite-only enforcement (not_a_member reason)
- ✅ Admin Dashboard for member management

### P1 (Important)
- [ ] Member invitation emails (currently record-only)
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
