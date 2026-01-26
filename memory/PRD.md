# RV Service Desk - Product Requirements Document

## Original Problem Statement
Build Release 1 backend foundation for RV Service Desk:
- Auth (login/logout, session handling)
- Stripe (Checkout + webhook) tied to userId
- Prisma + Postgres persistence for cases/messages (≈30-day retention policy)
- Analytics events (minimal, privacy-safe)
- Secure OpenAI proxy (no client-side keys)

## User Personas
1. **RV Technicians** - Primary users who diagnose RV issues and generate service reports
2. **Service Managers** - Oversee technician workflows and warranty processing
3. **Warranty Processors** - Use generated reports for claims

## Core Requirements (Static)
- Email + password authentication with bcrypt
- Session-based auth with httpOnly cookies (30-day expiry)
- Stripe subscription billing (PREMIUM, PRO plans)
- Case & message persistence with user ownership
- OpenAI proxy (server-side API key only)
- Privacy-safe analytics events
- Rate limiting on auth endpoints

## Architecture
- **Framework**: Next.js 16 App Router
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: Session cookies with bcrypt passwords
- **Payments**: Stripe Checkout + Webhooks
- **AI**: OpenAI API (server-only)

## What's Been Implemented (Jan 2026)

### Prisma Schema
- User model (id, email, password, timestamps)
- Session model (cookie-based auth, 30-day expiry)
- Subscription model (plan, status, Stripe IDs)
- Case model (user ownership, soft delete)
- Message model (user/assistant roles)
- AnalyticsEvent model (privacy-safe)
- PaymentTransaction model (Stripe tracking)

### Auth API Routes
- POST /api/auth/register - Create user with validation
- POST /api/auth/login - Authenticate + session cookie
- POST /api/auth/logout - Clear session
- GET /api/auth/me - Get current user info

### Billing API Routes
- POST /api/billing/checkout-session - Create Stripe checkout
- GET /api/billing/checkout-status/[sessionId] - Payment status
- POST /api/billing/webhook - Handle Stripe events

### Cases API Routes (with user ownership)
- GET /api/cases - List user's cases
- POST /api/cases - Create case
- GET /api/cases/[id] - Get case + messages
- PATCH /api/cases/[id] - Update case
- DELETE /api/cases/[id] - Soft delete

### Chat API Route
- POST /api/chat - SSE streaming with OpenAI
- Session-only image support (not stored)
- User message tracking in analytics

### Analytics API Route
- POST /api/analytics/event - Track client events

### Tests (27 passing)
- Auth routes tests
- Stripe webhook tests
- Cases CRUD tests
- Chat route tests

## Prioritized Backlog

### P0 (Critical)
- ✅ Auth system (email + password)
- ✅ Stripe checkout + webhook
- ✅ Cases with user ownership
- ✅ Chat with OpenAI proxy
- ✅ Session-only image support

### P1 (Important)
- [ ] Voice-to-text input
- [ ] Frontend auth integration (login/logout UI)
- [ ] Billing page with subscription management
- [ ] Data retention cleanup job (30-day policy)

### P2 (Nice to Have)
- [ ] Magic link / OTP auth option
- [ ] Multi-language system prompts
- [ ] Admin dashboard for analytics
- [ ] Export functionality

## Next Tasks List
1. Configure DATABASE_URL with production PostgreSQL
2. Set up Stripe products and price IDs
3. Add OPENAI_API_KEY for chat functionality
4. Integrate auth UI in frontend
5. Add billing/subscription page
6. Deploy to Vercel with environment variables
