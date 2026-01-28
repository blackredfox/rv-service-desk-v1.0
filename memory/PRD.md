# RV Service Desk - Product Requirements Document

## Overview
RV Service Desk is a Next.js web application for RV technicians to structure diagnostics and generate service documentation with AI assistance.

## Original Problem Statement
Implement B2B (corporate) billing and access control for RV Service Desk:
- Organization-based subscription model ($19.99/seat/month)
- Seat-based billing via Stripe
- Corporate email domain restrictions
- Admin/Member roles within organizations
- Firestore for organization and membership data

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

## What's Been Implemented (Jan 28, 2026)

### Backend
- `/api/auth/me` - Returns user, org, membership, access status
- `/api/org` - Create/get organization
- `/api/org/members` - Manage organization members
- `/api/billing/checkout-session` - Stripe seat-based checkout
- `/api/billing/webhook` - Stripe webhook handler
- `/api/billing/portal` - Stripe billing portal

### Frontend
- Welcome screen with corporate email mention
- Login/Signup with Sign in/Sign up toggle
- Terms acceptance flow
- Organization setup screen (create org + select seats)
- Billing paywall (subscribe with tier options: 5/10/25 seats)
- Access blocked screen (various states)
- Billing portal access in user menu (admin only)

### Libraries/Utilities
- `/lib/firestore.ts` - Firestore CRUD for orgs and members
- `/lib/b2b-stripe.ts` - Stripe seat-based billing helpers

### Tests
- 46 tests passing (yarn test)
- B2B billing tests
- Auth routes tests
- Webhook tests

## Prioritized Backlog

### P0 (Critical) - DONE
- ✅ Organization model and CRUD
- ✅ Seat-based Stripe checkout
- ✅ Webhook handling
- ✅ Access gating

### P1 (Important)
- [ ] Member invitation emails
- [ ] Admin dashboard for member management
- [ ] Seat increase/decrease via portal

### P2 (Nice to Have)
- [ ] Multi-org support (user in multiple orgs)
- [ ] Organization settings page
- [ ] Usage analytics per org

## Next Tasks
1. Set up real Firebase project and Stripe account for production
2. Create Stripe Product with seat-based Price
3. Configure Stripe webhook endpoint
4. Test full signup → org creation → subscription → access flow
5. Add member invitation flow with email

## Environment Variables
See `.env.example` for required configuration:
- `FIREBASE_ADMIN_KEY_PATH` - Firebase Admin SDK key
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature secret
- `STRIPE_PRICE_SEAT_MONTHLY` - Price ID for seat subscription
- `REQUIRE_SUBSCRIPTION` - Feature flag (true/false)
