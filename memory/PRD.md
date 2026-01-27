# RV Service Desk - Product Requirements Document

## Original Problem Statement
Build Release 1 backend foundation for RV Service Desk:
- Auth (login/logout, session handling)
- Stripe (Checkout + webhook) tied to userId
- Prisma + Postgres persistence for cases/messages (≈30-day retention policy)
- Analytics events (minimal, privacy-safe)
- Secure OpenAI proxy (no client-side keys)

### Release 1 UI (Jan 2026)
- Auth UI wiring (Login/Logout) using existing backend routes
- Voice-to-text input for chat (client-only, Web Speech API)
- Attach photo (session-only) for chat (cleared after send)
- Analytics hooks for key UI actions (mapped to feature.used)

## User Choices (Jan 2026)
- **Database**: Supabase PostgreSQL (Transaction Pooler URL for serverless)
- **Auth**: Email + Password with bcrypt, 30-day session cookies
- **OpenAI**: User's own OPENAI_API_KEY (server-only)
- **Stripe**: Test keys, Price ID: `price_1StuJhLmSEa773AhxEhZC1UK`
- **Framework**: Existing Next.js App Router repo
- **Auth UI**: Full-page login screen (gating)
- **Analytics**: Map UI events to `feature.used` event, no backend changes
- **Registration**: Login only for Release 1

## User Personas
1. **RV Technicians** - Primary users who diagnose RV issues and generate service reports
2. **Service Managers** - Oversee technician workflows and warranty processing
3. **Warranty Processors** - Use generated reports for claims

## Core Requirements (Static)
- Email + password authentication with bcrypt
- Session-based auth with httpOnly cookies (30-day expiry)
- Stripe subscription billing (PREMIUM plan configured)
- Case & message persistence with user ownership
- OpenAI proxy (server-side API key only)
- Privacy-safe analytics events
- Rate limiting on auth endpoints

## Architecture
- **Framework**: Next.js 16 App Router
- **Database**: Supabase PostgreSQL + Prisma ORM (Transaction Pooler)
- **Auth**: Session cookies with bcrypt passwords
- **Payments**: Stripe Checkout + Webhooks
- **AI**: OpenAI API (server-only)

## What's Been Implemented (Jan 2026)

### Backend (Prior Work)
- Prisma schema with User, Session, Subscription, Case, Message, AnalyticsEvent models
- Auth API Routes: POST /api/auth/login, /logout, /register, GET /api/auth/me
- Billing API Routes: checkout-session, checkout-status, webhook
- Cases API Routes with user ownership
- Chat API Route with SSE streaming and session-only image support
- Analytics API Route (POST /api/analytics/event)

### Release 1 UI (Jan 2026)
- **Auth UI**
  - Full-page login screen with auth gating
  - Email + password inputs with validation
  - Loading state and error message display
  - Session restoration via /api/auth/me on app load
  - Logout button in header
  - Mobile responsive design
  
- **Voice-to-Text**
  - Mic button with Web Speech API integration
  - Active listening state with visual feedback
  - Graceful fallback for unsupported browsers
  - Transcript inserted into message input
  
- **Photo Attachment**
  - Camera/photo attach button
  - Mobile camera capture support (accept="image/*" capture)
  - Preview chip with remove option
  - Client-side image resize/compress
  - Cleared after send (session-only)
  
- **Analytics Hooks**
  - All events mapped to `feature.used` with metadata
  - Events tracked: auth.login, auth.logout, case.created, chat.sent, chat.photo_attached, chat.voice_dictation_used
  - Error events tracked via error.occurred
  - No PII or full message content in payloads

### New Files Created
- `/app/src/components/login-screen.tsx` - Login screen component
- `/app/src/components/auth-provider.tsx` - Auth context provider
- `/app/src/components/voice-button.tsx` - Voice dictation button
- `/app/src/components/photo-attach.tsx` - Photo attachment component
- `/app/src/hooks/use-auth.ts` - Auth hook and context
- `/app/src/lib/client-analytics.ts` - Client-side analytics helper

### Modified Files
- `/app/src/app/layout.tsx` - Added AuthProvider wrapper
- `/app/src/app/page.tsx` - Auth gating, logout button, user display
- `/app/src/components/chat-panel.tsx` - Voice + photo buttons, analytics
- `/app/src/components/sidebar.tsx` - Analytics for case creation

## API Endpoints (Final)
- `GET /api/auth/me` - Restore session
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/chat` - Chat submit with optional attachments
- `GET/POST /api/cases` - Cases CRUD
- `POST /api/analytics/event` - Analytics (feature.used events)

## Deployment Checklist
1. [ ] Set DATABASE_URL (Supabase Transaction Pooler)
2. [ ] Run `npx prisma db push` locally
3. [ ] Set OPENAI_API_KEY
4. [ ] Set STRIPE_SECRET_KEY
5. [ ] Set STRIPE_WEBHOOK_SECRET
6. [ ] Configure Stripe webhook endpoint: `/api/billing/webhook`
7. [ ] Deploy to Vercel

## Prioritized Backlog

### P0 (Critical) - DONE ✅
- ✅ Auth system (email + password)
- ✅ Stripe checkout + webhook
- ✅ Cases with user ownership
- ✅ Chat with OpenAI proxy
- ✅ Session-only image support
- ✅ Auth UI (login/logout)
- ✅ Voice-to-text input
- ✅ Photo attachment (session-only)
- ✅ Analytics hooks

### P1 (Important)
- [ ] Billing page with subscription management
- [ ] Data retention cleanup job (30-day policy)
- [ ] Main app accessibility audit

### P2 (Nice to Have)
- [ ] Magic link / OTP auth option
- [ ] Multi-language system prompts
- [ ] Admin dashboard for analytics
- [ ] Export functionality

## Next Tasks List
1. Configure DATABASE_URL with Supabase PostgreSQL
2. Run `npx prisma db push` to create tables
3. Add OPENAI_API_KEY for chat functionality
4. Configure Stripe keys for billing
5. Test full auth + chat flow end-to-end
6. Add billing/subscription page
7. Deploy to Vercel with environment variables
