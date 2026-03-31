# RV Service Desk
## TEST_STRATEGY_QA_CONTRACT.md

**Version:** 1.0  
**Status:** Enforced QA / Testing Contract  
**Purpose:** Define the required testing model for behavior correctness, architecture preservation, regression control, and safe route decomposition.

**Last updated:** 2026-03-18

---

## 1) Why This Document Exists

RV Service Desk can no longer be validated with only simple functional tests.

The system now depends on multiple critical invariants:

- Context Engine must remain the single diagnostic flow authority
- route.ts decomposition must not create hidden flow logic
- prompt layer must not become a second diagnostic engine
- benchmarked behavior must not regress
- language, report, and terminal-state contracts must remain enforced

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

For this project, a change is unsafe if it:
- produces the right wording but breaks flow authority,
- passes happy-path output tests but introduces hidden diagnostic logic,
- improves one case while breaking benchmarked regressions,
- makes route.ts cleaner while scattering authority into helpers.

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
- language gating
- validators
- output formatting helpers
- report helper functions
- prompt-layer helper utilities (if any)
- pure procedure utilities
- Context Engine pure functions

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
- explicit mode transitions
- language enforcement behavior

### 5.3 Benchmark / Evaluation Tests
Purpose:
- verify contract-level behavioral correctness,
- preserve real-case regressions,
- prevent “looks better” merges.

Benchmark must cover:
- procedure compliance
- signal-aware branch behavior
- terminal-state behavior
- report readiness / suggestion behavior
- language consistency
- state / memory loss
- known historical failures

Benchmark is not optional.

### 5.4 Structure-Preserving Tests
Purpose:
- verify that refactors do not create architecture drift.

These tests are mandatory because route decomposition is planned and helper extraction is dangerous.

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

Examples:
- stream closes exactly once
- `done` is always sent on success
- error path does not emit success events
- explicit mode orchestration still works after refactor

### 6.2 No Hidden Authority Tests
These tests verify that flow authority is not leaking into helpers, prompts, or route glue.

Must prove:
- extracted modules do NOT choose next steps
- extracted modules do NOT infer completion
- extracted modules do NOT infer semantic mode transitions
- prompt-layer changes do NOT create hidden branch logic
- route does NOT become a second state machine

These tests should fail if:
- helper modules start selecting steps
- “smart fallbacks” start rewriting flow decisions
- report/readiness logic is implemented outside the intended authority layer

### 6.3 Extracted Module Unit Tests
These are required once route decomposition begins.

Each extracted module must have targeted unit coverage.

Expected extraction targets include:
- request preparation
- mode resolution
- validation services
- report helpers
- logging helpers
- prompt context builders
- execution wrappers
- persistence side-effect services

Requirement:
- every extracted module with logic must be test-covered before or at extraction time

### 6.4 Strictness Tests
These tests verify that single-authority architecture is still intact.

Must prove:
- Context Engine remains sole diagnostic flow authority
- legacy / alternate flow paths are not reintroduced
- no dual state machine appears
- clarification, replan, and terminal behavior are not split across hidden controllers
- prompt layer remains delivery/support only

These tests are blocking, not optional.

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
- auto-switch behavior
- report generated in wrong mode
- report not suggested when runtime says ready
- labor confirmation path re-entering diagnostics
- authorization/report confusion across modes

### 7.5 Support / mentor regressions
- how-to explanation closes step implicitly
- locate/explain support drifts away from active step
- no return-to-step after clarification
- tutorial drift outside procedure
- prompt acts like hidden diagnostic engine

### 7.6 Language regressions
- RU/EN/ES drift in diagnostics
- mixed-language diagnostic answers
- wrong final output language structure
- missing translation block
- English block contaminated with RU/ES text

---

## 8) Test Environment Rules

### 8.0 Root Hygiene Rule
- active test files belong under `/tests`
- repo root must not be used for scratch/ad hoc test files
- generated test reports must not be stored in repo root
- if report artifacts have historical/debug value, archive them under `docs/archive/test-reports/`

### 8.1 Determinism
Unit/component tests must be deterministic.

Default rule:
- no live DB dependency
- no network dependency
- no uncontrolled randomness

### 8.2 Database policy
Default tests run in memory-mode / DB-free mode.

If DB-backed tests exist:
- they must be opt-in
- they must not block standard deterministic PR validation unless explicitly intended

### 8.3 Runtime isolation
Tests must not depend on:
- current local machine state
- manual prompt tweaking
- prior test order
- hidden shared mutable state without explicit reset

### 8.4 TypeScript / build sanity
Type-aware test expectations must remain compatible with repository TypeScript strictness and path configuration.

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

### Refactor safety
- [ ] no hidden flow logic introduced into helpers
- [ ] no semantic mode inference introduced
- [ ] no alternate completion logic introduced outside intended authority

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

A project can have:
- passing unit tests,
- passing integration tests,
- but still be unsafe if benchmark or strictness coverage is missing.

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

the test strategy / QA contract must be reviewed and updated.

This document must evolve with the architecture.

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

This keeps fast feedback first while still protecting architecture.

---

## 16) Final Principle

> In RV Service Desk, tests protect both behavior and architecture.

If the suite only checks wording,
it is incomplete.

If the suite only checks happy-path functionality,
it is unsafe.

If the suite does not prove single-authority preservation,
it does not protect the system.

---

End of file.