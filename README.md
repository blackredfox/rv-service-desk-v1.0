# RV Service Desk

## AI Diagnostic & Authorization Assistant for RV Technicians

RV Service Desk is an AI-powered assistant designed to help RV technicians perform structured diagnostics and generate approval-safe documentation for warranty, insurance, and customer-pay repairs.

---

# 1. What This Product Is (And Is Not)

## This IS:
- A **diagnostic workflow engine**
- A **documentation standardization tool**
- A **senior-tech assistant** that enforces procedure discipline

## This is NOT:
- A generic chatbot
- An autopilot mechanic
- A system that makes repair decisions instead of the technician

> The technician is always the decision-maker.  
> The system enforces structure, logic, and documentation quality.

---

# 2. Core Product Behavior (Updated)

## 2.1 Procedure-Driven, Not Chat-Driven

The system does NOT behave like a free-form conversation.

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
- not inferred or guessed.

---

## 2.5 Terminal Behavior

The system knows when to stop diagnostics.

Once:
- the fault is localized, OR
- all required branches are exhausted,

the assistant must:
- stop routine questioning,
- move toward next valid action.

> Continuing unnecessary questions after completion is a system error.

---

## 2.6 Report Suggestion (No Auto-Switch)

The system can recognize when:
- diagnostics are complete,
- repair is done,
- report can be generated.

But:

> The system NEVER switches modes automatically.

Instead, it:
- suggests next action,
- provides explicit command instructions:
  - `START AUTHORIZATION REQUEST`
  - `START FINAL REPORT`

---

## 2.7 Assistant as Pro-Tech Support (Bounded)

The assistant can help the technician with:

- how to perform a diagnostic check,
- where a component is located,
- what result to expect,
- clarification of current step.

BUT ONLY:
- within the active procedure,
- within the current step or branch.

---

### Hard boundaries
The assistant must NOT:
- invent new steps,
- provide off-procedure guidance,
- act as a DIY tutorial system,
- drift into generic advice.

After any explanation:
> The assistant MUST return to the diagnostic flow.

---

## 2.8 Mode System (Invisible to User)

The system operates internally in modes:

- Diagnostic Mode
- Authorization Mode
- Final Report Mode

Mode transitions:
- only via explicit commands
- never inferred from conversation meaning

---

## 2.9 Language Behavior

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

---

## 3.2 Authorization Text
- Approval-safe wording
- Conservative technical phrasing
- No guarantee language

---

## 3.3 Final Report
Structured output:
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
- No automatic mode transitions

---

# 5. Architecture Overview (High-Level)

The system is built around:

### Context Engine (Core)
- controls diagnostic flow
- determines next step
- tracks state
- enforces procedure

### Validation Layer
- enforces output format
- enforces language rules
- prevents unsafe behavior

### Route Layer (API)
- handles transport
- does NOT control diagnostic logic

> There must be a single flow authority (Context Engine).

---

# 6. Mobile-First Reality (Important)

The product is designed primarily for:
> technicians working in real environments on mobile devices.

Implications:
- fast interaction
- minimal friction
- clear next action
- no UI complexity

Future UI direction:
- step-focused screens
- minimal text overload
- large touch targets

---

# 7. Why This Matters

Most AI tools fail in this space because they:
- behave like chatbots,
- skip structure,
- produce inconsistent documentation.

RV Service Desk is different:

> It enforces **structure, causality, and approval-safe communication**.

---

# 8. Development Philosophy

- Contracts over prompts
- Determinism over “AI intuition”
- Validation over trust
- Benchmark over assumptions

---

# 9. Current Focus

- stabilize diagnostic logic
- introduce benchmark system
- enhance context engine (signal-aware)
- safely decompose route layer
- improve mobile usability

---

End of file