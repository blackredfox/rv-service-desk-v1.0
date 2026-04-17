# SOURCE_OF_TRUTH_RULES.md

## RV Service Desk
**Version:** 1.0  
**Status:** ENFORCED (PR review required)  
**Purpose:** Eliminate ambiguity in project truth sources and prevent architectural drift.

---

# 1) Why This Exists

The project accumulated multiple overlapping “truth sources”:
- product memory,
- ADRs,
- runtime descriptions,
- benchmark,
- baseline snapshots.

These are not equivalent.

Without strict hierarchy, this leads to:
- conflicting decisions,
- incorrect refactors,
- hidden dual-authority behavior.

This document defines the **only allowed source-of-truth hierarchy**.

---

# 2) Enforced Source of Truth Hierarchy

## L1 — Customer Behavior Mirror (Behavioral Authority)
**File:**
- `docs/CUSTOMER_BEHAVIOR_SPEC.md`

Defines:
- the canonical, customer-approved behavioral algorithm
  (engineering-normalized internal mirror)
- diagnostic-flow doctrine (one question at a time, causal procedure flow,
  no questionnaire-first unresolved fallback)
- isolation / cause gating doctrine
- manufacturer-priority behavior
- output-surface distinction
  (`authorization_ready`, `portal_cause`, `shop_final_report`)
- prohibited premature outputs
- approved transition classes
  (explicit commands, server-approved natural-language aliases,
  server-owned legality-gated CTAs)
- single-authority doctrine (Context Engine is the sole runtime
  diagnostic-flow authority)

**Rule:**
If any internal product, architecture, or supporting document conflicts
with the customer behavior spec, the customer behavior spec wins and the
conflicting document MUST be reconciled to it.

This is the highest behavioral authority in the repository.

---

## L2 — Product Memory (Active Product Truth)
**File:**
- `PROJECT_MEMORY.md`

Defines:
- product behavior (aligned to L1)
- diagnostic contract
- mode system
- language rules
- terminal / completion logic
- safety constraints
- non-goals / hard product boundaries

**Rule:**
- Must remain aligned to L1.
- Where L2 and L1 diverge, L1 wins and L2 must be reconciled.
- Within its scope, L2 remains the active product memory and the
  technical-boundary document for engineering work.
- L2 may not redefine behavioral truth that L1 owns.

---

## L3 — Architecture Rules (Implementation Law)
**Files:**
- `ARCHITECTURE_RULES.md`
- active ADR documents (e.g. `ADR-002-ROUTE-DECOMPOSITION.md`)

Defines:
- system invariants
- ownership boundaries
- single-authority rule
- allowed vs forbidden patterns

**Rule:**
- Must comply with L1 and L2.
- Cannot redefine product behavior.
- Cannot override the customer behavior spec.
- Architecture truth is authoritative for *how* the system is built,
  not for *what behavior* the system must produce.

---

## L4 — Behavioral Validation Law (Benchmark)
**File:**
- `RV_SWE_BENCHMARK_v1.md`

Defines:
- pass/fail conditions
- failure taxonomy
- regression coverage
- real failure references

**Rule:**
- Overrides subjective interpretation.
- If system passes docs but fails benchmark → system is wrong.
- Benchmark is the validation law that protects L1 / L2 contracts.
- Benchmark cannot be overridden by architecture preference or
  by descriptive repo-state memos.

---

## L5 — Current Runtime Truth (Observed State, Descriptive Only)
**File:**
- `REPO_STATE_TRUTH_YYYY-MM-DD.md`

Defines:
- what is actually implemented at a given point in time
- known gaps vs architecture
- current limitations

**Rule:**
- Descriptive, not prescriptive.
- Cannot override L1–L4.
- A repo-state memo can describe the current observed state of the
  codebase, but it cannot redefine product, architecture, or
  benchmark truth.
- Must be used to avoid refactoring against false assumptions, not
  to justify violating contract truth.

---

## L6 — Historical Truth (Archive Only)
**Files:**
- `BASELINE_BEHAVIOR_*.md`
- older PROJECT_MEMORY versions

Defines:
- past system state
- historical metrics
- prior interpretations

**Rule:**
- Never used as current authority
- Reference only

---

# 3) Hard Conflict Resolution Rules

## Rule S1 — No Dual Truth
There must never be:
- two active product memory files
- two competing architecture definitions
- multiple behavioral contracts

If duplication exists:
→ one must be archived or removed.

---

## Rule S2 — No Implicit Authority
No document may silently act as truth.

Every document must clearly be:
- authoritative (L1–L3)
- descriptive (L4)
- or historical (L5)

---

## Rule S3 — Code is NOT Truth Authority
Runtime code (e.g. `route.ts`) is:

> implementation, not authority

If code conflicts with L1–L3:
→ code is wrong, not the contract

Exception:
- must be documented in L4 (REPO_STATE_TRUTH)

---

## Rule S4 — Benchmark Overrides Interpretation
If:
- behavior "looks correct"
- but fails benchmark

→ it is a failure

No exceptions.

---

## Rule S5 — ADR Cannot Rewrite Product
ADR documents:
- define HOW to implement
- not WHAT the system does

If ADR conflicts with PROJECT_MEMORY (L2) or with the customer
behavior spec (L1):
→ ADR must be updated.

ADRs cannot redefine behavioral doctrine. If a previously accepted ADR
now reads as if it owns flow authority, branch authority, or
report-readiness authority, it must be reclassified as historical /
superseded rather than left readable as current architecture truth.

---

# 4) Required Repository State

The repository must satisfy:

- Exactly ONE active customer behavior mirror (`docs/CUSTOMER_BEHAVIOR_SPEC.md`)
- Exactly ONE `PROJECT_MEMORY.md`
- Exactly ONE active benchmark spec
- ADRs aligned with current architecture intent and reconciled to L1
- A current `REPO_STATE_TRUTH` document, clearly marked as descriptive
- No active duplicate truth sources
- No supporting doc that implies route handlers, registry helpers, or
  prompt logic own diagnostic flow / branch / readiness authority

---

# 5) Mandatory Cleanup Actions (Current)

## Required now:

### 1. Behavioral mirror
- KEEP: `docs/CUSTOMER_BEHAVIOR_SPEC.md` as L1.
- Any document that contradicts it must be reconciled or reclassified.

### 2. Product Memory
- KEEP: `PROJECT_MEMORY.md` as L2 (active product memory).
- Any prior `_UPDATED` variants (e.g. `PROJECT_MEMORY_1_UPDATED.md`,
  `ROADMAP_UPDATED.md`, `README_UPDATED.md`) are **not** the current
  active docs. Supporting documents must reference the active filenames
  (`PROJECT_MEMORY.md`, `ROADMAP.md`, `README.md`) instead.

---

### 2. Baseline
- KEEP as historical
- CLEARLY mark as:
  > ARCHIVED — NOT CURRENT TRUTH

---

### 3. Runtime / README docs
Must be one of:

- updated to match current reality  
OR
- explicitly labeled:
  > TARGET ARCHITECTURE (NOT CURRENT STATE)

---

# 6) PR Review Enforcement Checklist

Any PR affecting architecture or behavior must verify:

### Truth integrity
- [ ] No new competing truth source introduced
- [ ] No duplication of product rules
- [ ] No hidden authority added

### Alignment
- [ ] Matches the customer behavior spec (L1)
- [ ] Matches PROJECT_MEMORY (L2)
- [ ] Respects ARCHITECTURE_RULES (L3)
- [ ] Does not break BENCHMARK (L4)

### Reality awareness
- [ ] Considers current gaps from REPO_STATE_TRUTH (L5) as descriptive only

---

# 7) Failure Definition

It is a **P1 architecture failure** if:

- multiple truth sources conflict
- developer decision depends on “which doc they read”
- code behavior is justified by outdated or non-authoritative doc
- route/helpers introduce hidden flow authority due to unclear contracts

---

# 8) Final Principle

> Truth must be singular, ordered, and enforced.

If truth must be debated during implementation:
→ the system is already in an inconsistent state.

---

End of file.