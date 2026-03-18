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

## L1 — Product Truth (Highest Authority)
**File:**
- `PROJECT_MEMORY.md`

Defines:
- product behavior
- diagnostic contract
- mode system
- language rules
- terminal / completion logic
- safety constraints

**Rule:**
If any document conflicts with PROJECT_MEMORY → PROJECT_MEMORY wins.

---

## L2 — Architecture Rules (Implementation Law)
**Files:**
- `ARCHITECTURE_RULES.md`
- ADR documents (e.g. `ADR-002-ROUTE-DECOMPOSITION.md`)

Defines:
- system invariants
- ownership boundaries
- single-authority rule
- allowed vs forbidden patterns

**Rule:**
Must comply with L1.
Cannot redefine product behavior.

---

## L3 — Behavioral Truth (Validation Law)
**File:**
- `RV_SWE_BENCHMARK_v1.md`

Defines:
- pass/fail conditions
- failure taxonomy
- regression coverage
- real failure references

**Rule:**
- Overrides subjective interpretation
- If system passes docs but fails benchmark → system is wrong

---

## L4 — Current Runtime Truth (Observed State)
**File:**
- `REPO_STATE_TRUTH_YYYY-MM-DD.md`

Defines:
- what is actually implemented
- known gaps vs architecture
- current limitations

**Rule:**
- Descriptive, not prescriptive
- Cannot override L1–L3
- Must be used to avoid refactoring against false assumptions

---

## L5 — Historical Truth (Archive Only)
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

If ADR conflicts with PROJECT_MEMORY:
→ ADR must be updated

---

# 4) Required Repository State

The repository must satisfy:

- Exactly ONE `PROJECT_MEMORY.md`
- Exactly ONE active benchmark spec
- ADRs aligned with current architecture intent
- A current `REPO_STATE_TRUTH` document
- No active duplicate truth sources

---

# 5) Mandatory Cleanup Actions (Current)

## Required now:

### 1. Product Memory
- KEEP: `PROJECT_MEMORY.md`
- REMOVE or ARCHIVE: `PROJECT_MEMORY_1_UPDATED.md`

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
- [ ] Matches PROJECT_MEMORY (L1)
- [ ] Respects ARCHITECTURE_RULES (L2)
- [ ] Does not break BENCHMARK (L3)

### Reality awareness
- [ ] Considers current gaps from REPO_STATE_TRUTH (L4)

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