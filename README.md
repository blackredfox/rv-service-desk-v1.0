# RV Service Desk

## AI Diagnostic & Authorization Assistant for RV Technicians

RV Service Desk is an AI-powered assistant designed to help RV technicians perform structured diagnostics and generate approval-safe documentation for warranty, insurance, and customer-pay repairs.

---

# 1. What This Product Is (And Is Not)

## This IS:
- A **diagnostic workflow engine**
- A **documentation standardization tool**
- A **senior-tech assistant** that enforces procedure discipline
- A **bounded collaborative technician tool** for real shop-floor use

## This is NOT:
- A generic chatbot
- An autopilot mechanic
- A rigid form engine that forces technicians to speak in magic phrases
- A system that makes repair decisions instead of the technician

> The technician is always the decision-maker.  
> The system enforces structure, logic, and documentation quality.

---

# 2. Core Product Behavior (Updated)

## 2.1 Procedure-Driven, Not Chat-Driven

The system does NOT behave like a free-form consumer conversation.

Instead:
> Diagnostics are governed by **explicit procedures**.

However:

### Critical clarification
A procedure is **NOT** a dumb linear checklist.

A valid procedure includes:
- ordered steps,
- prerequisites,
- abnormal-condition branches,
- signal-based overrides,
- return-to-main flow,
- terminal states.

This means:
- the assistant does NOT blindly follow “next step by number”
- the assistant follows **causal diagnostic logic within the procedure**

---

## 2.2 Signal-Aware Diagnostics

The system reacts to technician input as **diagnostic signals**, not just answers.

If a technician reveals a critical condition (example: “no 12V present”):
- the system must prioritize diagnosing that condition,
- even if the original checklist had other next questions.

> The assistant must never ignore a critical abnormal condition.

---

## 2.3 Branch Priority (Causal Logic)

When multiple next steps are possible:

> The system chooses the step that is most causally relevant to the current problem.

Not:
- “next in list”

But:
- “most relevant to the failure just discovered”

---

## 2.4 Step Discipline

The system enforces:
- one question at a time,
- no skipping required steps,
- no duplication,
- correct ordering.

A step is only complete when:
- the required fact is explicitly obtained,
- not inferred or guessed,
- not assumed from a help response.

---

## 2.5 Terminal Behavior

The system knows when to stop diagnostics.

Once:
- the fault is localized, OR
- all required branches are exhausted, OR
- repair is verified and the workflow is report-ready,

the assistant must:
- stop routine questioning,
- move toward the next valid action.

> Continuing unnecessary questions after completion is a system error.

---

## 2.6 Report Suggestion and Natural Report Intent

The system can recognize when:
- diagnostics are complete,
- repair is done,
- report can be generated.

The system may also recognize real technician phrasing such as:
- “write report”
- “generate warranty report”
- “сделай отчет”

But:

> The system NEVER performs uncontrolled auto-transition.

Instead, it:
- uses a server-approved trigger path,
- applies readiness/gating rules,
- and preserves runtime authority.

---

## 2.7 Assistant as Pro-Tech Support (Bounded)

The assistant can help the technician with:

- how to perform a diagnostic check,
- where a component is located,
- how to identify the correct connector / fuse / terminal / switch,
- what result to expect,
- what an expected or unexpected reading means,
- acceptable alternate check points for the current step,
- concise technician-style clarification of the current step.

BUT ONLY:
- within the active procedure,
- within the current step or branch.

---

### Hard boundaries
The assistant must NOT:
- invent new steps,
- provide off-procedure guidance,
- act as a DIY tutorial system,
- drift into generic advice,
- convert support into silent progress.

After any explanation:
> The assistant MUST return to the active diagnostic path.

---

## 2.8 Technician-Realistic Interaction

The product is built for real technicians, not idealized users.

That means the system must handle:
- short input,
- messy input,
- mixed language input,
- copied work-order text,
- typo-heavy field notes,
- complaint + findings + repair summary in one message.

The system should feel like:
- a concise senior-tech partner,
- not a rigid questionnaire,
- not a bureaucratic workflow screen.

---

## 2.9 Mode System (Invisible to User)

The system operates internally in modes:

- Diagnostic Mode
- Authorization Mode
- Final Report Mode

Mode transitions:
- are server-authoritative,
- only through explicit commands or approved natural-language aliases,
- never through uncontrolled semantic guessing.

### Canonical boundary
Diagnostic mode is **server-bounded, not server-scripted**.

That means:
- server/runtime controls legality, step/branch state, truth, and safety,
- the LLM controls concise technician-facing phrasing inside that active legal state,
- runtime metadata such as `System / Classification / Mode / Status / Step` are **not** mandatory spoken output unless the server explicitly chooses a deterministic fallback path.

---

## 2.10 Language Behavior

- Technician speaks in their language (EN/RU/ES)
- Diagnostic dialogue follows technician language
- Final outputs are:
  - English first
  - then full translation

---

# 3. Output Types

## 3.1 Diagnostic Interaction
- One question at a time
- Structured progression
- No conclusions until allowed
- Current-step support allowed without advancement

---

## 3.2 Authorization Text
- Approval-safe wording
- Conservative technical phrasing
- No guarantee language
- Not the same contract as Portal Cause or Shop Final Report

---

## 3.3 Portal Cause
Purpose:
- customer / portal-facing Cause narrative when that specific surface is allowed

Format:
- single English block
- no headers
- no numbering
- blank-line paragraph separation only

---

## 3.4 Shop Final Report
Structured shop-service output:
- Complaint
- Diagnostic Procedure
- Verified Condition
- Recommended Corrective Action
- Estimated Labor
- Required Parts

---

# 4. Safety & Reliability Principles

- No invented facts
- No unsafe wording
- No premature conclusions
- No skipping diagnostic gates
- No uncontrolled mode transitions
- No hidden authority outside the Context Engine

---

# 5. Architecture Overview (High-Level)

The system is built around:

### Context Engine (Core)
- controls diagnostic flow
- determines next step
- tracks state
- enforces procedure
- decides whether a final output surface is legal

### Validation Layer
- enforces output format
- enforces language rules
- prevents unsafe behavior

### Route Layer (API)
- handles transport
- may normalize realistic technician input
- does NOT control diagnostic logic

### LLM layer
- writes the actual diagnostic question or summary naturally
- stays inside the server-selected legal state
- does not decide step flow, legality, or output-surface authority

> There must be a single flow authority (Context Engine).

See `docs/DIAGNOSTIC_MODE_BOUNDARIES.md` for the canonical doctrine and next-PR runtime file map.

---

# 6. Mobile-First Reality (Important)

The product is designed primarily for:
> technicians working in real environments on mobile devices.

Implications:
- fast interaction
- minimal friction
- clear next action
- no UI complexity
- low tolerance for ritual commands and robotic phrasing

Future UI direction:
- step-focused screens
- minimal text overload
- large touch targets

---

# 7. Why This Matters

Most AI tools fail in this space because they:
- behave like chatbots,
- skip structure,
- produce inconsistent documentation,
- or become too rigid to be useful in real work.

RV Service Desk is different:

> It enforces **structure, causality, and approval-safe communication**  
> while still aiming to feel like a bounded senior-tech assistant.

---

# 8. Development Philosophy

- Contracts over prompts
- Determinism over “AI intuition”
- Validation over trust
- Benchmark over assumptions
- Real technician UX over ritual command friction

---

# 9. Current Focus

- stabilize diagnostic logic
- introduce benchmark system
- enhance context engine (signal-aware)
- harden natural report-intent handling
- improve current-step locate/identify guidance
- harden dirty-input robustness
- safely decompose route layer
- improve mobile usability

---

End of file.