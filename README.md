# RV Service Desk

**Version:** 1.x\
**Type:** Multi-Tenant B2B SaaS\
**Domain:** RV Service Operations / Warranty Authorization\
**Architecture:** Next.js + Prisma + Postgres + Server-Enforced AI
Orchestration

------------------------------------------------------------------------

# 1. Overview

**RV Service Desk** is an approval-safe, procedure-driven AI diagnostic
and authorization engine for RV service businesses in the United States.

It is **not a chatbot**.\
It is **not a mechanical decision system**.\
It is a **controlled documentation and diagnostic orchestration
platform** designed to:

-   standardize diagnostic workflows,
-   prevent unsafe authorization language,
-   reduce claim denials,
-   enforce documentation completeness,
-   support multi-technician service shops.

The technician always makes the final repair decision.

------------------------------------------------------------------------

# 2. Core Capabilities

## 2.1 Procedure-Driven Diagnostics

-   Each RV system is governed by a structured procedure.
-   Strict ordering and prerequisites are enforced.
-   Steps cannot be skipped unless already completed.
-   If a technician asks *"How do I check that?"*, the assistant
    provides safe, procedure-aligned instructions.
-   No cross-system drift is allowed.

**Principle:** Procedure is law.

------------------------------------------------------------------------

## 2.2 Mode-Based AI Enforcement (Server Controlled)

Modes are internal and cannot change implicitly.

Mode transitions occur **only** via exact commands in technician input:

    START AUTHORIZATION REQUEST
    START FINAL REPORT

Modes:

  Mode            Purpose
  --------------- ---------------------------
  diagnostic      Guided procedure form
  authorization   Pre-approval request text
  final_report    Shop-ready report output

The server validates mode compliance and prevents unsafe transitions.

------------------------------------------------------------------------

## 2.3 Complex System Gating

For major systems (AC, furnace, refrigerator, slide-out, leveling,
inverter, major electrical):

-   No portal cause generation until isolation is complete.
-   No labor estimates before validation.
-   No part replacement before rule-based confirmation.

Additional guardrails:

-   Post-repair fallback to diagnostics if repair fails.
-   Mechanical guardrail (no motor replacement if direct power confirms
    operation).
-   Consumer appliance replacement logic (unit-level only).

------------------------------------------------------------------------

## 2.4 Language Enforcement Contract

Dialogue language: - Auto / EN / RU / ES

Final outputs: 1. **English block first** 2. `--- TRANSLATION ---` 3.
Full translation into technician language

Server validates translation presence and repairs/retries if missing.

Language metadata is persisted per case and per message.

------------------------------------------------------------------------

## 2.5 Multi-Tenant B2B Architecture

The platform supports:

-   Organizations
-   Members
-   Seat limits
-   Stripe subscription billing
-   Seat synchronization via webhook
-   Member invitation & claim flow

Seat enforcement occurs at API layer.

------------------------------------------------------------------------

## 2.6 Retention & Data Boundaries

-   Text-only storage (cases + messages + outputs)
-   Session-only image/audio (never persisted)
-   Case retention policy + cleanup workflow
-   Refresh TTL metadata on read

No PII in logs.

------------------------------------------------------------------------

# 3. System Architecture

## 3.1 Frontend

-   Next.js (App Router)
-   Light/Dark themes
-   Sidebar case management
-   Chat panel
-   Language selector
-   Voice input (STT)
-   Photo attach (session only)
-   Terms gate

------------------------------------------------------------------------

## 3.2 Backend

-   Next.js API routes
-   Prisma ORM
-   PostgreSQL
-   Stripe billing integration
-   Firebase Admin (optional support services)
-   Structured logging

Core libraries:

-   diagnostic-procedures
-   diagnostic-registry
-   mode-validators
-   output-validator
-   retention
-   b2b-stripe

------------------------------------------------------------------------

## 3.3 AI Orchestration Layer

Prompt system is modular:

-   SYSTEM_PROMPT_BASE
-   MODE_PROMPT_DIAGNOSTIC
-   MODE_PROMPT_AUTHORIZATION
-   MODE_PROMPT_FINAL_REPORT

The server composes prompts and validates outputs.

AI cannot bypass:

-   mode gates
-   diagnostic completeness gates
-   language rules
-   output formatting rules

------------------------------------------------------------------------

# 4. API Surface (MVP)

Core endpoint:

POST /api/chat

Supporting endpoints:

-   /api/cases
-   /api/stt/transcribe
-   /api/billing/\*
-   /api/org/\*
-   /api/analytics/event
-   /api/search

Mode transitions are enforced server-side only.

------------------------------------------------------------------------

# 5. Database

Prisma schema with language metadata support and migration tracking.

------------------------------------------------------------------------

# 6. Testing Strategy

## Unit & Component Tests

    yarn test

-   Deterministic test environment
-   Mode validator tests
-   Diagnostic gating tests
-   Stripe webhook tests
-   Seat synchronization tests
-   Translation enforcement tests

------------------------------------------------------------------------

# 7. Environment Setup

### Requirements

-   Node 18+
-   Yarn
-   PostgreSQL

### Install

    yarn install

### Prisma

    npx prisma generate
    npx prisma db push

### Run

    yarn dev

### Test

    yarn test

------------------------------------------------------------------------

# 8. Security & Compliance Boundaries

-   No approval guarantees
-   No repair decisions
-   No stored media
-   No secret exposure to client
-   Rate limiting on sensitive routes
-   Translation validation to prevent output corruption

------------------------------------------------------------------------

# 9. Product Philosophy

-   Determinism over creativity
-   Procedure over conversation
-   Authorization safety over verbosity
-   Explicit state over inference
-   Server enforcement over model trust

------------------------------------------------------------------------

# 10. Project Status

This project operates as:

-   Multi-tenant SaaS
-   Seat-controlled subscription system
-   AI-validated diagnostic engine
-   Test-covered authorization platform
