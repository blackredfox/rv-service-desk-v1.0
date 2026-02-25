# RV Service Desk
## PROJECT_MEMORY-1.md

**Version:** 1.1  
**Status:** Official Project Memory (Product + Technical)  
**Purpose:** Single source of truth to restore project context, architectural decisions, technical boundaries, and non-goals.

**Last updated:** 2026-02-12

---

## 1) Project Definition

**RV Service Desk** is an approval-safe AI assistant for RV service businesses in the United States.

The assistant helps technicians:
- run structured diagnostics (step-by-step when needed),
- document findings consistently,
- generate authorization-ready text for:
  - warranty,
  - insurance,
  - customer-pay repairs.

**Critical positioning:**
- This is **NOT** a chatbot.
- This is **NOT** an autopilot mechanic.
- This is a **diagnostic + documentation engine** designed to reduce claim denials and documentation errors.

The technician **always** makes the final diagnostic conclusion and repair decision.

---

## 2) Core Problem (Why This Exists)

RV technicians are technically competent, but authorization documentation often fails due to:
- conversational wording,
- unsafe “denial-trigger” terms,
- missing diagnostic justification,
- missing labor breakdown,
- inconsistency between different writers/techs.

RV Service Desk standardizes the documentation layer and reduces reliance on “tribal knowledge”.

---

## 3) Non-Goals (Hard Product Boundaries)

Explicitly out of scope for MVP (and must not creep back in):
- No automatic report submission to any portal (manual copy/paste only).
- No integrations with DMS / warranty / insurance systems in MVP.
- No “approval guarantee” language.
- No repair decisions, no definitive root-cause claims without verified isolation.
- No storing images/audio/files (session-only artifacts).
- No liability ownership: the app assists documentation only.

**Important nuance (updated):**
- The product **may** explain *how to perform a check* **only** when that check is part of the approved diagnostic procedure (shop context, pro-tech tone, safe sequencing).
- The product must **not** drift into consumer “DIY coaching”, improvisation, or unapproved steps.

---

## 4) Users & Primary Workflow

### 4.1 Primary user
- RV service technician (shop environment, time-constrained, may dictate notes via voice).

### 4.2 Case-based workflow
- Each repair = one **Case** (a self-contained chat session).
- A case stores **text only**:
  - technician messages,
  - agent messages,
  - final report text (if generated).
- Case title is auto-generated and can be renamed.

---

## 5) Invisible Operating Modes (Enforced)

Modes are **internal** and not shown in UI as “workflow statuses”.

### 5.1 Modes
1. **Diagnostic Mode (default)**
   - Asks one question at a time (when diagnostics are needed).
   - Records facts only.
   - No conclusions/recommendations.
   - Dialogue stays in technician’s language (EN/RU/ES).

2. **Authorization Mode**
   - Used when technician requests pre-authorization for corrective action or defined isolation work.
   - Warranty-safe language enforcement is active.
   - Conservative wording, no guarantees.

3. **Final Report Mode**
   - Produces the final shop-style report format (fixed sections).
   - Output is English-first + translated copy.

### 5.2 Mode transitions (Hard Rule)
Mode changes are **explicit only** and must never be inferred from meaning.
- Server switches mode only on explicit allow-listed commands (exact/near-exact match after case/whitespace normalization only).

**Final Report aliases:**
- `START FINAL REPORT`
- `FINAL REPORT`
- `GENERATE FINAL REPORT`
- `REPORT`
- `GIVE ME THE REPORT`
- RU: `ВЫДАЙ РЕПОРТ`, `РЕПОРТ`, `ФИНАЛЬНЫЙ РЕПОРТ`, `СДЕЛАЙ РЕПОРТ`
- ES: `REPORTE FINAL`, `GENERAR REPORTE`, `REPORTE`

**Authorization aliases:**
- `START AUTHORIZATION REQUEST`
- `AUTHORIZATION REQUEST`
- `REQUEST AUTHORIZATION`
- `PRE-AUTHORIZATION`
- RU: `ЗАПРОС АВТОРИЗАЦИИ`, `АВТОРИЗАЦИЯ`, `ПРЕАВТОРИЗАЦИЯ`
- ES: `SOLICITAR AUTORIZACIÓN`, `AUTORIZACIÓN`, `PREAUTORIZACIÓN`

This rule exists to prevent web-agent drift and “helpful assistant” shortcuts.

---

## 6) Language Rules (Hard Contract)

- Diagnostic dialogue: **technician language** (EN/RU/ES).
- Final output text (Cause / Report): **100% English first**.
- Immediately after English output: `--- TRANSLATION ---` + full literal translation into dialogue language.
- Never mix languages inside the English block.

**Reliability rule (updated):**
- Translation must not be left to “model luck”.️
- Server must validate presence/format of the translation block and apply a retry/repair strategy if missing.

---

## 7) Output Formats (Fixed)

### 7.1 Final Report (Shop-style, copy/paste-ready)
Plain text, no numbering, no tables.

Sections (exact order):
- Complaint
- Diagnostic Procedure
- Verified Condition
- Recommended Corrective Action
- Estimated Labor
- Required Parts

### 7.2 Portal-Cause Output (when allowed)
Single English block, no headers, no numbering, paragraphs separated by blank lines, then translation block.

Paragraph order (fixed):
1) Observed symptoms  
2) Diagnostic checks performed  
3) Verified condition or isolation status  
4) Required repair or replacement  
5) Labor justification (ALWAYS LAST)

**Labor requirement:**
- Task-level breakdown
- Each task includes hours
- Total labor stated

---

## 8) Safety / Wording Guardrails

### 8.1 Prohibited words (Service Authorization wording)
The assistant must avoid denial-trigger words in Service Authorization phrasing:
- broken, failed, defective, bad, damaged, worn, misadjusted, leaking

Technician may use them; the assistant **internally normalizes** to neutral technical language without asking the technician to rephrase.

### 8.2 Approved technical language (examples)
- not operating per spec
- performance below spec
- no response under load
- measured values out of spec
- condition not recoverable
- unit-level malfunction

### 8.3 “No assumptions / no invention”
The assistant never invents:
- measurements
- test results
- parts
- model/serial identifiers
- causes not supported by provided isolation

---

## 9) Diagnostic Logic Contract (Customer-Approved)

### 9.1 Complex equipment classification (locked)
Always complex:
- Roof AC / heat pumps
- Furnaces
- Slide-out systems
- Leveling systems
- Inverters / converters
- Refrigerators

Simple items (lights, latches, doors, trim) are NOT complex.

### 9.2 Diagnostic Form Enforcement (critical)
If system is complex AND isolation is incomplete:
- switch into diagnostic form behavior (one question at a time, strict order),
- do NOT generate Cause,
- do NOT suggest repair or replacement,
- do NOT estimate labor.

Form mode continues until at least one is true:
A) specific component/subsystem verified not operating per spec  
B) all primary diagnostic branches ruled out  
C) technician explicitly requests preliminary authorization based on partial isolation

### 9.3 Diagnostic Completeness Gate (critical)
When in Guided Diagnostics or Diagnostic Form behavior:
- MUST NOT generate Portal-Cause unless A/B/C is met.
- If not met: continue diagnostics and state isolation is not complete.

### 9.4 Post-repair guardrail (critical)
If a previously authorized repair did NOT restore operation:
- do NOT generate a new Cause,
- return to diagnostic form behavior,
- confirm post-repair checks before proceeding.

### 9.5 Mechanical system guardrail (critical)
For slide-outs, leveling, and drive systems:
- if motor operates when powered directly → treat motor as functional.
- do NOT recommend motor replacement.
- do NOT conclude mechanical failure.
Mechanical replacement is allowed only after coupling/engagement/synchronization/controller logic is verified or ruled out.

### 9.6 Consumer appliance replacement logic
For TVs / microwaves / stereos:
- if unit powers ON but has no video/audio/OSD and basic checks fail → treat as non-repairable, recommend unit replacement, do not suggest board-level repair.

### 9.7 Authorization rules
- NEVER request authorization for diagnostics.
- Authorization applies ONLY to corrective action or clearly defined isolation work.

### 9.8 Equipment identification rule
- Single short line only
- Only identifiers provided by technician
- No placeholders
- No labels

---

## 10) Procedure-Driven Diagnostics (Pro-Tech Contract) — NEW (v1.1)

**Principle:** *Procedure is law.*

Diagnostics are governed by explicit system procedures with:
- strict step ordering,
- prerequisites (no skipping),
- recognition of steps already completed in the technician’s initial message (skip what’s already done),
- prevention of “cross-system drift” (agent must not invent steps outside the active procedure).

**Operational requirement (updated):**
- If the technician asks “How do I check that?”, the agent must provide a short, safe, procedure-aligned instruction sequence.
- The agent must never “close the step silently” (that creates absurd diagnostics and breaks customer trust).

**Known procedure defects to eliminate (if observed):**
- duplicated steps (either procedure definition bug or runtime “completed” tracking bug),
- wrong ordering (e.g., electrical pre-checks like fuse/CB should be first when required by the procedure).

---

## 11) Prompt Architecture & Version Truth

### 11.1 Customer prompt (source of truth)
Customer-approved behavior originates from:
- “RV SERVICE DESK — Diagnostic & Authorization Engine (v2.3.7) PORTAL-CAUSE MODE WITH MECHANICAL, POST-REPAIR, COMPLETENESS AND DIAGNOSTIC FORM ENFORCEMENT”.

### 11.2 System prompt (production)
Production system prompt is a structured normalization of the customer prompt:
- **System Prompt v3.1 (PRODUCTION)** is the intended “single source of truth” for runtime orchestration.

### 11.3 Important note on web-agent behavior
A web-agent may:
- truncate/alter system instructions,
- inject its own system prompt,
- ignore strict MUST/MUST NOT,
- behave statelessly.

Therefore:
- the authoritative behavior must be enforced **server-side** with explicit mode state and validation.

---

## 12) Technical Architecture (MVP)

### 12.1 Stack (MVP)
- **Frontend:** Next.js / React (PWA-ready)
- **Backend:** Node.js (REST API)
- **AI Layer:** LLM called from server with strict prompt orchestration
- **Storage:** text-only (local-first by default; optional backend persistence)

### 12.2 Data boundaries & privacy
- Store only: text messages + final outputs.
- Do not store: images/audio/files (session-only artifacts).
- Avoid PII in logs.
- Rate limiting recommended (IP-based in MVP).

### 12.3 API contract (high level)
Core endpoint:
- `POST /api/chat`
  - appends technician message,
  - runs AI orchestration,
  - returns agent response + current mode.

Mode transitions:
- only via explicit commands in technician content.
- server must never infer transitions from meaning.

---

## 13) Data Model & Persistence Updates — NEW (v1.1)

To harden language behavior and reduce ambiguity across messages:

- **Prisma schema fields added:**
  - `Case.inputLanguage`
  - `Case.languageSource` (default `AUTO`)
  - `Message.language`

**Migration note:**
- If production uses Neon/Postgres, deploy migrations during release (`prisma migrate deploy` or your chosen process).

---

## 14) Testing Strategy & CI Rules — UPDATED (v1.1)

**Rule:** Unit/component tests must be deterministic and must not require a live DB.

- Vitest defaults to **memory-mode**.
- DB env (`DATABASE_URL`, `DIRECT_URL`) is stubbed empty in test setup so Prisma is not selected.
- DB-backed integration tests are **opt-in** via `TEST_DATABASE_URL` (separate job later).

**Why:** prevents flakes from Neon/network/schema drift and keeps PR gating fast and reliable.

---

## 15) Case Retention (TTL) & Cleanup — UPDATED (v1.1)

Retention metadata must be **fresh** on reads:
- `listCases`
- `getCase`
- `searchCases`

This ensures UI (e.g., sidebar expiry badge) is correct and avoids “missing retention” edge-cases.

A scheduled job may run retention cleanup (cron workflow). CI should be robust to Yarn version differences (Corepack/Berry vs Classic), but **must still fail** if `yarn.lock` truly diverges from `package.json`.

---

## 16) Quality Gates (Must-have)

### 16.1 Determinism & validation
Server-side validation must catch and prevent:
- language rule violations (English-first + translation block),
- generating Cause before gates are satisfied,
- adding forbidden “guarantee” language,
- output format deviations (headers/numbering/tables),
- procedure violations (skipped prerequisites, step repetition, out-of-order branching).

### 16.2 Testing expectations (minimum)
- Unit tests: mode transitions, validators, procedure engine, language gating.
- Integration tests: `/api/chat` end-to-end for:
  - complex equipment diagnostic form behavior,
  - completeness gate,
  - post-repair guardrail,
  - mechanical guardrail cases,
  - final output formatting.

---

## 17) Known Risks

- Web-agent prompt non-compliance (system layer not respected).
- Stateless execution causing “mode forgetting”.
- Model differences (temperature/context window) causing drift.
- Liability risk if unsafe language slips through.
- Procedure definition drift (dup steps / missing “how to check” guidance) causing customer-visible failures.

Mitigation:
- enforce mode and gates server-side,
- add validators + retry policy (especially translation),
- keep prompts minimal and modular at runtime (compose from approved blocks),
- log and audit outputs (text-only, no PII),
- treat procedures as code: versioned, reviewed, test-covered.

---

## 18) Roadmap Pointer

See `ROADMAP.md` for phased delivery:
- v0.1 Diagnostic UI + case sessions
- v0.2 Authorization Mode
- v0.3 Final Report Mode
- v0.4 Voice + media inputs (session-only)
- v1.0 PWA + polish

Billing, orgs, integrations are post-v1.0 and require separate specs.

---

## 19) Change Control

- Prompt wording changes require explicit approval.
- Procedure changes are treated as product contract changes (review + tests).
- System prompt is treated as a product contract.
- Any deviation in behavior is a P1 defect (authorization safety issue).

End of file.
