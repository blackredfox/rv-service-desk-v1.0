# RV Service Desk
## ARCHITECTURE_RULES.md

**Version:** 1.1  
**Status:** Enforced engineering rules (PR review gate)  
**Last updated:** 2026-04-06

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
- when a branch is terminal
- when routine diagnostic questioning must stop

### Prohibited (never allowed to control step flow)

Any of the following patterns outside the Context Engine are forbidden:

- step inference from text
- `pendingStepId` or equivalent trackers
- completion parsing / `markStepCompleted`
- “deterministic next step” logic in route handlers
- server-driven replanning or subflow state machines
- LLM deciding the next diagnostic step
- hidden report-readiness flow logic that contradicts Context Engine truth

### Why

Violating A1 creates **dual authority**, which causes:

- repeated steps
- step desync
- post-final loops
- hidden branch drift
- “chatbot-like” behavior
- brittle fixes that seem helpful but weaken determinism

---

# 3) Responsibility Boundaries (Strict Separation)

## Rule B1 — Context Engine = logic

Context Engine owns:

- state model (mode, procedure, step, gates)
- step sequencing and prerequisites
- guardrails (complex gating, post-repair, mechanical rules)
- whether a final output is permitted
- terminal-state detection
- report-ready and authorization-ready runtime state
- clarification return target
- approved interpretation boundaries for report/readiness triggers

## Rule B2 — LLM = text only

LLM is used for:

- generating human-readable wording
- translating final outputs
- formatting within the allowed output contract
- bounded current-step explanation

LLM must **not** be used to determine:

- what step is next
- whether a step was completed
- whether isolation is complete
- whether we can produce cause/labor
- whether a natural-language request is allowed to activate report flow

## Rule B3 — Server = policy enforcement + validation only

Server may:

- enforce mode transitions via explicit commands and approved aliases
- validate output format (English-first + translation block)
- enforce gating decisions from Context Engine
- retry/repair missing translation
- normalize input safely before routing/classification
- run bounded natural-intent resolution using server-approved rules
- log telemetry and timing

Server must **not**:

- override Context Engine’s step decision
- implement a second diagnostic state machine
- “repair” step logic via heuristics
- allow uncontrolled semantic mode switching from vague meaning

---

# 4) Mode Control Rules (Implementation Notes)

## Rule M1 — Mode authority is explicit and server-owned

Modes are changed only by the server through:
- an allow-listed explicit command, or
- a server-approved natural-language alias mapped to that transition class.

The server may normalize:
- whitespace,
- case,
- punctuation,
- trivial textual variation,
- approved alias phrases.

The server must **not**:
- infer modes from vague meaning,
- guess that “they probably want a report now,”
- switch mode without an approved trigger path.

## Rule M1a — Natural report / authorization aliases are controlled, not open-ended

Approved natural-language triggers may exist for report or authorization flow, such as:
- “write report”
- “generate report”
- “сделай отчет”
- “напиши warranty report”

Hard rule:
- aliases must be explicitly allow-listed or deterministically normalized to an allow-listed trigger class,
- readiness / safety gates must still be satisfied,
- this is **not** free semantic inference.

## Rule M2 — Post-final behavior

If the Context Engine has emitted a final output (Portal-Cause or Final Report):

- No further diagnostic questions are allowed.
- Follow-up messages must be handled via **Edit Mode** behavior (text adjustments, labor edits, translation requests, scope updates).

Edit behavior must not re-enter diagnostic sequencing unless the technician explicitly starts a new case.

---

# 5) Output Contract Enforcement

## Rule O1 — English-first + Translation block must be guaranteed

For any final output:

1) English block  
2) `--- TRANSLATION ---`  
3) Full translation to dialogue language

Server must validate and retry if missing.

## Rule O2 — No mixed language inside the English block

English block must never include RU/ES phrases.

## Rule O3 — Natural report intent does not bypass final-output validation

Even when the technician uses a natural-language report request alias:
- output must still obey the final-report contract,
- gating still applies,
- validation still applies.

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

## Rule P2 — Step guidance support is allowed but bounded

If the requested check is a valid step in the active procedure, the assistant may explain:

- short, safe, pro-tech instructions
- where to locate the relevant component / fuse / connector / switch
- how to identify the relevant test point
- what result to expect
- acceptable alternate check points when the exact labeled point is unclear

Hard boundaries:
- no off-procedure improvisation
- no consumer DIY coaching
- no speculative branching outside the active step / branch
- no hidden progress from explanation

## Rule P3 — Guidance text is not evidence

A step guidance response must never count as:
- step completion,
- isolation evidence,
- branch closure,
- report readiness by itself.

Only actual technician findings or server-approved completion evidence may change state.

---

# 8) Runtime Robustness Rules

## Rule R1 — Dirty-input normalization is allowed only as preprocessing support

Before classification/routing, the server may perform bounded preprocessing for:
- mixed-language input,
- keyboard-layout corruption,
- typo/noise cleanup,
- complaint/findings/action/report-intent segmentation.

This preprocessing must:
- preserve meaning,
- not invent facts,
- not become a hidden diagnostic engine.

## Rule R2 — Real technician intent must be usable without magic phrases

The system must not depend on a single exact incantation such as:
- `START FINAL REPORT`

if:
- a server-approved report alias is used,
- report readiness is established,
- and safety/gating conditions are satisfied.

Exact magic-phrase dependence in these cases is considered a UX/contract defect, not a feature.

---

# 9) PR Review Checklist (Blocking)

Any PR touching chat, orchestration, or procedures must pass:

### Checklist A — Single authority preserved
- [ ] No new step trackers outside Context Engine
- [ ] No completion parsing / “mark done” logic outside Context Engine
- [ ] No server heuristic deciding next step
- [ ] No hidden report-flow authority outside approved runtime layer

### Checklist B — Output contract enforced
- [ ] English-first + translation block validated server-side
- [ ] Post-final messages do not trigger new diagnostic questions
- [ ] Natural report intent does not bypass report validation

### Checklist C — Mode authority remains controlled
- [ ] No uncontrolled meaning-based mode inference
- [ ] Explicit commands or approved aliases only
- [ ] Alias handling is deterministic and bounded

### Checklist D — Guardrails preserved
- [ ] complex gating stays strict
- [ ] post-repair returns to diagnostics when required
- [ ] mechanical “direct power test” prevents motor replacement

### Checklist E — Guidance behavior bounded
- [ ] locate / identify guidance stays within active step/branch
- [ ] guidance does not silently complete the step
- [ ] guidance returns cleanly to the same active step

---

# 10) Testing Requirements (Minimum)

If PR touches orchestration:

- Add/maintain regression tests for:
  - post-final loop prevention
  - translation block enforcement
  - explicit/alias transition handling
  - complex gating (no-cause-before-complete)
  - locate-guidance support without advancement
  - natural report-intent recognition
  - dirty-input robustness on realistic technician input

Tests must remain deterministic.

---

# 11) Enforcement Note

If a change conflicts with any rule here:

- The change must be redesigned (preferred), or
- Split into a safe subset that preserves the invariants

No exceptions for “it seems smarter”.

End of file.