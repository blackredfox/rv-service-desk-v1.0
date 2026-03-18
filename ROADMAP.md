# RV Service Desk
## ROADMAP

**Version:** 1.2  
**Last updated:** 2026-03-18  
**Status:** Active Execution Plan

---

# 0. Guiding Principle (Updated)

This roadmap is **contract-driven**, not feature-driven.

Order of development:
1. Behavioral contracts (PROJECT_MEMORY)
2. Evaluation system (Benchmark)
3. Engine logic (Context Engine)
4. Safe architecture refactor (route.ts)
5. UI / UX improvements

---

# 1. Current Phase — P0 Stabilization (IN PROGRESS)

## Goals
- Eliminate critical diagnostic logic failures
- Establish deterministic system behavior
- Prevent regression via benchmark

---

## 1.1 Benchmark / Evaluation System (NEW — CRITICAL)

### Purpose
Create a **project-specific SWE-style benchmark** for RV diagnostics.

### Why
Public benchmarks (SWE-bench, etc.) do NOT reflect:
- diagnostic flow correctness
- step discipline
- authorization safety
- report readiness behavior

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

#### Level 4 — Report Readiness & Transition
- Detect report-ready situations
- Suggest correct next action
- No illegal auto-transition

---

### Required Assets
- 20+ real-world cases (seed set)
- Failure taxonomy
- Pass/Fail rules
- Regression suite

---

### Definition of Done
- Benchmark runs locally
- All P0 bugs represented as test cases
- New bugs MUST be added to benchmark

---

## 1.2 Context Engine Enhancement (Signal-Aware) (NEW — CRITICAL)

### Problem
Current engine is:
- step-driven
- but NOT signal-aware

This leads to:
- ignoring obvious faults
- incorrect branching
- checklist-following behavior

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

But:
- must NOT switch mode automatically

---

#### 5. Terminal State Logic
Explicit handling of:
- when to stop diagnostics
- when questioning becomes invalid

---

### Definition of Done
- Engine produces signal-aware next step
- No signal-ignore failures in benchmark
- Terminal state respected in all cases

---

## 1.3 Safe route.ts Decomposition (NEW — HIGH PRIORITY)

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
- mode inference
- completion logic

---

### Decomposition Strategy (SAFE)

#### Step 1
Extract:
- request preparation
- language handling

#### Step 2
Extract:
- diagnostic flow orchestration

#### Step 3
Extract:
- final report / labor override flow

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
- behavior unchanged (validated by benchmark)

---

## 1.4 Structure-Preserving Tests (NEW — CRITICAL)

### Problem
Refactoring can silently break architecture.

---

### Required Test Types

#### 1. Route Wiring Tests
- correct flow invocation
- no duplicate paths
- SSE lifecycle intact

---

#### 2. No-Hidden-Authority Tests
- ensure only Context Engine decides flow
- detect logic leakage into helpers

---

#### 3. Module Unit Tests
- extracted services tested independently

---

#### 4. Regression Tests
Must cover:
- signal ignored
- wrong branch
- duplicate step
- post-terminal questioning
- illegal report behavior

---

### Definition of Done
- tests fail if flow authority is violated
- tests fail if branching logic moves outside engine

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

## 2.4 Mobile-First UI Redesign (NEW — HIGH PRIORITY)

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

---

#### 2. Multi-Screen Flow (Possible Redesign)
Instead of one dense screen, split into:

- Screen 1: Case / context
- Screen 2: Current diagnostic step
- Screen 3: Input (answer / voice / quick buttons)
- Screen 4: Report / output

Navigation:
- forward/back buttons
- minimal friction
- no hidden state

---

#### 3. Diagnostic Step Focus Mode
- highlight ONLY current question
- hide previous noise by default
- allow optional expand for history

---

#### 4. Quick Input Optimization
- Yes / No buttons
- predefined answers where possible
- voice input support (future)

---

#### 5. Report View Optimization
- easy copy
- clear sections
- mobile-friendly formatting
- no horizontal overflow

---

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

### Validation
- test on real devices (not just dev tools)
- test with gloves / dirty hands scenario (real technician context)
- measure:
  - time to answer step
  - error rate
  - abandonment
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

---

# 6. Immediate Next Actions

1. Finalize PROJECT_MEMORY (DONE)
2. Create RV_SWE_BENCHMARK_v1.md (NEXT)
3. Define signal taxonomy
4. Build first 20 test cases
5. Only then start route.ts decomposition

---

End of file