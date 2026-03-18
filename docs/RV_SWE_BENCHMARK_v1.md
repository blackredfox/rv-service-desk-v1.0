# RV Service Desk
## RV_SWE_BENCHMARK_v1.md

**Version:** 1.0  
**Status:** Initial Benchmark Specification  
**Purpose:** Behavioral evaluation framework for RV Service Desk diagnostic, transition, and output correctness.

**Last updated:** 2026-03-18

---

## 1) Purpose

`RV_SWE_BENCHMARK_v1` is the project’s contract-based evaluation framework.

It exists to verify that RV Service Desk behaves correctly as a:
- procedure-driven diagnostic engine,
- signal-aware diagnostic assistant,
- controlled authorization/report generator,
- multilingual technician-facing system.

This benchmark is **not** a generic chat quality score.

It is designed to catch:
- procedure violations,
- state/transition failures,
- signal-ignoring behavior,
- output contract violations,
- language drift,
- regression after refactors.

---

## 2) Why This Benchmark Exists

Public benchmarks do not measure the real risks of this product.

The system must be evaluated against product contracts such as:
- procedure is law,
- no skipped prerequisites,
- no duplicate steps,
- no routine questioning after terminal state,
- no automatic mode transitions,
- report suggestion without auto-switch,
- diagnostic dialogue must stay in technician language,
- final outputs must follow the defined English-first + translation contract.

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
- produces contract-valid outputs.

A response can sound fluent and still fail.

---

## 4) Benchmark Scope

This benchmark evaluates:

- diagnostic dialogue behavior,
- branch logic,
- terminal-state behavior,
- report-readiness behavior,
- final-output contract compliance,
- multilingual consistency,
- regression resistance.

This benchmark does **not** attempt to score:
- style preferences,
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
- system suggests correct next action,
- no illegal auto-transition,
- no unnecessary continued diagnostics after report-ready state,
- explicit mode command boundary is preserved.

### L5 — Output Contract Compliance
Checks:
- correct diagnostic response shape,
- one-question discipline,
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

Representative real failures:
- repeated `wh_6a` ignition branch loop :contentReference[oaicite:3]{index=3}
- repeated `Step 7` loop in water heater electrical path :contentReference[oaicite:4]{index=4}

### F3 — Signal Ignored
Triggered when the system:
- receives a critical abnormal signal,
- but continues with a less relevant generic checklist question,
- instead of entering the causally relevant sub-branch.

Representative real failure:
- no 12V established, but questioning continues in broader flow instead of finishing the electrical source path cleanly. :contentReference[oaicite:5]{index=5}

### F4 — Wrong Branch Priority
Triggered when multiple valid branches exist and the system chooses the wrong one relative to the latest verified abnormal condition.

### F5 — Terminal-State Failure
Triggered when the system:
- fails to stop after isolation is sufficient,
- continues routine questioning after terminal state,
- reopens a closed branch without valid new evidence,
- forgets terminal state after labor/report interaction.

Representative real failures:
- continues after “после восстановления проводки водонагреватель работает” instead of moving to report-ready behavior :contentReference[oaicite:6]{index=6}
- after direct-power water pump isolation, returns to diagnostic questioning after labor confirmation flow :contentReference[oaicite:7]{index=7}

### F6 — Report Transition Failure
Triggered when the system:
- fails to recognize report-ready state,
- continues diagnostics when report suggestion is appropriate,
- auto-switches illegally,
- or mishandles explicit report request.

Representative real failures:
- technician asks to generate report after successful repair, but system returns to diagnostics instead of honoring report-ready state / explicit command boundary cleanly :contentReference[oaicite:8]{index=8}
- report/labor interaction falls back into diagnostic questioning instead of staying in report flow :contentReference[oaicite:9]{index=9}

### F7 — Cause / Recommendation Error
Triggered when the system:
- recommends the wrong repair,
- overstates certainty,
- attributes cause to the wrong failure point,
- recommends replacement despite evidence pointing elsewhere.

Representative real failures:
- toilet fan works from 12V source but system still recommends replacing the fan instead of isolating the supply/control path :contentReference[oaicite:10]{index=10}
- roof AC case concludes wrong component narrative after contradictory evidence and then re-enters questioning :contentReference[oaicite:11]{index=11}

### F8 — Clarification / Support Subflow Failure
Triggered when the system:
- treats “how to check / where is it / explain” as step completion,
- fails to return to the active step after clarification,
- loses the active branch after support.

Representative good/needed behavior reference:
- “Как проверить?” should provide bounded explanation, then return to the active step. :contentReference[oaicite:12]{index=12}

### F9 — Output Contract Violation
Triggered when the system:
- asks multiple questions in one diagnostic response,
- outputs report content in the wrong mode,
- misses translation separator in final output,
- violates expected format.

Representative evidence from failing tests:
- validator failures for multiple questions, missing translation separator, wrong diagnostic language handling, and format mismatches. :contentReference[oaicite:13]{index=13} :contentReference[oaicite:14]{index=14}

### F10 — Language Drift
Triggered when the system:
- changes diagnostic language mid-session without explicit request,
- mixes RU/EN/ES inside diagnostics,
- answers in the wrong language for the session,
- emits English output inside diagnostic mode where technician-language dialogue is required.

Representative real failures:
- RU diagnostic session suddenly emits English diagnostic question lines :contentReference[oaicite:15]{index=15}
- RU session mixes Russian and English labor/report interaction incorrectly :contentReference[oaicite:16]{index=16}
- EN complaint receives RU steps or mixed-language pathing in AC case :contentReference[oaicite:17]{index=17}

### F11 — State / Memory Loss
Triggered when the system:
- forgets the active system,
- forgets already confirmed facts,
- resets to earlier steps,
- asks what system is being diagnosed after it was already established.

Representative real failure:
- water pump case loses procedure memory and asks which RV system is being diagnosed. :contentReference[oaicite:18]{index=18}

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

### 7.2 Pass Rule
A case is PASS only if:
- required flow is followed,
- no critical failure occurs,
- final state matches expected benchmark result.

### 7.3 Severity
For prioritization, failures are tagged:
- **P0** = safety / flow-authority / report-boundary / language-lock failures
- **P1** = major diagnostic correctness failures
- **P2** = clarity/style defects that do not violate core contract

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

## 9) Case Matrix (v1 seed set)

This v1 matrix intentionally mixes:
- real failure cases,
- a few positive-reference cases,
- multilingual cases,
- transition cases.

### 9.1 Water Heater Cases

#### Case 01 — Water heater / no 12V / loop after critical signal
- **System:** Water heater
- **Language:** RU
- **Target:** L2, L3
- **Expected:** after “нет 12 В” the system should stay in the electrical source path and avoid irrelevant continuation
- **Forbidden:** continue generic downstream steps while critical source-power issue is unresolved
- **Likely failure class:** F3, F4
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:19]{index=19}

#### Case 02 — Water heater / repeated Step 7 electrical loop
- **System:** Water heater
- **Language:** RU
- **Target:** L1, L3
- **Expected:** progress through source-path isolation without step spam
- **Forbidden:** repeated `wh_7` variants with no state advancement
- **Likely failure class:** F2
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:20]{index=20}

#### Case 03 — Water heater / repaired wiring / should become report-ready
- **System:** Water heater
- **Language:** RU
- **Target:** L3, L4
- **Expected:** once wiring restored and heater works, stop diagnostics and suggest/report next step
- **Forbidden:** continue routine diagnostic questioning
- **Likely failure class:** F5, F6
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:21]{index=21}

#### Case 04 — Water heater / technician explicitly asks for report after repair
- **System:** Water heater
- **Language:** RU
- **Target:** L4
- **Expected:** respect report-ready state and explicit report intent boundary
- **Forbidden:** jump back to earlier diagnostic step
- **Likely failure class:** F6
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:22]{index=22}

#### Case 05 — Water heater / no power path / wrong report timing
- **System:** Gas heater
- **Language:** RU
- **Target:** L4, L5
- **Expected:** no final report unless allowed state truly reached
- **Forbidden:** report generation with incomplete/unstable isolation logic
- **Likely failure class:** F6, F7
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:23]{index=23}

#### Case 06 — Water heater / repetitive LP/ignition questioning
- **System:** Water heater
- **Language:** RU
- **Target:** L1, L2
- **Expected:** procedure should not drift or repeat with low-value variants
- **Forbidden:** repetitive question variants after fact already established
- **Likely failure class:** F2
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:24]{index=24}

#### Case 07 — Water heater / thermocouple path / measurement confusion
- **System:** Water heater
- **Language:** RU
- **Target:** L2, L3
- **Expected:** once thermocouple is visibly burned/damaged and not properly seated, branch logic should converge
- **Forbidden:** repeated millivolt measurement demand after technician states they do not perform that measurement
- **Likely failure class:** F2, F4
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:25]{index=25}

### 9.2 Water Pump Cases

#### Case 08 — Water pump / direct 12V fail / proper report suggestion reference
- **System:** Water pump
- **Language:** RU
- **Target:** L3, L4
- **Expected:** direct 12V fail should permit completion and report suggestion
- **Forbidden:** continued unnecessary questioning
- **Likely failure class:** none in ideal path
- **Expected result:** PASS reference
- **Source:** :contentReference[oaicite:26]{index=26}

#### Case 09 — Water pump / labor flow returns to diagnostics
- **System:** Water pump
- **Language:** RU
- **Target:** L4
- **Expected:** after labor clarification, remain in report flow
- **Forbidden:** restart diagnostics at step 1
- **Likely failure class:** F5, F6
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:27]{index=27}

#### Case 10 — Water pump / wrong labor adjustment persistence
- **System:** Water pump
- **Language:** RU
- **Target:** L4, L5
- **Expected:** accepted labor override should remain stable
- **Forbidden:** replace user-entered labor with different draft and stay outside final report path
- **Likely failure class:** F6, F9
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:28]{index=28}

#### Case 11 — Water pump / language drift + memory loss in diagnostic loop
- **System:** Water pump
- **Language:** RU
- **Target:** L3, L6
- **Expected:** remain in RU, preserve known facts, do not re-ask first question after clear isolation evidence
- **Forbidden:** switch to English or forget active system
- **Likely failure class:** F10, F11
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:29]{index=29}

#### Case 12 — Water pump / wrong generic procedure with low-value checks
- **System:** Pump
- **Language:** mixed RU/EN
- **Target:** L1, L2
- **Expected:** use correct RV-equivalent direct-power diagnostic path
- **Forbidden:** generic low-value checks like clogs/leaks after direct-power evidence dominates
- **Likely failure class:** F1, F4
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:30]{index=30}

### 9.3 Ceiling Fan Cases

#### Case 13 — Ceiling fan / direct-power fail / insurance report path
- **System:** Ceiling fan
- **Language:** RU
- **Target:** L4, L5
- **Expected:** if direct-power fail already established, report generation should be bounded and contract-valid
- **Forbidden:** unstable transition mode chatter or translation confusion
- **Likely failure class:** F5, F9
- **Expected result:** mixed reference / needs normalization
- **Source:** :contentReference[oaicite:31]{index=31}

#### Case 14 — Ceiling fan / “how to check” clarification branch
- **System:** Ceiling fan
- **Language:** RU
- **Target:** L3
- **Expected:** answer “Как проверить?” briefly, then return to active step
- **Forbidden:** close step from clarification alone or lose branch context
- **Likely failure class:** F8
- **Expected result:** mixed reference
- **Source:** :contentReference[oaicite:32]{index=32}

#### Case 15 — Ceiling fan / contradictory evidence after direct-power fail
- **System:** Ceiling fan
- **Language:** RU
- **Target:** L3, L4
- **Expected:** if new evidence contradicts prior conclusion, system must replan cleanly
- **Forbidden:** claim motor works after direct-power fail without resolving contradiction; bounce between replacement and control-circuit narratives
- **Likely failure class:** F5, F7, F11
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:33]{index=33}

#### Case 16 — Toilet fan / works on 12V source / should not recommend replacement
- **System:** Ceiling fan / toilet vent fan
- **Language:** RU
- **Target:** L2, L3
- **Expected:** if fan works on alternate 12V source, isolate supply/control path
- **Forbidden:** recommend complete fan replacement
- **Likely failure class:** F7
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:34]{index=34}

### 9.4 Roof AC / Complex System Cases

#### Case 17 — Roof AC / direct fan motor power works / wiring continuity fault path
- **System:** Roof AC
- **Language:** RU
- **Target:** L2, L3
- **Expected:** if direct power makes motor run, do not recommend motor replacement; isolate wiring/control path
- **Forbidden:** wrong unit-level recommendation before correct branch exhausted
- **Likely failure class:** F4, F7
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:35]{index=35}

#### Case 18 — Roof AC / post-completion contradiction after new evidence
- **System:** Bedroom AC
- **Language:** mixed EN/RU
- **Target:** L3, L6
- **Expected:** new evidence after completion must trigger controlled replan
- **Forbidden:** ignore contradiction, keep old completion, then continue random next step
- **Likely failure class:** F5, F10, F11
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:36]{index=36}

#### Case 19 — Roof AC / EN session with mixed RU responses
- **System:** Bedroom AC
- **Language:** EN session
- **Target:** L6
- **Expected:** stay in EN diagnostics unless user explicitly changes language
- **Forbidden:** RU step text in EN session
- **Likely failure class:** F10
- **Expected result:** FAIL reference
- **Source:** :contentReference[oaicite:37]{index=37}

### 9.5 Multilingual / Output Contract Cases

#### Case 20 — ES water pump / positive multilingual reference
- **System:** Water pump
- **Language:** ES
- **Target:** L4, L5, L6
- **Expected:** diagnostic in ES, then valid English-first report with translation block
- **Forbidden:** wrong-language drift before final output or malformed translation behavior
- **Likely failure class:** none in ideal path
- **Expected result:** PASS reference
- **Source:** :contentReference[oaicite:38]{index=38}

---

## 10) Coverage Map by Failure Class

- **F1 Procedure Violation:** Cases 12
- **F2 Duplicate Step / Loop:** Cases 01, 02, 06, 07
- **F3 Signal Ignored:** Case 01
- **F4 Wrong Branch Priority:** Cases 01, 07, 12, 17
- **F5 Terminal-State Failure:** Cases 03, 09, 13, 15, 18
- **F6 Report Transition Failure:** Cases 03, 04, 05, 09, 10
- **F7 Cause / Recommendation Error:** Cases 05, 15, 16, 17
- **F8 Clarification / Support Subflow Failure:** Case 14
- **F9 Output Contract Violation:** Cases 10, 13 plus validator suite references
- **F10 Language Drift:** Cases 11, 19, 20 reference boundary, plus dedicated test artifacts
- **F11 State / Memory Loss:** Cases 11, 15, 18

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
- count of transition failures.

Suggested reporting:
- overall pass rate,
- P0 pass rate,
- regression delta vs previous branch.

---

## 13) Future Expansion

Planned future additions:
- more multilingual cases,
- more “how to check / where is it” cases,
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