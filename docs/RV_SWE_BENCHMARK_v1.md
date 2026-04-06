# RV Service Desk
## RV_SWE_BENCHMARK_v1.md

**Version:** 1.1  
**Status:** Active Benchmark Specification  
**Purpose:** Behavioral evaluation framework for RV Service Desk diagnostic, transition, and output correctness.

**Last updated:** 2026-04-06

---

## 1) Purpose

`RV_SWE_BENCHMARK_v1` is the project’s contract-based evaluation framework.

It exists to verify that RV Service Desk behaves correctly as a:
- procedure-driven diagnostic engine,
- signal-aware diagnostic assistant,
- controlled authorization/report generator,
- multilingual technician-facing system,
- realistic bounded senior-tech assistant.

This benchmark is **not** a generic chat quality score.

It is designed to catch:
- procedure violations,
- state/transition failures,
- signal-ignoring behavior,
- output contract violations,
- language drift,
- dirty-input failures,
- robotic guidance failures,
- regression after refactors.

---

## 2) Why This Benchmark Exists

Public benchmarks do not measure the real risks of this product.

The system must be evaluated against product contracts such as:
- procedure is law,
- no skipped prerequisites,
- no duplicate steps,
- no routine questioning after terminal state,
- no uncontrolled automatic mode transitions,
- report suggestion/support without illegal auto-switch,
- natural report-intent handling must work when approved,
- diagnostic dialogue must stay in technician language,
- final outputs must follow the defined English-first + translation contract,
- current-step guidance must be helpful without becoming progress,
- dirty technician input must not collapse classification.

This benchmark turns real failures into a persistent regression asset.

---

## 3) Evaluation Philosophy

The system is evaluated by **behavior under constraints**, not by “helpfulness”.

A case passes only if the system:
- follows the approved procedure,
- reacts correctly to diagnostic signals,
- preserves state correctly,
- respects report/authorization boundaries,
- preserves language consistency,
- produces contract-valid outputs,
- handles realistic technician phrasing robustly.

A response can sound fluent and still fail.  
A response can sound concise and still fail if it is robotic, non-responsive to the actual question, or depends on brittle ritual commands.

---

## 4) Benchmark Scope

This benchmark evaluates:

- diagnostic dialogue behavior,
- branch logic,
- terminal-state behavior,
- report-readiness behavior,
- natural report-intent behavior,
- final-output contract compliance,
- multilingual consistency,
- dirty-input robustness,
- current-step locate/identify guidance,
- regression resistance.

This benchmark does **not** attempt to score:
- style preferences outside contract,
- general LLM intelligence,
- arbitrary open-ended reasoning outside project contracts.

---

## 5) Evaluation Levels

### L1 — Procedure Compliance
Checks:
- only active-procedure questions are used,
- prerequisites are respected,
- no skipped required steps,
- no invented steps,
- no cross-system drift.

### L2 — Procedure + Signal Logic
Checks:
- correct next-step selection,
- correct response to critical abnormal signals,
- signal override behavior,
- branch priority by causal relevance,
- no ignoring of newly established critical faults.

### L3 — State / Completion / Terminal Logic
Checks:
- correct completed-step handling,
- no duplicate step after completion,
- correct terminal-state recognition,
- no post-completion questioning,
- correct return from clarification/support subflow,
- correct re-entry after new evidence.

### L4 — Report Readiness / Transition Logic
Checks:
- report-ready situations are recognized,
- authorization-ready situations are recognized,
- system suggests/supports correct next action,
- no illegal uncontrolled auto-transition,
- no unnecessary continued diagnostics after report-ready state,
- approved natural report-intent handling works correctly.

### L5 — Output Contract Compliance
Checks:
- correct diagnostic response shape,
- one-question discipline where required,
- correct final report structure,
- correct translation block behavior,
- no forbidden formatting drift,
- no wrong-mode output generation.

### L6 — Language Consistency
Checks:
- diagnostic dialogue remains in technician language,
- no language switching across turns without explicit request,
- no mixed-language diagnostics,
- report output follows English-first + translation rules only in allowed modes.

### L7 — Technician Interaction Realism
Checks:
- current-step locate questions are actually answered,
- identify/fuse/terminal questions are not answered with repeated generic measurement text,
- system does not require brittle magic-phrase-only behavior in approved report-ready cases,
- bounded collaborative phrasing is allowed,
- robotic form behavior that blocks workflow is treated as a failure when it violates the contract.

### L8 — Dirty Input Robustness
Checks:
- mixed-language complaint/findings input is interpreted correctly,
- typo-heavy or keyboard-corrupted text does not misclassify the system,
- report request embedded in noisy field notes is recognized correctly when readiness is present,
- complaint + findings + repair action in one message does not force irrelevant diagnostics.

---

## 6) Failure Taxonomy

### F1 — Procedure Violation
Triggered when the system:
- asks a non-procedure question,
- skips prerequisites,
- invents new diagnostic steps,
- drifts into another system.

### F2 — Duplicate Step / Loop
Triggered when the system:
- re-asks a completed step,
- repeats the same step with superficial wording changes,
- gets stuck without forward progress.

### F3 — Signal Ignored
Triggered when the system:
- receives a critical abnormal signal,
- but continues with a less relevant generic checklist question,
- instead of entering the causally relevant sub-branch.

### F4 — Wrong Branch Priority
Triggered when multiple valid branches exist and the system chooses the wrong one relative to the latest verified abnormal condition.

### F5 — Terminal-State Failure
Triggered when the system:
- fails to stop after isolation is sufficient,
- continues routine questioning after terminal state,
- reopens a closed branch without valid new evidence,
- forgets terminal state after labor/report interaction.

### F6 — Report Transition Failure
Triggered when the system:
- fails to recognize report-ready state,
- continues diagnostics when report suggestion/support is appropriate,
- performs uncontrolled auto-switch,
- mishandles an explicit or approved natural report request,
- requires a magic phrase when an approved report intent path should work.

### F7 — Cause / Recommendation Error
Triggered when the system:
- recommends the wrong repair,
- overstates certainty,
- attributes cause to the wrong failure point,
- recommends replacement despite evidence pointing elsewhere.

### F8 — Clarification / Support Subflow Failure
Triggered when the system:
- treats “how to check / where is it / explain” as step completion,
- fails to return to the active step after clarification,
- loses the active branch after support,
- answers a locate/identify question with repeated generic measurement wording instead of bounded helpful guidance.

### F9 — Output Contract Violation
Triggered when the system:
- asks multiple questions in one diagnostic response when the contract requires one,
- outputs report content in the wrong mode,
- misses translation separator in final output,
- violates expected format.

### F10 — Language Drift
Triggered when the system:
- changes diagnostic language mid-session without explicit request,
- mixes RU/EN/ES inside diagnostics,
- answers in the wrong language for the session,
- emits English output inside diagnostic mode where technician-language dialogue is required.

### F11 — State / Memory Loss
Triggered when the system:
- forgets the active system,
- forgets already confirmed facts,
- resets to earlier steps,
- asks what system is being diagnosed after it was already established.

### F12 — Natural Intent Recognition Failure
Triggered when the system:
- fails to honor an approved natural-language report/authorization request,
- requires an exact incantation despite readiness + approved intent alias,
- restarts diagnostics instead of moving into the correct allowed transition behavior.

### F13 — Dirty Input Parsing / Classification Failure
Triggered when the system:
- misclassifies the system on noisy/mixed technician input,
- ignores already supplied complaint/findings/repair summary,
- fails to detect report/help intent in realistic field notes,
- routes to an irrelevant system or procedure.

### F14 — Robotic Interaction Failure
Triggered when the system:
- behaves like a rigid status/form screen instead of a bounded senior-tech assistant,
- defaults to bureaucratic repeated banners when a concise natural phrasing is allowed,
- blocks workflow through unnecessary ritual command friction,
- repeatedly restates the same step without answering the actual current-step question.

This is not a “style preference” category.
It is a product failure only when the robotic behavior breaches the documented technician UX contract.

---

## 7) Pass / Fail Rules

### 7.1 Hard Fail Rule
A case is FAIL if **any** critical contract breach occurs.

Critical failures include:
- F1 Procedure Violation
- F2 Duplicate Step / Loop
- F3 Signal Ignored
- F5 Terminal-State Failure
- F6 Report Transition Failure
- F7 Cause / Recommendation Error
- F9 Output Contract Violation
- F10 Language Drift
- F11 State / Memory Loss
- F12 Natural Intent Recognition Failure
- F13 Dirty Input Parsing / Classification Failure

### 7.2 Pass Rule
A case is PASS only if:
- required flow is followed,
- no critical failure occurs,
- final state matches expected benchmark result.

### 7.3 Severity
For prioritization, failures are tagged:
- **P0** = safety / flow-authority / report-boundary / language-lock / dirty-input collapse failures
- **P1** = major diagnostic correctness failures
- **P2** = bounded interaction realism / clarity defects that do not violate a harder contract

---

## 8) Case Format

Each benchmark case should contain:

- `case_id`
- `title`
- `system`
- `language`
- `source_type` (`real_failure`, `real_pass_reference`, `synthetic`)
- `input_sequence`
- `expected_behavior`
- `forbidden_behavior`
- `target_level`
- `failure_class`
- `expected_result` (`PASS` or `FAIL`)
- `notes`

---

## 9) Case Matrix (v1 seed set + new required cases)

This v1 matrix intentionally mixes:
- real failure cases,
- a few positive-reference cases,
- multilingual cases,
- transition cases,
- dirty-input cases,
- current-step guidance cases.

### 9.1 Water Heater Cases

#### Case 01 — Water heater / no 12V / loop after critical signal
- **System:** Water heater
- **Language:** RU
- **Target:** L2, L3
- **Expected:** after “нет 12 В” the system should stay in the electrical source path and avoid irrelevant continuation
- **Forbidden:** continue generic downstream steps while critical source-power issue is unresolved
- **Likely failure class:** F3, F4
- **Expected result:** FAIL reference

#### Case 02 — Water heater / repeated electrical loop
- **System:** Water heater
- **Language:** RU
- **Target:** L1, L3
- **Expected:** progress through source-path isolation without step spam
- **Forbidden:** repeated electrical-path step variants with no state advancement
- **Likely failure class:** F2
- **Expected result:** FAIL reference

#### Case 03 — Water heater / repaired wiring / should become report-ready
- **System:** Water heater
- **Language:** RU
- **Target:** L3, L4
- **Expected:** once wiring restored and heater works, stop diagnostics and suggest/support report flow
- **Forbidden:** continue routine diagnostic questioning
- **Likely failure class:** F5, F6
- **Expected result:** FAIL reference

#### Case 04 — Water heater / technician explicitly asks for report after repair
- **System:** Water heater
- **Language:** RU
- **Target:** L4
- **Expected:** respect report-ready state and approved report intent path
- **Forbidden:** jump back to earlier diagnostic step
- **Likely failure class:** F6, F12
- **Expected result:** FAIL reference

#### Case 05 — Water heater / locate help on 12V board input
- **System:** Water heater
- **Language:** RU
- **Target:** L7
- **Expected:** “How do I find 12V/B+ input?” gets bounded locate/identify guidance
- **Forbidden:** repeating the same generic measurement instruction only
- **Likely failure class:** F8, F14
- **Expected result:** FAIL reference

#### Case 06 — Water heater / locate help on Suburban fuse location
- **System:** Water heater
- **Language:** RU
- **Target:** L7
- **Expected:** “Where is the fuse on this model?” gets bounded locate/search-order guidance
- **Forbidden:** repeating the step wording only
- **Likely failure class:** F8, F14
- **Expected result:** FAIL reference

#### Case 07 — Water heater / approved natural report intent after fix
- **System:** Water heater
- **Language:** RU
- **Target:** L4, L7
- **Expected:** after “replaced fuse, heater works, write report” system moves into allowed report path
- **Forbidden:** demanding only `START FINAL REPORT`
- **Likely failure class:** F6, F12
- **Expected result:** FAIL reference

### 9.2 Water Pump Cases

#### Case 08 — Water pump / direct 12V fail / proper report suggestion reference
- **System:** Water pump
- **Language:** RU
- **Target:** L3, L4
- **Expected:** direct 12V fail should permit completion and report suggestion/support
- **Forbidden:** continued unnecessary questioning
- **Likely failure class:** none in ideal path
- **Expected result:** PASS reference

### 9.3 Dirty Input / Classification Cases

#### Case 09 — Slide water leak / mixed EN complaint + noisy RU findings + report request
- **System:** Slide / exterior trim / water leak
- **Language:** mixed EN/RU
- **Target:** L8, L4
- **Expected:** system identifies slide/water-leak repair summary and supports report generation
- **Forbidden:** misclassify as unrelated electrical/converter system
- **Likely failure class:** F13, F12
- **Expected result:** FAIL reference

#### Case 10 — Water heater / typo-heavy mixed-language complaint
- **System:** Water heater
- **Language:** mixed RU/EN
- **Target:** L8
- **Expected:** correct water-heater classification despite noisy text
- **Forbidden:** cross-system drift
- **Likely failure class:** F13, F1
- **Expected result:** synthetic / required

### 9.4 Interaction Realism Cases

#### Case 11 — Technician says “давай подумаем, в чем может быть причина?”
- **System:** varies
- **Language:** RU
- **Target:** L7
- **Expected:** concise bounded collaborative reasoning, then return to valid next step
- **Forbidden:** bureaucratic banner-only response or free-form drift outside procedure
- **Likely failure class:** F14
- **Expected result:** synthetic / required

---

## 10) Coverage Map by Failure Class

- **F1 Procedure Violation:** water-heater wrong-system or wrong-procedure cases
- **F2 Duplicate Step / Loop:** repeated electrical / step-loop cases
- **F3 Signal Ignored:** no-12V continuation failures
- **F4 Wrong Branch Priority:** wrong follow-up after critical signals
- **F5 Terminal-State Failure:** repaired-and-working but still asking more questions
- **F6 Report Transition Failure:** report-ready but not entering correct allowed flow
- **F7 Cause / Recommendation Error:** wrong repair/component recommendation
- **F8 Clarification / Support Subflow Failure:** locate/help answered badly or not returned to step correctly
- **F9 Output Contract Violation:** wrong-mode or malformed final output
- **F10 Language Drift:** mixed/incorrect session language behavior
- **F11 State / Memory Loss:** forgetting established system/facts
- **F12 Natural Intent Recognition Failure:** approved report/help intent not honored
- **F13 Dirty Input Parsing / Classification Failure:** noisy field input misrouted
- **F14 Robotic Interaction Failure:** bounded technician-UX contract violated

---

## 11) Benchmark Use Rules

### 11.1 Every Real Bug Becomes Coverage
Any newly observed failure must be converted into:
- a benchmark case,
- a regression test,
- a failure-class mapping.

### 11.2 Benchmark First for Logic Changes
Before changing:
- Context Engine flow rules,
- route decomposition,
- prompt runtime contracts,
- terminal-state behavior,
- labor/report transitions,
- natural report-intent handling,
- dirty-input normalization,
- step-guidance behavior,

the affected benchmark coverage must be identified or added.

### 11.3 No “Looks Better” Merges
A fix is not accepted because it “looks better”.
A fix is accepted when benchmark-relevant behavior improves without causing regressions.

---

## 12) Scoring (v1)

v1 uses **hard contract pass/fail**, not soft preference scoring.

Optional summary metrics:
- total cases passed,
- pass rate by evaluation level,
- pass rate by failure class,
- count of P0 failures,
- count of multilingual failures,
- count of transition failures,
- count of dirty-input failures,
- count of interaction realism failures.

---

## 13) Future Expansion

Planned future additions:
- more multilingual cases,
- more “how to check / where is it / how do I find it” cases,
- more natural report-intent cases,
- authorization-mode cases,
- final report formatting edge cases,
- state persistence / rollback / memory-loss cases,
- route decomposition architecture-preservation cases,
- UI-assisted workflow benchmark hooks for mobile flow.

---

## 14) Current Status Interpretation

This benchmark is intentionally seeded with many known failures.
That is expected.

The purpose of v1 is:
- to define the law,
- to capture the failures,
- to stop losing them,
- to make later fixes measurable.

---

End of file.