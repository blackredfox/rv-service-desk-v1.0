# RV Service Desk
## TEST_STRATEGY_QA_CONTRACT.md

**Version:** 1.2  
**Status:** Enforced QA / Testing Contract  
**Purpose:** Define the required testing model for behavior correctness, architecture preservation, regression control, and safe route decomposition.

**Last updated:** 2026-04-03

---

## 1) Why This Document Exists

RV Service Desk can no longer be validated with only simple functional tests.

The system now depends on multiple critical invariants:

- Context Engine must remain the single diagnostic flow authority
- route.ts decomposition must not create hidden flow logic
- prompt layer must not become a second diagnostic engine
- benchmarked behavior must not regress
- language, report, and terminal-state contracts must remain enforced
- natural report-intent handling must remain bounded and deterministic
- dirty-input robustness must not regress
- current-step support must remain helpful without becoming progress

This document defines the testing strategy required to keep those invariants true.

---

## 2) Scope

This document defines:

- what kinds of tests are required,
- what each test layer is responsible for,
- what must block PRs,
- how benchmark and architecture checks relate,
- what must be covered before and after route decomposition.

This document does NOT replace:
- `PROJECT_MEMORY.md`
- `RV_SWE_BENCHMARK_v1.md`
- `ARCHITECTURE_RULES.md`
- ADR documents

It operationalizes them into QA requirements.

---

## 3) Core Testing Principle

> A test suite is not only for output correctness.  
> It is also for architecture preservation.

### 3.1 Behavior-contract rule

> Tests must validate **behavior contracts**, not incidental wording.

In this repository, a good test protects what the product must do, not merely how one prompt phrased it on one day.

Tests should prefer validating behavior such as:
- mode correctness
- no invalid mode drift
- prerequisite/order discipline
- no skipped steps
- no premature completion
- no unauthorized transition
- output structure / shape
- language policy
- safety boundaries
- authoritative-state behavior
- natural report-intent handling
- dirty-input robustness
- useful current-step guidance behavior

### 3.2 Exact wording boundary

Exact wording assertions are allowed only when the wording itself is contract-critical, for example:
- exact section headers
- exact command tokens if still intentionally fixed
- exact separators
- safety/compliance-critical mandated wording
- intentionally fixed canonical templates

Exact wording assertions are NOT the default.

If a phrase is not part of the actual product contract, the test should validate structure, markers, state, ordering, or policy instead.

### 3.3 Preferred assertion classes

When writing or reviewing tests, prefer assertions that answer questions like:
- Is the system in the correct mode?
- Did it avoid invalid mode drift?
- Did it preserve prerequisite and ordering discipline?
- Did it avoid skipping required steps?
- Did it avoid premature completion?
- Did it block unauthorized transitions?
- Did it preserve the required output structure and shape?
- Did it follow language policy?
- Did it stay within safety boundaries?
- Did it use authoritative state rather than inferred or improvised state?
- Did it answer the actual current-step question the technician asked?
- Did it remain robust to realistic technician input?

---

## 4) Source-of-Truth Relationship

Testing must align with the project truth hierarchy:

### Product truth
- `PROJECT_MEMORY.md`

### Architecture truth
- `ARCHITECTURE_RULES.md`
- ADR documents

### Behavioral truth
- `RV_SWE_BENCHMARK_v1.md`

### Runtime reality
- `REPO_STATE_TRUTH_YYYY-MM-DD.md`

Tests must fail if implementation drifts from those contracts.

---

## 5) Required Test Layers

### 5.1 Unit Tests
Purpose:
- verify small pure behaviors,
- keep logic deterministic,
- catch low-level regressions quickly.

Must cover at minimum:
- mode resolution
- alias / natural-intent trigger classification boundaries
- language gating
- validators
- output formatting helpers
- report helper functions
- prompt-layer helper utilities (if any)
- pure procedure utilities
- Context Engine pure functions
- dirty-input normalization helpers (if extracted)

### 5.2 Integration Tests
Purpose:
- verify end-to-end route behavior at API level,
- ensure system layers work together correctly.

Must cover at minimum:
- `/api/chat`
- complex system gating
- completeness gate
- post-repair fallback to diagnostics
- mechanical direct-power guardrail
- final output formatting
- explicit / approved-alias mode transitions
- language enforcement behavior
- locate-guidance support behavior
- dirty-input route behavior on realistic examples

### 5.3 Benchmark / Evaluation Tests
Purpose:
- verify contract-level behavioral correctness,
- preserve real-case regressions,
- prevent “looks better” merges.

Benchmark must cover:
- procedure compliance
- signal-aware branch behavior
- terminal-state behavior
- report readiness / support behavior
- natural report-intent handling
- language consistency
- state / memory loss
- dirty-input robustness
- known historical failures

Benchmark is not optional.

### 5.4 Structure-Preserving Tests
Purpose:
- verify that refactors do not create architecture drift.

Must include:
- route wiring tests
- no-hidden-authority tests
- extracted-module unit tests
- strictness tests

---

## 6) Mandatory Test Categories

### 6.1 Route Wiring Tests
These tests verify that route-level orchestration remains correct.

Must prove:
- request enters the correct orchestration path
- SSE lifecycle remains valid
- `case`, `language`, `mode`, `done`, and `error` events are emitted correctly
- no duplicated close/return behavior occurs
- route boundary still coordinates without silently becoming a second flow engine
- report-intent path does not bounce back into diagnostics after readiness is reached

### 6.2 No Hidden Authority Tests
These tests verify that flow authority is not leaking into helpers, prompts, or route glue.

Must prove:
- extracted modules do NOT choose next steps
- extracted modules do NOT infer completion
- extracted modules do NOT perform uncontrolled semantic mode transitions
- prompt-layer changes do NOT create hidden branch logic
- route does NOT become a second state machine

These tests should fail if:
- helper modules start selecting steps
- “smart fallbacks” start rewriting flow decisions
- report/readiness logic is implemented outside the intended authority layer

### 6.3 Extracted Module Unit Tests
Each extracted module must have targeted unit coverage.

Expected extraction targets include:
- request preparation
- mode resolution
- intent extraction / alias handling
- validation services
- report helpers
- logging helpers
- prompt context builders
- execution wrappers
- persistence side-effect services
- dirty-input normalization utilities

### 6.4 Strictness Tests
These tests verify that single-authority architecture is still intact.

Must prove:
- Context Engine remains sole diagnostic flow authority
- legacy / alternate flow paths are not reintroduced
- no dual state machine appears
- clarification, replan, and terminal behavior are not split across hidden controllers
- prompt layer remains delivery/support only
- natural report-intent handling stays bounded and server-owned

---

## 7) Behavior-Critical Regression Categories

The suite must include regression coverage for all major known failure types.

### 7.1 Procedure regressions
- skipped prerequisite
- duplicate step
- wrong step order
- cross-system drift

### 7.2 Signal regressions
- signal ignored
- wrong branch priority
- flattened signal-driven flow
- unrelated checklist continuation after critical signal

### 7.3 State / terminal regressions
- post-completion questioning
- route/report flow falling back into diagnostics
- memory reset / system loss
- branch reopening without valid new evidence

### 7.4 Report / authorization regressions
- uncontrolled auto-switch behavior
- report generated in wrong mode
- report not suggested/supported when runtime says ready
- labor confirmation path re-entering diagnostics
- authorization/report confusion across modes
- approved natural report intent not honored
- exact magic-phrase-only dependence when an approved report trigger should work

### 7.5 Support / mentor regressions
- how-to explanation closes step implicitly
- locate/explain support drifts away from active step
- no return-to-step after clarification
- tutorial drift outside procedure
- prompt acts like hidden diagnostic engine
- locate or identify question answered with repeated generic measurement wording only

### 7.6 Language regressions
- RU/EN/ES drift in diagnostics
- mixed-language diagnostic answers
- wrong final output language structure
- missing translation block
- English block contaminated with RU/ES text

### 7.7 Dirty-input robustness regressions
- mixed-language complaint/findings misclassified
- keyboard-layout corruption breaks routing
- complaint + findings + repair + report request in one message mishandled
- report-intent extraction fails on realistic noisy input

### 7.8 Interaction realism regressions
- robotic bureaucratic banner dominates when bounded natural phrasing is allowed
- assistant ignores the actual question and repeats the previous step text
- report flow blocked by unnecessary ritual command friction

These are benchmarked only where they cross a documented product boundary.

---

## 8) Test Environment Rules

### 8.0 Root Hygiene Rule
- active test files belong under `/tests`
- repo root must not be used for scratch/ad hoc test files
- generated test reports must not be stored in repo root

### 8.1 Determinism
Unit/component tests must be deterministic.

Default rule:
- no live DB dependency
- no network dependency
- no uncontrolled randomness

### 8.2 Database policy
Default tests run in memory-mode / DB-free mode.

### 8.3 Runtime isolation
Tests must not depend on:
- current local machine state
- manual prompt tweaking
- prior test order
- hidden shared mutable state without explicit reset

---

## 9) CI / PR Gating Rules

### 9.1 Blocking categories
The following failures must block merge:

- benchmark regressions
- strictness test failures
- no-hidden-authority failures
- route wiring failures
- output contract validation regressions
- language contract regressions
- deterministic unit/integration failures
- dirty-input classification regressions
- natural report-intent regressions

### 9.2 Non-blocking observations
The following may be tracked without immediate block only if explicitly approved:
- test debt notes
- future benchmark candidates
- coverage expansion not yet implemented

### 9.3 No “looks good” merges
A PR cannot be accepted because:
- manual demo looked good
- one happy-path case improved
- output sounded more natural

A PR is acceptable only if:
- required tests pass,
- benchmark-relevant behavior does not regress,
- authority boundaries remain preserved.

---

## 10) Minimum PR Checklist for Chat / Flow Changes

Any PR touching:
- `route.ts`
- Context Engine
- prompts
- validators
- report flow
- mode logic
- procedure logic
- intent handling
- input normalization

must satisfy:

### Contract alignment
- [ ] aligns with `PROJECT_MEMORY.md`
- [ ] aligns with `ARCHITECTURE_RULES.md`
- [ ] aligns with ADR constraints
- [ ] aligns with `PROMPT_MENTOR_CONTRACT.md` if prompt layer changes

### Test alignment
- [ ] benchmark impact reviewed
- [ ] new regression added if fixing a real bug
- [ ] route wiring still covered
- [ ] no-hidden-authority conditions still covered
- [ ] strictness tests still pass

### Assertion quality
- [ ] this test protects a real product behavior boundary
- [ ] if using an exact wording assertion, the wording is contract-critical
- [ ] if wording is not contract-critical, the assertion is phrased as structure/marker/state/policy validation

### Refactor safety
- [ ] no hidden flow logic introduced into helpers
- [ ] no uncontrolled semantic mode inference introduced
- [ ] no alternate completion logic introduced outside intended authority
- [ ] alias handling remains bounded and deterministic

---

## 11) Route Decomposition QA Rules

Because route decomposition is a planned workstream, additional QA constraints are required.

### 11.1 Boundary-first rule
Refactor success is NOT:
- fewer lines
- more files
- prettier structure

Refactor success IS:
- same or better behavior,
- preserved authority boundaries,
- no hidden flow logic in extracted modules,
- test-backed structure.

### 11.2 Required decomposition checks
Before accepting decomposition work, tests must prove:

- route no longer contains bulky transport-adjacent internals where extraction was intended
- route does not implement custom branching outside Context Engine
- extracted modules are bounded and individually testable
- integration behavior remains unchanged unless explicitly intended
- strictness tests still prove single-authority flow

### 11.3 Special decomposition risk
The most dangerous decomposition failure is:
> a cleaner-looking route with a more fragmented architecture.

Tests must explicitly guard against that outcome.

---

## 12) Benchmark Relationship

The benchmark and test suite are related but not identical.

### Benchmark answers:
- Does the system behave correctly in real scenarios?

### QA contract answers:
- Is the system tested in the right way?
- Are architecture invariants enforced?
- Are regressions blocked properly?

Both are required.

---

## 13) Failure Severity Guidance

### P0
Critical failures:
- hidden authority introduced
- benchmark regression on major behavior
- report in wrong mode
- language-lock failure
- terminal-state failure
- silent architecture split
- dirty-input collapse into wrong system
- approved natural report-intent failure

### P1
Major failures:
- missing module tests for newly extracted logic
- route wiring regressions
- support/return-to-step regressions
- incomplete decomposition safety coverage

### P2
Secondary failures:
- low-priority missing edge-case coverage
- non-blocking test hygiene improvements
- future benchmark candidate not yet formalized

---

## 14) Required Maintenance Rule

Whenever the project changes materially in any of these areas:
- route decomposition status
- Context Engine authority scope
- prompt layer support behavior
- benchmark taxonomy
- report/labor flow
- language contract
- natural-intent handling
- dirty-input robustness

the test strategy / QA contract must be reviewed and updated.

---

## 15) Current Practical Testing Order

Until superseded, use this order:

1. deterministic unit tests
2. integration tests for `/api/chat`
3. benchmark / real-case regression checks
4. route wiring tests
5. no-hidden-authority tests
6. strictness tests
7. extracted-module unit tests for any new decomposition work

---

## 16) Final Principle

> In RV Service Desk, tests protect both behavior and architecture.

If the suite only checks wording,
it is incomplete.

If the suite only checks happy-path functionality,
it is unsafe.

If the suite does not prove single-authority preservation,
it does not protect the system.

End of file.