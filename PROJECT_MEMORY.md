# RV Service Desk
## PROJECT_MEMORY-1.md

**Version:** 1.2  
**Status:** Official Project Memory (Product + Technical)  
**Purpose:** Single source of truth to restore project context, architectural decisions, technical boundaries, and non-goals.

**Last updated:** 2026-03-18

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
- The product may also help the technician *locate* the relevant part or explain *what result to observe* **only within the active approved procedure**.
- The product must **not** drift into consumer “DIY coaching”, improvisation, generic homeowner advice, or unapproved steps.

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
- Server switches mode only on exact technician commands:
  - `START AUTHORIZATION REQUEST`
  - `START FINAL REPORT`

This rule exists to prevent web-agent drift and “helpful assistant” shortcuts.

### 5.3 Report suggestion vs mode transition (critical distinction)
The system **may recognize** that the workflow is report-ready or authorization-ready, but it must **not** auto-switch modes.
- Allowed:
  - suggest the next explicit command,
  - state that diagnostics appear complete,
  - state that final report generation is available,
  - state that authorization-ready text can be generated.
- Not allowed:
  - implicit switch to `authorization`,
  - implicit switch to `final_report`,
  - semantic mode inference from meaning alone.

---

## 6) Language Rules (Hard Contract)

- Diagnostic dialogue: **technician language** (EN/RU/ES).
- Final output text (Cause / Report): **100% English first**.
- Immediately after English output: `--- TRANSLATION ---` + full literal translation into dialogue language.
- Never mix languages inside the English block.

**Reliability rule (updated):**
- Translation must not be left to “model luck”.
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
- broken
- failed
- defective
- bad
- damaged
- worn
- misadjusted
- leaking

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
- if unit powers ON but has no video/audio/OSD and basic checks fail → treat as non-repairable,
- recommend unit replacement,
- do not suggest board-level repair.

### 9.7 Authorization rules
- NEVER request authorization for diagnostics.
- Authorization applies ONLY to corrective action or clearly defined isolation work.

### 9.8 Equipment identification rule
- Single short line only
- Only identifiers provided by technician
- No placeholders
- No labels

### 9.9 Signal Override Rule (critical)
If the technician response reveals a **critical negative diagnostic signal**, the system must temporarily suspend linear progression through the main procedure and enter a focused sub-diagnostic branch to determine the cause of that signal before resuming broader procedure flow.

Examples of branch-worthy negative signals:
- no 12V where required,
- no 120VAC where required,
- no LP supply / no ignition response,
- blown fuse / tripped breaker / open circuit,
- no continuity where continuity is expected,
- no input power at board or device,
- no response under direct test when that response is expected.

Hard rule:
- the system must not ignore a newly established critical abnormal condition and continue to a less relevant generic checklist question.

### 9.10 Branch Priority Rule (critical)
When multiple valid next questions exist, the system must prioritize the branch that is **most causally relevant** to the most recently established abnormal condition.

This means:
- the active procedure is not a dumb flat checklist,
- the active procedure is an ordered diagnostic tree with prerequisites, abnormal-condition branches, and local priorities.

Hard rule:
- “next by number” is not sufficient if the latest technician answer has already revealed a more urgent or causally prior issue.

### 9.11 Signal Ignoring Prohibition (critical)
The system must not continue asking irrelevant or lower-priority questions after a critical signal has already identified the most urgent unresolved path.

Example failure:
- asks “Is the gas valve open?” after the technician has already established “there is no 12V supply,” when electrical source-path diagnosis is the immediate priority.

This is treated as a **contract breach**, not a stylistic defect.

### 9.12 Report Suggestion Rule (critical)
The system may recognize report-ready or authorization-ready situations and must suggest the correct explicit next step, but must not auto-switch modes.

Allowed suggestions include:
- diagnostics appear complete,
- authorization-ready text can be generated,
- final report can be generated,
- use `START AUTHORIZATION REQUEST`,
- use `START FINAL REPORT`.

Not allowed:
- silent transition into authorization mode,
- silent transition into final report mode,
- semantic mode switching because the system “thinks it is time.”

### 9.13 Report-ready situations (recognized states)
The system must recognize at least the following report-ready situations:

**A. Fault localized, repair not yet completed**
- verified condition identified,
- corrective action known,
- parts, approval, or scheduling still needed.

Expected behavior:
- suggest authorization/report next step,
- do not continue irrelevant diagnostics.

**B. Fault localized and repair completed**
- verified condition identified,
- technician already repaired/replaced/adjusted,
- labor and/or parts are available.

Expected behavior:
- suggest final report generation.

**C. Technician provides completed repair summary**
- technician already states:
  - complaint,
  - findings,
  - repair action,
  - labor and/or parts,
- and asks for report help.

Expected behavior:
- be ready to generate final report upon explicit command,
- or instruct the technician to use the exact explicit command if required by mode rules.

### 9.14 Procedure Support / Mentor behavior (allowed but bounded)
Within the active approved procedure, the assistant may:
- explain how to perform the current check,
- explain where to locate the relevant component,
- explain what result to look for,
- answer short clarification questions,
- then return to the active step without losing procedure discipline.

Hard boundaries:
- no off-procedure coaching,
- no speculative repair strategy,
- no consumer DIY drift,
- no silent closure of the active step,
- clarification must return to the main diagnostic path.

---

## 10) Procedure-Driven Diagnostics (Pro-Tech Contract)

**Principle:** *Procedure is law.*

Diagnostics are governed by explicit system procedures with:
- strict step ordering,
- prerequisites (no skipping),
- recognition of steps already completed in the technician’s initial message (skip what’s already done),
- prevention of “cross-system drift” (agent must not invent steps outside the active procedure).

### 10.1 Procedure model refinement (v1.2)
A procedure is not only a linear sequence.
A valid procedure may contain:
- mainline ordered steps,
- prerequisite gates,
- abnormal-signal sub-branches,
- clarification/support submode,
- return-to-main behavior,
- terminal outcomes.

Therefore:
- “procedure-following” means following the approved diagnostic graph,
- not blindly reading a flat checklist top to bottom.

### 10.2 Operational requirement (updated)
- If the technician asks “How do I check that?”, the agent must provide a short, safe, procedure-aligned instruction sequence.
- If the technician asks where a part is located, the agent may provide a short, procedure-aligned location aid.
- The agent must never “close the step silently” (that creates absurd diagnostics and breaks customer trust).
- After clarification/support, the agent must return to the active procedure step or the active signal-driven branch.

### 10.3 Completed Step definition (critical)
A step is considered **completed** only when at least one is true:
- the technician explicitly answered the step’s required question,
- the technician’s earlier message already directly supplied the required fact,
- the step result was directly established by an approved clarification exchange,
- the system has an approved deterministic rule that maps the technician’s answer to step completion.

A step is **not** considered completed merely because:
- the model guessed it,
- the system “probably knows” the answer,
- a nearby fact suggests it indirectly,
- the assistant asked the question but did not receive the required fact.

### 10.4 Terminal State definition (critical)
A diagnostic branch is in **terminal state** when at least one is true:
- verified condition is sufficient for the allowed next business action,
- all primary branches required by the active procedure have been ruled out,
- the technician explicitly requests the allowed next explicit mode transition,
- the workflow is report-ready or authorization-ready and further questioning would be redundant.

Hard rule:
- once in terminal state, the system must not continue routine diagnostic questioning for that branch.

### 10.5 Terminal questioning prohibition
Post-completion questioning is a contract breach when:
- the required isolation threshold is already reached,
- the allowed next action is already known,
- and the system still asks additional routine diagnostic questions that do not protect safety or resolve a remaining gating condition.

### 10.6 Known procedure defects to eliminate (if observed)
- duplicated steps (either procedure definition bug or runtime “completed” tracking bug),
- wrong ordering (e.g. electrical pre-checks like fuse/CB should be first when required by the procedure),
- signal ignoring after a critical abnormal condition,
- failure to return from clarification/support to the active path,
- asking diagnostic questions after terminal state is reached.

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

### 11.4 Prompt role boundary
Prompts may influence wording, tone, and constrained explanation quality, but they must not become the hidden source of:
- step selection,
- mode switching,
- completion inference,
- branch switching,
- terminal-state inference.

Those belong to explicit runtime logic.

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

### 12.4 Flow authority (critical)
The **Context Engine** is the single authority for diagnostic flow decisions.

This includes:
- next-step selection,
- branch switching,
- completion tracking,
- clarification return behavior,
- signal-aware branch semantics,
- terminal-state determination.

### 12.5 Route boundary rule (critical)
`src/app/api/chat/route.ts` is a transport/orchestration boundary, not a second diagnostic brain.

Allowed in route/boundary layer:
- request parsing,
- auth/session loading,
- SSE streaming,
- storage calls,
- prompt assembly,
- model transport,
- validation/retry/fallback orchestration,
- logging/telemetry,
- explicit mode orchestration.

Not allowed in route helpers or extracted boundary modules:
- hidden next-step selection,
- semantic mode inference,
- fallback diagnostic state machine,
- hidden branch logic,
- hidden completion inference.

### 12.6 Safe decomposition principle
Route decomposition is allowed and desirable for maintainability, but only if:
- Context Engine remains the only diagnostic flow authority,
- extracted modules are pure utilities or boundary adapters,
- runtime behavior remains unchanged unless covered by an explicit contract/task,
- decomposition does not create dual state machines.

### 12.7 Signal-aware Context Engine (planned authority refinement)
The Context Engine should evolve to explicitly represent:
- abnormal diagnostic signals,
- branch priority,
- report-ready suggestion state,
- completion and terminal definitions,
- procedure support submode.

This is an architecture refinement, not a prompt-only enhancement.

---

## 13) Data Model & Persistence Updates

To harden language behavior and reduce ambiguity across messages:
- `Case.inputLanguage`
- `Case.languageSource` (default `AUTO`)
- `Message.language`

Recommended future state fields or runtime equivalents:
- active procedure step,
- completed step set,
- clarification/support submode,
- signal/override branch state,
- report-ready state,
- terminal-state marker.

**Migration note:**
- If production uses Neon/Postgres, deploy migrations during release (`prisma migrate deploy` or your chosen process).

---

## 14) Testing Strategy & CI Rules

**Rule:** Unit/component tests must be deterministic and must not require a live DB.

- Vitest defaults to **memory-mode**.
- DB env (`DATABASE_URL`, `DIRECT_URL`) is stubbed empty in test setup so Prisma is not selected.
- DB-backed integration tests are **opt-in** via `TEST_DATABASE_URL` (separate job later).

**Why:** prevents flakes from Neon/network/schema drift and keeps PR gating fast and reliable.

### 14.1 Testing expectations (minimum)
- Unit tests: mode transitions, validators, procedure engine, language gating.
- Integration tests: `/api/chat` end-to-end for:
  - complex equipment diagnostic form behavior,
  - completeness gate,
  - post-repair guardrail,
  - mechanical guardrail cases,
  - final output formatting.

### 14.2 Benchmark requirement (new)
A benchmark/evaluation harness is a required project asset, not an optional nice-to-have.

Benchmark must cover at least:
- single-turn discipline,
- procedure + signal branch logic,
- state/terminal behavior,
- report readiness / suggestion logic,
- formatting / language compliance,
- known failure cases converted into regression cases.

### 14.3 Structure-preserving tests (new)
Because route decomposition and helper extraction can accidentally create dual authority, tests must also verify architecture, not only content.

Required categories:
- route wiring tests,
- no-hidden-authority tests,
- extracted-module unit tests,
- strictness tests proving flow authority remains in Context Engine,
- regression tests for duplicate-step / wrong-order / signal-ignore / post-terminal questioning failures.

### 14.4 Hard validation expectations
Server-side validation must catch and prevent:
- language rule violations (English-first + translation block),
- generating Cause before gates are satisfied,
- adding forbidden “guarantee” language,
- output format deviations (headers/numbering/tables),
- procedure violations (skipped prerequisites, step repetition, out-of-order branching),
- report generation in the wrong mode,
- continuation of routine diagnostics after terminal state when no gating reason remains.

---

## 15) Case Retention (TTL) & Cleanup

Retention metadata must be **fresh** on reads:
- `listCases`
- `getCase`
- `searchCases`

This ensures UI (e.g. sidebar expiry badge) is correct and avoids “missing retention” edge-cases.

A scheduled job may run retention cleanup (cron workflow). CI should be robust to Yarn version differences (Corepack/Berry vs Classic), but **must still fail** if `yarn.lock` truly diverges from `package.json`.

---

## 16) Quality Gates (Must-have)

### 16.1 Determinism & validation
The system must be auditable and deterministic at the business-rule level.
“Model preference” is not enough.

### 16.2 Single-authority rule
There must be only one diagnostic flow authority at runtime.
If flow logic is split across route helpers, prompts, and Context Engine simultaneously, that is a P1 architecture defect.

### 16.3 Contract-first behavior
When a conflict exists between:
- generic model helpfulness,
- linear checklist convenience,
- and explicit product contract,

the explicit product contract wins.

### 16.4 Safe technician UX
The agent should feel like a concise senior technician assistant:
- focused,
- short,
- procedure-aligned,
- not chatty,
- not bureaucratic,
- not “AI-explainy”.

But this UX goal must never weaken contract enforcement.

---

## 17) Known Risks

- Web-agent prompt non-compliance (system layer not respected).
- Stateless execution causing “mode forgetting”.
- Model differences (temperature/context window) causing drift.
- Liability risk if unsafe language slips through.
- Procedure definition drift (dup steps / missing “how to check” guidance) causing customer-visible failures.
- Checklist-following without signal awareness causing obviously illogical questioning.
- Dual-authority drift caused by route decomposition or helper extraction.
- Hidden semantic inference reappearing in prompt or boundary code.
- Report-ready situations being recognized but not surfaced clearly to the technician.

Mitigation:
- enforce mode and gates server-side,
- keep Context Engine as single diagnostic authority,
- add validators + retry policy (especially translation),
- log and audit outputs (text-only, no PII),
- treat procedures as code: versioned, reviewed, test-covered,
- convert each real failure into benchmark coverage,
- enforce structure-preserving tests during decomposition work.

---

## 18) Roadmap Pointer

See `ROADMAP.md` for phased delivery.

Immediate architecture priorities now include:
- benchmark/evaluation harness,
- signal-aware branch semantics,
- procedure support submode,
- report-ready suggestion,
- terminal/completion hardening,
- safe route.ts decomposition with single-authority preservation.

Billing, orgs, integrations are post-v1.0 and require separate specs.

---

## 19) Change Control

- Prompt wording changes require explicit approval.
- Procedure changes are treated as product contract changes (review + tests).
- Context Engine flow-rule changes are treated as product contract changes.
- Signal/branch/terminal/report-readiness changes require benchmark updates.
- System prompt is treated as a product contract.
- Any deviation in behavior is a P1 defect if it affects authorization safety, diagnostic flow authority, or contract enforcement.

End of file.