ARCHITECTURE_RULES.md

# RV Service Desk
## ARCHITECTURE_RULES.md

**Version:** 1.0  
**Status:** Enforced engineering rules (PR review gate)  
**Last updated:** 2026-03-04

---

# 1) Why this file exists

`API_SCHEMA.md` defines the **external API contract** (endpoints, models, error schema, and mode command rules).  
This document defines **internal architecture invariants** and **non-negotiable engineering rules** that prevent regressions.

If `API_SCHEMA.md` tells us *what the system exposes*, this file tells us *how the system must be built*.

---

# 2) Single-Authority Invariant (Critical)

## Rule A1 — Context Engine is the single authority for diagnostic step flow

**Only the Context Engine** may determine:

- procedure selection
- next diagnostic step
- branching logic
- when isolation is complete
- when diagnostic form must continue
- when a final output is allowed

### Prohibited (never allowed to control step flow)

Any of the following patterns outside the Context Engine are forbidden:

- step inference from text
- `pendingStepId` or equivalent trackers
- completion parsing / `markStepCompleted`
- “deterministic next step” logic in route handlers
- server-driven replanning or subflow state machines
- LLM deciding the next diagnostic step

### Why

Violating A1 creates **dual authority**, which causes:

- repeated steps
- step desync
- post-final loops
- “chatbot-like” behavior

---

# 3) Responsibility Boundaries (Strict Separation)

## Rule B1 — Context Engine = logic

Context Engine owns:

- state model (mode, procedure, step, gates)
- step sequencing and prerequisites
- guardrails (complex gating, post-repair, mechanical rules)
- whether a final output is permitted

## Rule B2 — LLM = text only

LLM is used for:

- generating human-readable wording
- translating final outputs
- formatting within the allowed output contract

LLM must **not** be used to determine:

- what step is next
- whether a step was completed
- whether isolation is complete
- whether we can produce cause/labor

## Rule B3 — Server = policy enforcement + validation only

Server may:

- enforce mode transitions via explicit commands
- validate output format (English-first + translation block)
- enforce gating decisions from Context Engine
- retry/repair missing translation
- log telemetry and timing

Server must **not**:

- override Context Engine’s step decision
- implement a second state machine
- “repair” step logic via heuristics

---

# 4) Mode Control Rules (Implementation Notes)

## Rule M1 — Modes are explicit only

Modes change only when the technician message contains an allow-listed explicit command / alias.

This is defined in `API_SCHEMA.md`. :contentReference[oaicite:1]{index=1}

Server may normalize whitespace/case, but must not infer modes from meaning.

## Rule M2 — Post-final behavior

If the Context Engine has emitted a final output (Portal-Cause or Final Report):

- No further diagnostic questions are allowed.
- Follow-up messages must be handled via **Edit Mode** behavior (text adjustments, labor edits, translation requests, scope updates).

Edit behavior must not re-enter diagnostic sequencing unless the technician explicitly starts a new case.

---

# 5) Output Contract Enforcement

## Rule O1 — English-first + Translation block must be guaranteed

For any final output:

1) English block (100% English)  
2) `--- TRANSLATION ---`  
3) Full translation to dialogue language

Server must validate and retry if missing. (No “model luck”.)

## Rule O2 — No mixed language inside the English block

English block must never include RU/ES phrases.

---

# 6) Complex System Gating (No-Cause-Before-Complete)

## Rule G1 — Complex systems stay in diagnostic form until gates satisfied

For complex systems, if isolation is incomplete:

- diagnostic form behavior only
- no cause
- no repair recommendation
- no labor estimate

Gate satisfaction conditions are Context Engine-owned.

---

# 7) Procedure Discipline

## Rule P1 — Procedure is law

- strict ordering
- prerequisites enforced
- do not invent steps outside procedure

## Rule P2 — “How do I check that?” support

If the requested check is a valid step in the active procedure, the assistant may explain:

- short, safe, pro-tech instructions
- no consumer DIY coaching
- no off-procedure improvisation

---

# 8) PR Review Checklist (Blocking)

Any PR touching chat, orchestration, or procedures must pass:

### Checklist A — Single authority preserved
- [ ] No new step trackers outside Context Engine
- [ ] No completion parsing / “mark done” logic outside Context Engine
- [ ] No server heuristic deciding next step

### Checklist B — Output contract enforced
- [ ] English-first + translation block validated server-side
- [ ] Post-final messages do not trigger new diagnostic questions

### Checklist C — Modes remain explicit-only
- [ ] No meaning-based mode inference
- [ ] Alias matching matches API_SCHEMA allow-list (normalized only)

### Checklist D — Guardrails preserved
- [ ] complex gating stays strict
- [ ] post-repair returns to diagnostics
- [ ] mechanical “direct power test” prevents motor replacement

---

# 9) Testing Requirements (Minimum)

If PR touches orchestration:

- Add/maintain regression tests for:
  - post-final loop prevention
  - translation block enforcement
  - explicit mode transitions
  - complex gating (no-cause-before-complete)

Tests must remain deterministic (no live DB dependency).

---

# 10) Enforcement Note

If a change conflicts with any rule here:

- The change must be redesigned (preferred), or
- Split into a safe subset that preserves the invariants

No exceptions for “it seems smarter”.