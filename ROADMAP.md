# RV Service Desk — Product Roadmap

This roadmap reflects the **agreed MVP scope** and prioritizes:
- speed to first customer,
- minimal operational cost,
- legal and technical safety.

---

## State of MVP (Current Capabilities)

- Chat UI with SSE streaming and client-abort handling
- Cases: create / list / delete (rename planned)
- Search (case title + message text)
- Terms gate + versioning via TERMS_VERSION + localStorage acceptance
- Copy buttons on assistant messages: plain + system format
- Tests: Vitest

---

## Phase 0 — Foundation (Planning & Setup)

**Goal:** Lock product behavior and technical base.

- [x] Finalize system prompt & policy rules
- [x] Confirm legal Terms & Privacy (v1.0)
- [x] Create repository structure
- [x] Configure environment variables and secrets
- [ ] Postgres schema + migrations (deferred to Phase 2; MVP runs without DB)

**Outcome:** Stable foundation, no feature drift.

---

## Phase 1 — Core Chat MVP

**Goal:** Functional ChatGPT-like experience.

- [x] Chat UI with streaming responses (SSE)
- [x] SSE client-abort handling (stop upstream request on disconnect)
- [x] Left sidebar with case list
- [x] Create / delete cases (rename deferred)
- [x] Search cases (title + message text)
- [x] Light / Dark mode toggle
- [x] Terms & Privacy acceptance gate + versioning (TERMS_VERSION)
- [x] Persistent Terms/Privacy links + read-only modal
- [x] Copy buttons for assistant responses (plain + system)
- [x] Minimal tests (Vitest)
- [ ] Cloud text history sync (explicitly deferred)

**Outcome:** Technicians can create and revisit multiple cases.

---

## Phase 2 — Agent Intelligence

**Goal:** Deliver real diagnostic value.

- [ ] Mode auto-detection (authorization vs customer-pay)
- [ ] Guided diagnostics flow
- [ ] Report-from-findings flow
- [ ] Policy enforcement (no forbidden wording)
- [ ] Structured report rendering
- [ ] Copy full report / copy by section

**Outcome:** Authorization-ready output with minimal rework.

---

## Phase 3 — Field Usability

**Goal:** Reduce friction for real-world technicians.

- [ ] Voice input (speech-to-text)
- [ ] Session-only image upload (no storage)
- [ ] Session-only file upload (no storage)
- [ ] Auto-generated case titles
- [ ] Manual case title editing

**Outcome:** Usable in shop and field environments.

---

## Phase 4 — Cost & Safety Controls

**Goal:** Protect margins and prevent abuse.

- [ ] Rate limiting per user
- [ ] Token usage tracking
- [ ] Retention policy enforcement
- [ ] Auto-cleanup of old cases
- [ ] Error monitoring & alerts

**Outcome:** Predictable cost-to-serve.

---

## Phase 5 — First Customer Readiness

**Goal:** Ship to first paying client.

- [ ] UX polish
- [ ] Performance optimization
- [ ] Dealer onboarding checklist
- [ ] Basic pricing plans
- [ ] Support & feedback loop

**Outcome:** Sellable MVP.

---

## Future (Post-MVP, Not Committed)

- Team / organization accounts
- Cloud history sync by plan
- API / embedded agent
- Advanced analytics
- Insurance-specific templates
- Enterprise audit logs

---

## Guiding Rule

> **If a feature increases complexity without directly reducing claim denials or technician time — it does not belong in MVP.**
