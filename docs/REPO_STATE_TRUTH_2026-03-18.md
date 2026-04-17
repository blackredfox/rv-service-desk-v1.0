# RV Service Desk
## REPO_STATE_TRUTH_2026-03-18.md

**Version:** 1.2  
**Status:** Historical / Dated Current-State Audit Memo (descriptive only)  
**Purpose:** Reconcile project documents with the repository/application reality observed on 2026-03-18.

**Last updated:** 2026-03-18  
**Reclassified:** descriptive-only memo (truth-hierarchy cleanup)

> ### Status note
>
> This memo is a **dated, descriptive current-state audit** from 2026-03-18.
> It is **not** a contract document and **not** active product, architecture,
> or benchmark truth.
>
> For active truth, use:
>
> - `docs/CUSTOMER_BEHAVIOR_SPEC.md` (behavioral authority)
> - `PROJECT_MEMORY.md` (active product memory)
> - `ARCHITECTURE_RULES.md` and active ADRs (implementation invariants)
> - `RV_SWE_BENCHMARK_v1.md` (behavioral validation law)
> - `SOURCE_OF_TRUTH_RULES.md` (truth hierarchy / conflict resolution)
> - `README.md`, `ROADMAP.md` for current external/planning narrative
>
> Where this memo refers to documents using older `_UPDATED` filenames
> (e.g. `PROJECT_MEMORY_1_UPDATED.md`, `ROADMAP_UPDATED.md`,
> `README_UPDATED.md`), those names are **historical**. The active docs
> are now the un-suffixed filenames listed above.
>
> The historical observations below are preserved as repo-state history,
> not as currently authoritative statements.

---

## 1) Why This Document Exists

This document exists because the project currently has multiple valid but non-identical truth sources:

- historical baseline snapshot,
- active ADR guidance,
- current route/controller reality,
- current planning assumptions.

These sources are not fully aligned.

This memo does **not** replace the historical baseline.
It exists to:
- identify the mismatches,
- establish the current working truth at that date,
- prevent refactoring against stale assumptions.

---

## 2) Scope

This is a **repo-state truth / architecture-audit memo**, not:
- a historical baseline snapshot,
- a roadmap,
- a benchmark,
- a prompt contract.

Its purpose is narrow:

> say what was currently true on 2026-03-18, what was stale at that time,
> and how to avoid refactoring against false assumptions.

This memo does **not** define the active repository truth hierarchy.
That hierarchy is defined by `SOURCE_OF_TRUTH_RULES.md`.

---

## 3) Relationship to Existing Documents

### 3.1 Historical baseline
`BASELINE_BEHAVIOR_2026-03-16.md` remains a valid historical baseline snapshot.

It captures:
- branch/commit snapshot,
- test counts at that time,
- known failures at that time,
- architectural interpretation at that time.

It should be preserved as history, not overwritten.

### 3.2 ADR
`ADR-002-ROUTE-DECOMPOSITION.md` is now the active architecture decision record for safe route decomposition.

### 3.3 Project memory / roadmap / benchmark
At the time of this 2026-03-18 audit, the contract documents being
treated as active were referenced under their then-current `_UPDATED`
filenames.

The active contract/supporting documents are now (post-cleanup):
- `docs/CUSTOMER_BEHAVIOR_SPEC.md`
- `PROJECT_MEMORY.md`
- `ARCHITECTURE_RULES.md`
- `RV_SWE_BENCHMARK_v1.md`
- `ROADMAP.md`
- `README.md`

This section is informational only.  
It does **not** define precedence. Precedence lives in `SOURCE_OF_TRUTH_RULES.md`.

---

## 4) Current Observed Reality

### 4.1 Baseline and current state are NOT the same thing
The baseline document describes a stable snapshot from 2026-03-16.

It is not sufficient as a current-state truth source because:
- route decomposition status has since been re-evaluated,
- architecture interpretation has been tightened,
- benchmark and behavioral contracts have expanded,
- document alignment work has progressed beyond the baseline snapshot.

### 4.2 Current route reality
`src/app/api/chat/route.ts` is **not yet boundary-only**.

It still contains substantial orchestration and policy-adjacent logic, including:
- request/body handling,
- language tracking and output policy setup,
- case initialization and history loading,
- Context Engine invocation and directive assembly,
- prompt assembly,
- labor override flow,
- validation / retry / fallback orchestration,
- persistence side effects,
- streaming lifecycle management.

Therefore:
- route decomposition is **not complete**,
- and any document claiming the boundary target is already achieved is stale.

### 4.3 Current architecture truth observed at that time
The current architecture reality observed on 2026-03-18 was:

- **Context Engine is the single flow authority**
- `route.ts` is still oversized
- safe decomposition is still pending
- decomposition must not create hidden flow logic in helper modules
- prompts are not allowed to become hidden flow authority
- report suggestion is allowed, auto-transition is not
- signal-aware branch semantics are recognized as needed architecture evolution
- benchmark-first validation is now part of the active plan

This list is descriptive of the observed state and planning interpretation at that time.
It is not a substitute for active contract truth.

---

## 5) Document Alignment Findings

### Finding A — Baseline is historical, not current truth
`BASELINE_BEHAVIOR_2026-03-16.md` should be treated as a dated snapshot, not as the active architecture truth source.

### Finding B — Prior ADR wording was too optimistic
Earlier ADR wording implied that route decomposition was already implemented.
That was no longer acceptable as the active truth statement.

The updated ADR-002 corrected this.

### Finding C — route.ts still exceeds target role
The route file still acted as more than a transport/controller boundary.

This was the central current-state truth relevant to future refactor work.

### Finding D — Benchmark and behavioral contracts defined more of the system than baseline did
As of 2026-03-18, system truth already explicitly included:
- signal override,
- branch priority,
- report suggestion without auto-switch,
- completed-step definition,
- terminal-state definition,
- language consistency as a critical contract,
- state/memory-loss failures as benchmarked defects.

These were newer than the baseline snapshot and had to be treated as active contract direction at that time.

---

## 6) Active contract documents referenced by this memo

> This section is a reference map only.
> It does **not** define hierarchy or precedence.
> The enforced order of truth lives in `SOURCE_OF_TRUTH_RULES.md`.

For current work, the active documents referenced by this memo are:

### Behavioral authority
`docs/CUSTOMER_BEHAVIOR_SPEC.md`

### Product memory
`PROJECT_MEMORY.md`

### Architecture invariants
`ARCHITECTURE_RULES.md` and active ADRs

### Behavioral validation law
`RV_SWE_BENCHMARK_v1.md`

### Planning narrative
`ROADMAP.md`

### External-facing product description
`README.md`

### Historical snapshot only
`BASELINE_BEHAVIOR_2026-03-16.md`

Important:
The baseline remains useful for comparison, but it is **not** an active truth source for current architecture decisions.

---

## 7) Route.ts Truth Statement (Current at that time)

Current truth statement for `route.ts` on 2026-03-18:

- It was still a mixed boundary/orchestration file.
- It was not yet a thin controller.
- It still included too much application orchestration.
- This was acceptable only temporarily.
- Future decomposition had to preserve single-flow authority.
- No extraction could introduce hidden diagnostic logic outside Context Engine.

This statement superseded any informal assumption that route decomposition was already done.

---

## 8) Truth Statement on Decomposition

Safe decomposition was, at that time:

> **planned, partially prepared, not complete**

That meant:
- decomposition could proceed,
- but only after contract alignment and benchmark alignment,
- and only under the updated ADR-002 constraints.

This document explicitly rejected the interpretation:

> “helpers were extracted, therefore route decomposition is complete.”

That interpretation was false for planning purposes.

---

## 9) Truth Statement on Tests and Stability

The historical baseline recorded:
- 605 tests total,
- 588 passed,
- 17 failed,
at that moment in time.

That remains useful as a historical reference point.

However:
- it must not be assumed to represent the active post-document-alignment truth,
- especially after new benchmark categories and architecture-preserving expectations were added.

Therefore:
- test numbers in the 2026-03-16 baseline are historical,
- not the current authoritative quality summary.

---

## 10) Working Assumptions Going Forward

Until superseded by a newer audit note, the team should assume:

1. route decomposition is still pending
2. Context Engine remains sole diagnostic authority
3. no helper module may own hidden branch logic
4. benchmark is now part of architecture governance
5. language drift and memory-loss are first-class failure classes
6. historical baseline is for comparison, not command authority

---

## 11) Practical Use

Use this document when:
- planning route refactor work,
- reconciling stale docs,
- explaining why baseline and ADR do not read the same,
- deciding whether a claim about repo state is still current.

Do **not** use this document as:
- a benchmark,
- a release note,
- a substitute for baseline history,
- a replacement for `SOURCE_OF_TRUTH_RULES.md`.

---

## 12) Recommended Next Maintenance Rule

Whenever one of the following changes materially:
- route decomposition status,
- benchmark governance,
- architecture ownership boundaries,
- baseline-vs-current alignment,

create a new dated repo-state truth memo instead of silently editing history.

Suggested pattern:
- `REPO_STATE_TRUTH_YYYY-MM-DD.md`

---

## 13) Conclusion

The project currently has a legitimate distinction between:

- **historical baseline truth**
- and
- **current working architecture truth observed at a given date**

The correct action is:
- preserve the baseline,
- use active contract docs for active decisions,
- use this memo as a reconciliation layer for the dated 2026-03-18 state,
- and use `SOURCE_OF_TRUTH_RULES.md` for truth precedence.

Current active conclusion of this historical memo:

> `route.ts` was not yet boundary-only.  
> Safe decomposition remained planned work.  
> Single-flow authority had to remain in Context Engine.  
> Historical baseline must not be mistaken for current architecture truth.

---

End of file.