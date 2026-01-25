# RV Service Desk

**RV Service Desk** is a diagnostic and authorization AI agent for RV service operations in the United States.

The product assists RV technicians during diagnostics and generates authorization-ready technical reports for:
- warranty claims,
- insurance claims,
- customer-pay repairs.

The agent **assists and formats documentation**, but **does not make technical decisions** and **does not guarantee approvals**.

---

## Product Principles

- ChatGPT-like interface (chat + left sidebar with case history)
- Minimal, distraction-free UI
- Text-only data storage (no images, no files, no audio stored)
- English final reports (with copy in technician’s input language)
- Technician remains fully responsible for all decisions

---

## Platform (MVP)

**Web Application (PWA-ready)**

- Desktop / Tablet / Mobile browser
- No messengers
- No third-party system integrations
- Copy / Paste workflow only

---

## Tech Stack (Current MVP)

- **Next.js (App Router) + TypeScript**
- Tailwind CSS
- API routes (server-only)
- OpenAI via HTTP + SSE streaming
- Light / Dark mode
- Tests: Vitest

---

## Package Manager (Required)

We officially use **Yarn**.

- `yarn.lock` is the source of truth
- `package-lock.json` must **not** be used or committed

Commands:
- `yarn install`
- `yarn dev`
- `yarn test`
- `yarn lint`

---

## Configuration / Env Vars

See `.env.example`. Create a local `.env` (not committed).

- `OPENAI_API_KEY` (required for chat)
- `TERMS_VERSION` (required; terms gate versioning)
- `DATABASE_URL` (optional; enables Prisma/Postgres persistence in Phase 2)

---

## Database / Storage

- The MVP runs with **in-memory storage by default** (no DB required to run locally).
- When `DATABASE_URL` is provided (Phase 2), Prisma/Postgres persistence will be enabled.
- **Text-only** storage: case title + message text.
- No files/images/audio are stored in the MVP.

---

## State of MVP (Current Capabilities)

- Chat UI with SSE streaming and **client-abort handling**
- Cases: create / list / rename (planned) / delete
- Search (case title + message text)
- Terms gate + versioning via `TERMS_VERSION` + localStorage acceptance
- Copy buttons on assistant messages: plain + "system" format
- Tests: Vitest

### Storage Policy
- Text-only chat history
- No storage of:
  - images
  - files
  - screenshots
  - audio
- Optional cloud text sync (future)

---

## Core Concepts

### Case = Chat
- Each case is a standalone chat thread
- Cases are listed in the left sidebar
- Cases can be renamed or deleted
- No workflow statuses (by design)

### Operating Modes (Automatic)
The agent automatically switches modes based on context:
- **Service Authorization Mode**  
  (warranty / insurance / third-party payer)
- **Customer Authorization Mode**  
  (customer-pay repairs)

Modes are invisible to the user but affect language and output rules.

---

## Supported Languages

### Input
- English
- Russian
- Spanish

### Output
- Final authorization report: **English only**
- Additional copy: technician’s input language

---

## Agent Scenarios

### Guided Diagnostics
- Step-by-step questioning
- One question at a time
- Technician-provided answers only

### Report From Findings
- Technician provides completed diagnostics
- Agent formats without adding assumptions

---

## Output Format

### Authorization-Ready Report (English)
- Complaint
- Diagnostic Procedure
- Verified Condition
- Recommended Corrective Action
- Estimated Labor (breakdown + total)
- Required Parts

No numbering.  
Shop-style language.  
Approval-safe wording.

---

## Legal & Compliance

- Mandatory acceptance of Terms & Privacy on first launch
- Inline disclaimer: agent assists only
- No liability for approvals, repairs, or outcomes
- Technician retains full responsibility

---

## Non-Goals (MVP)

- No automatic report submission
- No DMS / insurance integrations
- No media storage
- No approval guarantees

---

## Status

🚧 **In active development (MVP phase)**

See `ROADMAP.md` for details.
