# ROADMAP.md

## Release 1 — MVP (Current Priority)

**Goal:** Ship an approval-safe diagnostic + documentation assistant that works reliably in a real shop workflow.

### Must‑Have (Contract)
- Case-based chat UX (sidebar, chat, copy button)
- Terms acceptance
- Multi-language input (Auto / EN / RU / ES)
- **Server-enforced modes** (explicit commands only)
  - `START AUTHORIZATION REQUEST`
  - `START FINAL REPORT`
- **English-first output + guaranteed translation block**
- **Procedure-driven diagnostics** (system procedures as code)
  - strict ordering + prerequisites
  - skip steps already completed
  - answer “How do I check that?” safely and succinctly
- **Complex system gating**
  - diagnostic form behavior until isolation is complete
  - no portal-cause/labor before gates satisfied
- Guardrails
  - post-repair fallback to diagnostics
  - mechanical guardrail (no motor replacement when direct power proves motor works)
  - no “approval guarantee” language

### Must‑Have (Platform)
- Authentication (email/password + sessions)
- Case/message persistence (Prisma + Postgres)
- Rate limiting (auth endpoints minimum)
- Basic observability (structured logs; no PII)

### Nice‑to‑Have (if time permits)
- Reset/clear current case
- Small UI polish (spacing, loading/empty states)
- Optional STT (session-only; no storage)
- Optional image attach (session-only; no storage)

---

## Release 2 — Reliability & Retention

**Goal:** Reduce support burden, increase repeat usage.

- Translation repair policy hardening + telemetry for “missing translation” defects
- Procedure coverage expansion (more systems + more edge cases)
- Case retention policy (TTL) + cleanup job
- Search cases + refresh retention metadata on reads
- Internal admin/debug tools (safe: text-only)

---

## Release 3 — Advanced Workflow

**Goal:** Shop-scale operations.

- Role-based access (tech / writer / manager)
- Fleet / shop accounts
- Structured report templates per payer type (warranty/insurance/customer-pay)
- Advanced analytics (privacy-safe)
- Optional exports (PDF/DOCX) **only if** it increases adoption (separate spec)

---

## Parking Lot / Ideas

- Offline-first (local-only) mode
- Technician presets / shop-specific phrasing profiles
- Company branding / white-label

---

## Guiding Rule

If a feature does not **directly help a technician finish a diagnostic faster or produce safer authorization text**, it does not belong in the next release.
