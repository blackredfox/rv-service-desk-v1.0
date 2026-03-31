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

Mode transitions occur only through explicit technician commands.

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

Tests are located in `/tests`.

Behavior-contract testing doctrine lives in `docs/TEST_STRATEGY_QA_CONTRACT.md`.

Root hygiene rule:

* active tests belong under `/tests`
* repo root must not contain scratch/ad hoc test files
* generated test reports must not live in repo root; archive them under `docs/archive/test-reports/` if they need to be kept

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
