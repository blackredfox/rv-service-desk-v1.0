# README.md

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

## Core UX Flow

1. User opens the app
2. **Welcome screen** explains the purpose of the tool
3. User accepts **Terms & Privacy**
4. Main Service Desk UI opens
5. Technician starts a **New Case**
6. Chat-based diagnostics
7. Assistant produces final report
8. Technician clicks **Copy**

---

## Release 1 Scope (MVP)

### Frontend

* Welcome screen with Terms acceptance
* Sidebar with case list (session + short-term backend storage)
* Chat interface (technician ↔ assistant)
* Copy button on assistant response
* Language selector (Auto / EN / RU / ES)
* Light / Dark theme
* Mobile‑friendly layout

### Chat Features

* Text input
* **Voice‑to‑Text** input
* **Attach photo (session-only)**

  * Photo is used during the active session only
  * No persistent storage in Release 1

### Auth & Payments

* **User authentication required**
* Authentication handled via **Stripe (paid access)**
* Logged-in state required to use the app
* Login / Logout supported

### Backend

* Backend **is required**
* Responsibilities:

  * Authentication & access control
  * Case storage (≈ 30 days noted retention)
  * Chat message persistence per case
  * OpenAI request proxy

### Infrastructure

* Frontend: **Vercel**
* Backend: **Render**
* Database: **Prisma + DB (Postgres or equivalent)**
* AI: **OpenAI API**
* Payments: **Stripe**

---

## What Is NOT in Release 1

* No file downloads / exports
* No sharing links
* No long-term media storage
* No report history beyond short retention window
* No advanced analytics UI

---

## Environment Variables (Planned)

```env
OPENAI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
DATABASE_URL=
NEXT_PUBLIC_APP_URL=
```

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

---

