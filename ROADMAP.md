# RV Service Desk — Product Roadmap

This roadmap reflects the **agreed MVP scope** and prioritizes:
- speed to first customer,
- minimal operational cost,
- legal and technical safety.

---

## Phase 0 — Foundation (Planning & Setup)

**Goal:** Lock product behavior and technical base.

- [ ] Finalize system prompt & policy rules
- [ ] Define banned / risky language filters
- [ ] Define authorization-safe report templates
- [ ] Confirm legal Terms & Privacy (v1.0)
- [ ] Create repository structure
- [ ] Configure environment variables and secrets
- [ ] Set up Postgres schema (cases, messages, terms_acceptance)

**Outcome:** Stable foundation, no feature drift.

---

## Phase 1 — Core Chat MVP

**Goal:** Functional ChatGPT-like experience.

- [ ] Chat UI with streaming responses (SSE)
- [ ] Left sidebar with case list
- [ ] Create / rename / delete cases
- [ ] Search cases (title + message text)
- [ ] Light / Dark mode toggle
- [ ] Local history support
- [ ] Cloud text history (basic, optional)
- [ ] Terms & Privacy acceptance gate

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
