# RV Service Desk
## ROADMAP

**Version:** 1.3  
**Last updated:** 2026-04-06  
**Status:** Active Execution Plan

---

# 0. Guiding Principle (Updated)

This roadmap is **contract-driven**, not feature-driven.

Order of development:
1. Behavioral contracts (PROJECT_MEMORY)
2. Evaluation system (Benchmark)
3. Engine logic (Context Engine)
4. Runtime interaction hardening
5. Safe architecture refactor (route.ts)
6. UI / UX improvements

---

# 1. Current Phase — P0 Stabilization (IN PROGRESS)

## Goals
- Eliminate critical diagnostic logic failures
- Establish deterministic system behavior
- Prevent regression via benchmark
- Remove technician-facing robotic friction that violates the product contract

---

## 1.1 Benchmark / Evaluation System (CRITICAL)

### Purpose
Create a **project-specific SWE-style benchmark** for RV diagnostics.

### Why
Public benchmarks do NOT reflect:
- diagnostic flow correctness
- step discipline
- authorization safety
- report readiness behavior
- natural report-intent behavior
- dirty-input robustness
- current-step guidance realism

---

### Benchmark Structure

#### Level 1 — Step Discipline
- One question at a time
- No step skipping
- No duplication
- Proper ordering

#### Level 2 — Procedure + Signal Logic
- Correct branch selection
- Signal Override behavior
- No signal ignoring
- Branch priority correctness

#### Level 3 — State Management
- Correct step completion tracking
- No post-completion questioning
- Correct terminal state behavior
- Correct return after guidance / clarification

#### Level 4 — Report Readiness & Transition
- Detect report-ready situations
- Suggest or support correct next action
- No illegal uncontrolled auto-transition
- Natural report-intent alias handling works correctly

#### Level 5 — Technician Interaction Realism
- Locate/identify questions answered usefully
- Current-step guidance is not robotic repetition
- Dirty-input cases do not collapse classification
- System does not depend on magic phrases only

---

### Required Assets
- 20+ real-world cases (seed set)
- Failure taxonomy
- Pass/Fail rules
- Regression suite
- Dirty-input cases
- Natural report-intent cases
- Locate-guidance cases

---

### Definition of Done
- Benchmark runs locally
- All P0 bugs represented as test cases
- New bugs MUST be added to benchmark

---

## 1.2 Context Engine Enhancement (Signal-Aware) (CRITICAL)

### Problem
Current engine is:
- step-driven
- but NOT fully signal-aware / terminal-aware in all runtime paths

This leads to:
- ignoring obvious faults
- incorrect branching
- checklist-following behavior
- weak report-ready handling in some cases

---

### Required Enhancements

#### 1. Signal Layer
Introduce explicit diagnostic signals:
- NO_12V
- NO_120VAC
- NO_IGNITION
- OPEN_CIRCUIT
- etc.

Each signal must have:
- severity (info / warning / critical)
- source step
- causal domain (electrical / gas / mechanical)

---

#### 2. Signal Override
- Critical signals override linear flow
- System enters sub-diagnostic branch
- Returns to main flow after resolution

---

#### 3. Branch Priority
- Next step chosen by causal relevance
- NOT by flat sequence order

---

#### 4. Report-Ready Detection
Engine must detect:
- fault localized
- repair completed
- technician summary provided
- report-intent request present

But:
- must NOT perform uncontrolled transition

---

#### 5. Terminal State Logic
Explicit handling of:
- when to stop diagnostics
- when questioning becomes invalid
- when report flow should be preferred

---

### Definition of Done
- Engine produces signal-aware next step
- No signal-ignore failures in benchmark
- Terminal state respected in all cases
- Report-ready cases no longer fall back into useless diagnostics

---

## 1.3 Runtime Interaction Hardening (NEW — CRITICAL)

### Problem
Current technician-facing runtime still shows three major defects:
- natural report intent is too dependent on exact commands,
- step guidance answers can be robotic and non-locational,
- dirty real-world input can break classification.

These are not just UX polish issues.
They are product-contract issues because they make the tool feel less useful than a human coworker.

---

### Required Workstreams

#### 1. Natural Report-Intent Handling
Support bounded aliases such as:
- write report
- generate report
- напиши отчет
- сделай warranty report

Hard rule:
- no uncontrolled semantic switching,
- gates still apply,
- server remains authority.

#### 2. Step Guidance Expansion
Current-step support must answer:
- how to perform the check,
- where to find the part,
- how to identify it,
- what result to look for,
- acceptable alternate check points.

Hard rule:
- support does not equal progress.

#### 3. Dirty-Input Normalization
Before classification:
- normalize typo-heavy / mixed-language / keyboard-corrupted input,
- split complaint / findings / action / report intent when possible,
- do not invent facts.

#### 4. Collaborative Diagnostic Expression
The assistant should be allowed to sound like a concise senior technician:
- “Давай…”
- “Похоже…”
- “Сначала я бы проверил…”

Hard rule:
- expression becomes more natural,
- authority does not move from runtime to prompt.

---

### Definition of Done
- no magic-phrase-only dependence in approved report-ready cases
- locate questions no longer get repeated measurement-only answers
- dirty-input benchmark cases classify correctly
- technician-facing tone is bounded, concise, and non-robotic

---

## 1.4 Safe route.ts Decomposition (HIGH PRIORITY)

### Problem
`route.ts` currently acts as:
- transport layer
- orchestration layer
- hidden application layer

This creates:
- high complexity
- low maintainability
- high regression risk

---

### Target Architecture

#### route.ts (boundary only)
Must remain:
- HTTP handler
- SSE streaming
- request/response lifecycle

---

### Must NOT contain
- diagnostic logic
- step selection
- branch decisions
- uncontrolled mode inference
- completion logic

---

### Decomposition Strategy (SAFE)

#### Step 1
Extract:
- request preparation
- language handling
- input normalization

#### Step 2
Extract:
- diagnostic flow orchestration support

#### Step 3
Extract:
- final report / labor override flow
- approved transition handling

#### Step 4
Extract:
- validation + retry pipeline

---

### Critical Rule
> Context Engine remains the ONLY flow authority

No dual logic allowed in:
- route
- helpers
- prompt

---

### Definition of Done
- route.ts < 300–400 lines
- no hidden flow logic outside Context Engine
- behavior unchanged or intentionally improved only with benchmark coverage

---

## 1.5 Structure-Preserving Tests (CRITICAL)

### Problem
Refactoring can silently break architecture.

---

### Required Test Types

#### 1. Route Wiring Tests
- correct flow invocation
- no duplicate paths
- SSE lifecycle intact

#### 2. No-Hidden-Authority Tests
- ensure only Context Engine decides flow
- detect logic leakage into helpers

#### 3. Module Unit Tests
- extracted services tested independently

#### 4. Regression Tests
Must cover:
- signal ignored
- wrong branch
- duplicate step
- post-terminal questioning
- illegal report behavior
- natural report-intent failure
- dirty-input misclassification
- locate-guidance robotic failure

---

### Definition of Done
- tests fail if flow authority is violated
- tests fail if branching logic moves outside engine
- tests fail if technician-realistic interaction regresses

---

# 2. P1 — Architecture Hardening

## Goals
- stabilize system structure
- prepare for scale
- ensure maintainability

---

### 2.1 Context Engine as Single Authority
- remove any fallback decision logic from route
- remove prompt-driven flow decisions
- enforce engine-driven behavior

---

### 2.2 Deterministic Validation Layer
- strengthen validators
- remove reliance on model correctness
- enforce output contracts

---

### 2.3 Benchmark Integration into CI
- benchmark must run on PR
- failing benchmark = blocked merge

---

## 2.4 Mobile-First UI Redesign (HIGH PRIORITY)

### Problem
Current UI:
- does not fit properly on mobile screens,
- requires horizontal scrolling,
- breaks technician workflow,
- increases cognitive load during diagnostics.

This is a critical adoption blocker because:
- technicians primarily use mobile devices in real environments,
- interaction must be fast, clear, and one-handed when possible.

---

### Target Principle
> Mobile is the primary platform. Web is secondary.

---

### Required Changes

#### 1. Single-Goal Screen Design
- One screen = one action
- No horizontal scrolling
- Large touch targets
- High contrast
- XL readable text

#### 2. Multi-Screen Flow (Possible Redesign)
Instead of one dense screen, split into:

- Screen 1: Case / context
- Screen 2: Current diagnostic step
- Screen 3: Input (answer / voice / quick buttons)
- Screen 4: Report / output

#### 3. Diagnostic Step Focus Mode
- highlight ONLY current question
- hide previous noise by default
- allow optional expand for history

#### 4. Quick Input Optimization
- Yes / No buttons
- predefined answers where possible
- voice input support (future)

#### 5. Report View Optimization
- easy copy
- clear sections
- mobile-friendly formatting
- no horizontal overflow

#### 6. Web Alignment
Web version:
- must remain consistent with mobile logic
- may use wider layout
- but must not introduce different behavior

---

### Definition of Done
- No horizontal scrolling on mobile
- Full workflow usable with one hand
- Step completion time reduced
- No confusion about “what to do next”

---

# 3. P2 — Product Expansion

## Goals
- improve usability
- increase conversion

---

### 3.1 UX Improvements
- better mobile flow
- faster input
- clearer prompts
- faster report generation from realistic technician phrasing

---

### 3.2 Monetization
- Free → Premium → Pro
- usage limits
- report export improvements

---

# 4. P3 — Integrations (Post-MVP)

## Goals
- connect to real systems

---

### 4.1 Possible Integrations
- warranty portals
- insurance systems
- DMS

---

### 4.2 Risks
- compliance
- liability
- data handling

---

# 5. Execution Rules (CRITICAL)

- No large refactors without benchmark coverage
- No behavior changes without contract updates
- No prompt-only fixes for logic bugs
- No dual flow authority
- Every real bug → benchmark test
- Technician-realistic interaction failures are product bugs, not cosmetic notes

---

# 6. Immediate Next Actions

1. Update contract docs (DONE / IN PROGRESS)
2. Expand benchmark with current real failures
3. Implement natural report-intent handling
4. Implement stronger step-guidance locate/identify behavior
5. Add dirty-input normalization
6. Only then continue major route.ts decomposition

---

End of file.