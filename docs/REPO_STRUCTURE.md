# REPO_STRUCTURE.md

**Project:** RV Service Desk
**Purpose:** Help new developers understand the repository structure quickly.

This document describes the logical structure of the RV Service Desk codebase and the responsibilities of major modules.

---

# 1. Repository Overview

The project follows a **server-orchestrated AI architecture**.

Main components:

* frontend (UI)
* backend API
* diagnostic engine
* AI orchestration
* persistence layer
* platform services

---

# 2. Typical Project Structure

Example repository structure:

```
rv-service-desk/

├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       ├── chat/
│       ├── cases/
│       ├── org/
│       ├── billing/
│       ├── analytics/
│       └── stt/
│
├── components/
│   ├── chat/
│   ├── cases/
│   ├── layout/
│   └── ui/
│
├── lib/
│
│   ├── ai/
│   │   ├── prompt-builder.ts
│   │   ├── output-validator.ts
│   │   └── translation-repair.ts
│
│   ├── diagnostics/
│   │   ├── context-engine.ts
│   │   ├── procedure-registry.ts
│   │   ├── procedure-runner.ts
│   │   └── diagnostic-rules.ts
│
│   ├── modes/
│   │   ├── mode-detector.ts
│   │   ├── mode-validator.ts
│   │   └── transition-rules.ts
│
│   ├── database/
│   │   ├── prisma.ts
│   │   └── repositories/
│   │
│   ├── billing/
│   │   ├── stripe-client.ts
│   │   └── seat-manager.ts
│
│   ├── retention/
│   │   └── case-retention.ts
│
│   └── telemetry/
│       └── logging.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── public/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── docs/
│   ├── PROJECT_MEMORY.md
│   ├── ARCHITECTURE_RULES.md
│   ├── API_SCHEMA.md
│   ├── ROADMAP.md
│   ├── REPO_STRUCTURE.md
│   └── AI_RUNTIME_ARCHITECTURE.md
│
├── package.json
├── tsconfig.json
└── README.md
```

---

# 3. Key Directories

## app/

Next.js App Router.

Contains:

* pages
* API routes
* server endpoints

Important APIs:

```
/api/chat
/api/cases
/api/stt/transcribe
/api/billing
/api/org
/api/analytics
```

---

## components/

React UI components.

Main areas:

* chat interface
* case sidebar
* layout components
* shared UI primitives

---

## lib/

Core application logic.

This directory contains the **backend logic that powers the AI system**.

---

### lib/diagnostics/

Contains the **Context Engine** and diagnostic procedure system.

Responsibilities:

* procedure selection
* step sequencing
* diagnostic branching
* isolation completeness detection

The Context Engine is the **single authority controlling diagnostic flow**.

---

### lib/ai/

AI orchestration utilities.

Responsibilities:

* prompt building
* output validation
* translation verification
* response formatting

---

### lib/modes/

Mode detection and validation.

Modes include:

* diagnostic
* authorization
* final_report

Mode transitions are server-owned. Approved trigger paths are:

* explicit technician commands,
* server-approved natural-language aliases (deterministic, allow-listed),
* server-owned, legality-gated CTA/button controls that resolve to the
  same approved transition class.

LLM wording and client-side heuristics MUST NOT trigger mode transitions
on their own. See `docs/CUSTOMER_BEHAVIOR_SPEC.md` and
`ARCHITECTURE_RULES.md` for the authoritative doctrine.

---

### lib/database/

Database access layer.

Uses:

* Prisma ORM
* PostgreSQL

Stores:

* cases
* messages
* metadata

---

### lib/billing/

Stripe integration.

Handles:

* subscriptions
* seat limits
* webhook synchronization

---

### lib/retention/

Case retention system.

Responsible for:

* TTL tracking
* cleanup jobs
* retention metadata refresh

---

### lib/telemetry/

Application logging and diagnostics.

Logs must avoid PII.

---

# 4. Tests

Active automated tests are located in `/tests`.

Behavior-contract testing doctrine lives in `docs/TEST_STRATEGY_QA_CONTRACT.md`.

Root hygiene rule:

* active automated tests belong under `/tests`
* repository root must not contain ad hoc tests
* repository root must not contain scratch files
* repository root must not contain generated test reports
* historical debug evidence belongs in explicit archive paths, not in root
* if test reports or debug artifacts need to be retained, archive them under `docs/archive/test-reports/` or another explicit archive path rather than placing them in root

Operational rule for reviews and new work:

* if a file is an active automated test, it belongs under `/tests`
* if a file is temporary debugging evidence, it belongs in an explicit archive location or should be removed after use
* root-level test clutter is a repository hygiene defect and should be cleaned before merge

Categories:

```
tests/unit
tests/integration
tests/fixtures
```

Unit tests run in **deterministic memory mode** and do not require a database.

---

# 5. Documentation

Architecture documentation lives in `/docs`.

Important files:

```
PROJECT_MEMORY.md
ARCHITECTURE_RULES.md
API_SCHEMA.md
ROADMAP.md
```

Developers must read **PROJECT_MEMORY.md** before making architectural changes.

---

# 6. Development Workflow

Typical development flow:

```
feature branch
→ local development
→ tests
→ pull request
→ architecture rule review
→ merge
```

Changes affecting diagnostic flow must comply with:

```
ARCHITECTURE_RULES.md
```

---

# 7. Key Architecture Principle

The repository enforces **single-authority diagnostic orchestration**.

```
Context Engine → controls diagnostic flow
LLM → generates language
Server → enforces policy and validation
```

No component may bypass this architecture.
