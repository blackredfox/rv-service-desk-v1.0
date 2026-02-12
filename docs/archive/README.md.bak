# RV Service Desk

**RV Service Desk** is a diagnostic and authorization assistant for RV technicians.
It helps technicians structure troubleshooting conversations and generate clear, professional service reports suitable for warranty claims and internal service systems.

The product is designed for **speed, clarity, and real‑world shop workflows** — no exports, no clutter, just copy‑ready results.

---

## What the App Does

* Guides technicians through structured diagnostics via chat
* Asks the *right follow‑up questions* automatically
* Produces a **ready‑to‑copy service report** inside the chat
* Supports multiple languages (Auto / EN / RU / ES)
* Works on desktop and mobile

Technicians copy the final assistant response and paste it into their existing company system.

---

## Release 1 Features

### Frontend
* Welcome screen with Terms acceptance
* Sidebar with case list
* Chat interface (technician ↔ assistant)
* Copy button on assistant response
* Language selector (Auto / EN / RU / ES)
* Light / Dark theme
* Mobile‑friendly layout

### Backend
* **User authentication** (email + password with bcrypt)
* **Session-based auth** with httpOnly cookies
* **Stripe integration** for subscriptions (PREMIUM, PRO plans)
* **Case & message persistence** (Prisma + PostgreSQL)
* **OpenAI proxy** (server-only API key)
* **Session-only photo support** (images used for current request only, not stored)
* **Privacy-safe analytics events**
* Rate limiting on auth endpoints

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
# Database (Required)
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/rv_service_desk?schema=public"

# OpenAI API (Required for chat)
OPENAI_API_KEY=""

# Stripe (Required for billing)
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_PRICE_ID_PREMIUM=""
STRIPE_PRICE_ID_PRO=""

# App Configuration
NEXT_PUBLIC_APP_NAME="RV Service Desk"
TERMS_VERSION="v1.0"
APP_URL="http://localhost:3000"
```

### Where to Get Keys

| Key | Source |
|-----|--------|
| `DATABASE_URL` | Your PostgreSQL provider (Neon, Supabase, Railway, etc.) |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com/api-keys) |
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | Stripe CLI or Dashboard webhook settings |
| `STRIPE_PRICE_ID_*` | Create products/prices in Stripe Dashboard |

---

## Local Development Setup

### Prerequisites
- Node.js 18+
- Yarn
- PostgreSQL (Supabase recommended)

### Database Setup (Supabase)

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Go to **Settings → Database → Connection String**
3. Copy the **Transaction Pooler** URL (recommended for serverless)
4. Set in `.env`:
   ```
   DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
   ```

### Installation

```bash
# Install dependencies
yarn install

# Generate Prisma client
yarn prisma:generate

# Push schema to database (run locally, not in CI)
npx prisma db push

# Start development server
yarn dev
```

The app will be available at `http://localhost:3000`.

---

## API Routes

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| POST | `/api/auth/logout` | Logout user |
| GET | `/api/auth/me` | Get current user info |

### Cases
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cases` | List user's cases |
| POST | `/api/cases` | Create new case |
| GET | `/api/cases/[id]` | Get case with messages |
| PATCH | `/api/cases/[id]` | Update case |
| DELETE | `/api/cases/[id]` | Delete case (soft) |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message (SSE streaming) |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/billing/checkout-session` | Create Stripe checkout |
| GET | `/api/billing/checkout-status/[sessionId]` | Get payment status |
| POST | `/api/billing/webhook` | Stripe webhook handler |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analytics/event` | Track client event |

---

## Testing

```bash
# Run all tests
yarn test

# Run tests with UI
yarn test:ui
```

### Stripe Webhook Testing

Use Stripe CLI to forward webhooks locally:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/billing/webhook

# Copy the webhook signing secret to .env
# STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Enable Upgrades in Stripe Customer Portal

To allow customers to upgrade their seat tier (5 → 10 → 25), configure the Stripe Customer Portal:

### Step 1: Create Portal Configuration

1. Go to [Stripe Dashboard → Settings → Customer Portal](https://dashboard.stripe.com/settings/billing/portal)
2. Enable **"Allow customers to update subscriptions"**
3. Under "Products", add your seat-based price(s)
4. Enable **"Allow quantity changes"** if you want flexible seat counts
5. Save the configuration

### Step 2: Configure Allowed Price Changes (Optional)

If using multiple price tiers (e.g., 5/10/25 seats):

1. Create separate Stripe Prices for each tier
2. In Portal Settings → Products → Edit
3. Add all tier prices to the "Allowed prices" list
4. Enable "Proration" for mid-cycle upgrades

### Step 3: Set Portal Configuration ID (Optional)

If you have multiple portal configurations:

1. Copy the Configuration ID from Stripe Dashboard (starts with `bpc_`)
2. Add to `.env`:
   ```
   STRIPE_PORTAL_CONFIGURATION_ID=bpc_xxxxx
   ```

### Webhook Events for Seat Updates

The app handles these events for subscription changes:
- `customer.subscription.updated` - Updates seat limit from quantity
- `invoice.payment_succeeded` - Confirms seat count after payment

---

## Database Schema

Key models:

- **User** - Email + password auth
- **Session** - Cookie-based sessions (30 day expiry)
- **Subscription** - Plan (FREE/PREMIUM/PRO) + Stripe IDs
- **Case** - Diagnostic cases with user ownership
- **Message** - Chat messages (user/assistant)
- **AnalyticsEvent** - Privacy-safe telemetry
- **PaymentTransaction** - Stripe checkout tracking

Run `yarn prisma studio` to browse data.

---

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

### Render

1. Create Web Service
2. Set build command: `yarn install && yarn prisma:generate && yarn build`
3. Set start command: `yarn start`
4. Add environment variables

---

## Target Users

* RV technicians
* Service departments
* Warranty processing teams

---

## Product Philosophy

* **Fast > Fancy**
* **Copy-ready output > PDFs**
* **Guided thinking > free-form chat**
* **Real shop workflows > theoretical UX**
