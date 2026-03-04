# RV Service Desk

## PROJECT_MEMORY.md

**Version:** 1.3
**Status:** Official Project Memory (Product + Architecture)
**Purpose:** Single source of truth describing the product, system architecture, and non-negotiable technical rules.

**Last updated:** 2026-03-04

---

# 1. Product Definition

**RV Service Desk** is an **approval-safe diagnostic and documentation assistant** for RV service businesses in the United States.

The system helps technicians:

* run **structured diagnostics**
* document findings consistently
* generate **authorization-ready service text**
* reduce warranty and insurance **claim denials**

The system is designed for **shop technicians**, not consumers.

### Critical positioning

RV Service Desk is:

* NOT a chatbot
* NOT an autopilot mechanic
* NOT a repair decision system

It is a **diagnostic + documentation engine**.

The **technician always makes the final diagnostic and repair decision**.

---

# 2. Core Problem

RV repair documentation often fails authorization because of:

* conversational wording
* denial-trigger terminology
* missing diagnostic justification
* missing labor breakdown
* inconsistent documentation across technicians

RV Service Desk standardizes the **documentation layer** and reduces reliance on tribal knowledge.

---

# 3. Hard Product Boundaries (Non-Goals)

The following are **explicitly out of scope** for MVP:

* No automatic submission to warranty or insurance portals
* No integrations with DMS systems
* No guarantee of approval
* No repair decision authority
* No autonomous root cause conclusions without verified isolation
* No storage of images/audio/files (session-only artifacts)

The product assists documentation only.

---

# 4. Primary User

**RV service technician**

Typical environment:

* busy repair shop
* time constrained
* may dictate notes via voice
* needs copy-ready authorization text quickly

---

# 5. Case-Based Workflow

Each repair is a **Case**.

A case stores **text only**:

* technician messages
* assistant responses
* final output text

A case never stores:

* images
* audio
* files

These are session artifacts only.

---

# 6. System Operating Modes

Modes are **internal orchestration states** and are not exposed in UI.

### Modes

1. **Diagnostic Mode** (default)
2. **Authorization Mode**
3. **Final Report Mode**

---

## Mode Contracts

### Diagnostic Mode

Purpose:

* gather facts
* guide procedure steps
* maintain diagnostic discipline

Rules:

* one question at a time
* no conclusions
* no repair recommendations
* no labor estimates

Dialogue language = technician language.

---

### Authorization Mode

Purpose:

Generate authorization-safe wording for corrective work.

Rules:

* conservative language
* no guarantees
* neutral technical phrasing

---

### Final Report Mode

Purpose:

Produce a **shop-style final report**.

Format:

English block first
followed by translation block.

---

## Mode Transition Rule (Hard)

Modes change **only by explicit commands** in technician messages:

```
START AUTHORIZATION REQUEST
START FINAL REPORT
```

The server **must never infer mode changes from meaning**.

---

# 7. Language Contract

Dialogue language:

```
EN / RU / ES
```

Final outputs:

```
English block
--- TRANSLATION ---
Full translation
```

Rules:

* English block must be 100% English
* translation must be full
* server validates translation presence
* server retries if translation missing

Translation reliability must **not depend on LLM luck**.

---

# 8. Output Formats

## Final Report

Plain text.

Required section order:

Complaint
Diagnostic Procedure
Verified Condition
Recommended Corrective Action
Estimated Labor
Required Parts

---

## Portal Cause

Single English block.

Paragraph order:

1. Observed symptoms
2. Diagnostic checks performed
3. Verified condition / isolation status
4. Required repair
5. Labor justification

Labor must include:

* task breakdown
* hours per task
* total labor

---

# 9. Safety and Language Guardrails

The assistant must avoid denial-trigger terms in authorization wording.

Examples to avoid:

* broken
* failed
* defective
* bad
* damaged
* worn
* leaking

The technician may use them.

The system internally converts to neutral language.

---

# 10. Diagnostic Logic Contract

Certain RV systems are **always treated as complex systems**:

* roof AC
* furnaces
* refrigerators
* slide systems
* leveling systems
* inverters / converters

---

## Diagnostic Form Enforcement

If system is complex and isolation is incomplete:

The system must switch to **diagnostic form behavior**.

Rules:

* ask one diagnostic question at a time
* do not generate cause
* do not recommend repair
* do not estimate labor

Diagnostics continue until:

A) a component is verified not operating per spec
B) all diagnostic branches are ruled out
C) technician explicitly requests authorization

---

## Post-Repair Guardrail

If a repair did not restore operation:

* do not generate a new cause
* return to diagnostic mode
* confirm post-repair checks

---

## Mechanical Guardrail

For slide or leveling systems:

If motor runs when powered directly:

* motor is treated as functional
* motor replacement must not be recommended

Mechanical failure can only be concluded after linkage/controller checks.

---

# 11. Procedure-Driven Diagnostics

**Principle:**

```
Procedure is law
```

Diagnostics must follow **explicit system procedures**.

Requirements:

* strict step ordering
* prerequisites enforced
* steps already completed by technician must be recognized
* agent must not invent steps outside procedure

If technician asks:

> "How do I check that?"

The system may provide **short procedure-aligned instructions**.

The system must **never silently close a step**.

---

# 12. Architecture Overview

Frontend:

Next.js / React

Backend:

Node.js API

AI layer:

LLM orchestration from server.

Storage:

text-only persistence.

---

# 13. Architecture Invariant (Critical)

The **Context Engine** is the **single authority for diagnostic flow control**.

It determines:

* current procedure
* next diagnostic step
* branching logic
* re-planning when new evidence appears

No other component may control step progression.

---

## 14. Architecture Rules Reference

The detailed engineering invariants and PR review gates for this project are defined in **`ARCHITECTURE_RULES.md`**.

This document exists to prevent architectural regressions that were previously observed during development (e.g., multiple components attempting to control diagnostic flow).

Key principle:

> **The Context Engine is the single authority for diagnostic step flow.**

Responsibilities are strictly separated:

* **Context Engine** → diagnostic logic, procedures, step sequencing, isolation gates
* **LLM** → language generation and translation only
* **Server** → policy enforcement and output validation

Any changes that introduce additional step controllers, completion parsers, or heuristic flow logic outside the Context Engine violate the architecture and must not be merged.

All pull requests that affect chat orchestration, diagnostic flow, or final outputs must comply with the rules defined in `ARCHITECTURE_RULES.md`.

---

## Prohibited Architecture Patterns

The following must **never control step progression**:

* step inference
* pendingStepId trackers
* completion parsers
* deterministic next-step logic outside Context Engine
* LLM deciding the next procedure step

Violating this invariant leads to:

* step desynchronization
* repeated questions
* chatbot-like behavior

---

# 15. System Responsibility Boundaries

Correct separation of responsibilities:

Context Engine
→ diagnostic logic

LLM
→ language generation

Server
→ policy enforcement and validation

---

# 16. Testing Principles

Tests must be **deterministic**.

Unit tests must not require live database connections.

Vitest default mode:

```
memory mode
```

Database integration tests must be opt-in.

---

# 17. Data Model (MVP)

Cases store:

* technician messages
* assistant messages
* final outputs

No storage of:

* images
* audio
* files

Session artifacts only.

---

# 18. Security & Privacy

System must:

* avoid PII in logs
* protect API keys
* limit request rate
* isolate session artifacts

---

# 19. Development Philosophy

Guiding principles:

Fast > Fancy

Copy-ready output > pretty formatting

Procedure discipline > conversational flexibility

Safe documentation > "helpful guesses"

---

# 20. Current Development Phase

The project is currently in:

```
Architecture Stabilization
```

Primary objective:

Maintain **single-authority diagnostic architecture** while improving reliability.
