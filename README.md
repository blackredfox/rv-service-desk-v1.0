# RV Service Desk

**Version:** 1.x
**Type:** Multi-Tenant B2B SaaS
**Domain:** RV Service Operations / Warranty Authorization

RV Service Desk is a **procedure-driven diagnostic and documentation engine** for RV service businesses in the United States.

It helps technicians produce **authorization-safe documentation** while maintaining disciplined diagnostics.

The system is designed for **real shop workflows**, not conversational AI.

---

# Product Positioning

RV Service Desk is:

* NOT a chatbot
* NOT an autopilot mechanic
* NOT a repair decision system

It is a **controlled diagnostic + documentation platform**.

The technician always makes the **final diagnostic and repair decision**.

The platform focuses on:

* procedure-driven diagnostics
* authorization-safe wording
* documentation completeness
* claim denial reduction
* consistent shop documentation

---

# Key Principles

The platform is built around several strict principles.

**Procedure over conversation**

Diagnostics follow structured procedures.

**Determinism over creativity**

The system prioritizes predictable behavior over flexible responses.

**Server enforcement over model trust**

AI outputs are validated and controlled by server logic.

**Explicit state over inference**

Modes and transitions are explicit and validated.

---

# Core Capabilities

## Procedure-Driven Diagnostics

Each RV system is governed by a structured procedure.

Procedures enforce:

* strict step ordering
* prerequisite validation
* controlled diagnostic flow
* recognition of steps already completed

If a technician asks:

> "How do I check that?"

The system may provide **short, safe instructions aligned with the active procedure**.

Principle:

**Procedure is law.**

---

## Mode-Based AI Enforcement

The system operates in three internal modes.

Modes are **not exposed in the UI** and cannot change implicitly.

Mode transitions occur **only through explicit technician commands**:

```
START AUTHORIZATION REQUEST
START FINAL REPORT
```

Modes:

| Mode          | Purpose                             |
| ------------- | ----------------------------------- |
| diagnostic    | guided diagnostic workflow          |
| authorization | generate authorization request text |
| final_report  | produce final shop-style report     |

The server validates all mode transitions.

---

## Complex System Gating

Major RV systems require full diagnostic isolation before authorization output.

Complex systems include:

* roof AC
* furnaces
* refrigerators
* slide systems
* leveling systems
* inverters / converters
* major electrical systems

Rules:

* no portal cause before isolation
* no labor estimate before validation
* no repair recommendation before rule confirmation

Additional guardrails:

* post-repair fallback to diagnostics
* mechanical protection (motor replacement blocked if direct power proves operation)
* consumer appliance replacement logic

---

## Language Enforcement

Dialogue language:

```
Auto / EN / RU / ES
```

Final outputs follow a strict contract:

```
English output block
--- TRANSLATION ---
Full translation
```

The server validates translation presence and retries if necessary.

Language metadata is stored per:

* case
* message

---

# Architecture Overview

The platform is built as a **server-controlled AI orchestration system**.

## Frontend

Technology:

* Next.js (App Router)
* React
* responsive chat UI

Features:

* case sidebar
* chat interface
* language selector
* voice input (STT)
* session photo attach
* terms acceptance gate
* light / dark theme

---

## Backend

Technology stack:

* Next.js API routes
* Node.js runtime
* Prisma ORM
* PostgreSQL
* Stripe billing
* structured logging

Key backend modules:

* diagnostic-procedures
* diagnostic-registry
* mode-validators
* output-validator
* retention
* billing / seat control

---

# AI Runtime Architecture

The AI system is **not autonomous**.
All AI behavior is orchestrated by the server.

Runtime pipeline:

```
Client
  → API
  → Context Engine
  → Prompt Builder
  → LLM
  → Output Validator
  → Response
```

---

## Context Engine

The Context Engine is the **single authority** controlling diagnostic flow.

It determines:

* procedure selection
* next diagnostic step
* diagnostic branching
* isolation completion
* authorization eligibility

No other system component may determine the next diagnostic step.

---

## LLM Responsibilities

The LLM is used strictly for:

* generating technician-readable language
* translation
* structured output formatting

The LLM does **not** decide:

* diagnostic steps
* isolation completeness
* authorization readiness

---

## Server Responsibilities

The server enforces:

* mode transitions
* output format validation
* translation guarantees
* diagnostic gating
* security boundaries

The server never replaces diagnostic logic with heuristics.

---

# Architecture Rules

The project enforces strict architecture invariants to prevent diagnostic drift.

Diagnostic step flow must remain under **Context Engine control only**.

Detailed engineering rules and PR review gates are defined in:

```
ARCHITECTURE_RULES.md
```

All changes affecting diagnostic flow must comply with these rules.

---

# Multi-Tenant B2B Platform

The system supports service organizations.

Capabilities include:

* organizations
* members
* seat limits
* Stripe subscriptions
* webhook-driven seat synchronization
* member invitations

Seat enforcement occurs at the API layer.

---

# Data Boundaries

Stored data:

* cases
* messages
* final outputs

Not stored:

* images
* audio
* files

Media attachments are **session-only artifacts**.

---

# Case Retention

Cases follow a retention policy.

Retention metadata is refreshed when cases are accessed.

Cleanup jobs remove expired cases.

---

# API Surface

Primary endpoint:

```
POST /api/chat
```

Supporting endpoints:

```
/api/cases
/api/stt/transcribe
/api/billing/*
/api/org/*
/api/search
/api/analytics/event
```

Mode transitions are enforced server-side.

The complete API contract is defined in:

```
API_SCHEMA.md
```

---

# Database

The system uses Prisma with PostgreSQL.

The schema supports:

* case metadata
* language tracking
* message persistence
* migration history

---

# Testing Strategy

Unit and component tests run in deterministic mode.

```
yarn test
```

Tests cover:

* diagnostic gating
* mode validation
* output validation
* Stripe webhooks
* seat synchronization
* translation enforcement

Database connections are disabled during default tests.

---

# Environment Setup

Requirements:

* Node.js 18+
* Yarn
* PostgreSQL

---

## Install

```
yarn install
```

---

## Prisma

```
npx prisma generate
npx prisma db push
```

---

## Run Development Server

```
yarn dev
```

---

## Run Tests

```
yarn test
```

---

# Security & Compliance

The system enforces several safety boundaries:

* no approval guarantees
* no repair decision authority
* no stored media artifacts
* no exposure of secrets to the client
* rate limiting on sensitive endpoints
* server validation of AI outputs

---

# Product Philosophy

RV Service Desk prioritizes **safe documentation over conversational flexibility**.

Guiding rules:

* procedure over conversation
* determinism over creativity
* explicit state over inference
* server enforcement over model trust

---

# Project Status

The platform currently operates as:

* multi-tenant SaaS
* seat-controlled subscription system
* procedure-driven diagnostic engine
* server-orchestrated AI platform
* test-covered authorization workflow
