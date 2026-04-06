# ADR: Step Guidance Without Diagnostic Advancement

**Status:** Active  
**Date:** 2026-04-01  
**Updated:** 2026-04-06  
**Task:** Current-step guidance responses without diagnostic advancement

---

## 1) Problem

RV Service Desk must answer clarification and help questions about the **current active diagnostic step** more flexibly, including:
- how to perform the check,
- what a measurement means,
- where to look,
- what connector / fuse / part is being referenced,
- how to identify the correct point,
- what alternate check point is acceptable when the labeled point is unclear,
- how to verify something safely.

However, that extra flexibility must **not** let clarification behavior silently become progress behavior.

The current doctrine already says:
- procedure is law,
- Context Engine / server state is authoritative for flow,
- support does not equal progress,
- silent completion and silent advancement are defects.

This ADR makes that contract explicit for current-step help responses.

---

## 2) Decision

Introduce and formalize a dedicated interaction / response class named:

`STEP_GUIDANCE`

`STEP_GUIDANCE` is the bounded response class for **help about the currently active step**.

It exists so the LLM may explain the current step more naturally while the server remains authoritative over:
- diagnostic state,
- step completion,
- branch progression,
- isolation completion,
- mode transitions.

---

## 3) Non-goals

This ADR does **not**:
- change runtime flow logic,
- allow the LLM to choose the next step,
- redefine procedure content,
- expand support into generic off-procedure mentoring,
- redefine report / authorization mode behavior,
- allow explanation text to count as diagnostic evidence by itself,
- allow vague helpfulness to override current-step discipline.

---

## 4) Interaction Contract

### 4.1 What `STEP_GUIDANCE` is for

Use `STEP_GUIDANCE` when the technician is asking for clarification or execution help about the **current active step**, for example:
- how to perform the current check,
- where the referenced part / fuse / connector is,
- what tool or measurement point is meant,
- how to identify the referenced connector / switch / terminal,
- what result to look for,
- what the expected reading means,
- what alternate check point is acceptable for the current step,
- how to perform the current check safely within approved procedure boundaries.

The response may:
- explain the current step more clearly,
- restate the current step in technician-friendly wording,
- give short, safe, procedure-aligned guidance,
- clarify the meaning of the current measurement or observation,
- help the technician find the referenced component **only as needed for the current step**,
- use concise colleague-style phrasing when helpful.

### 4.2 What `STEP_GUIDANCE` must NOT do

A `STEP_GUIDANCE` response must **not**:
- advance diagnostic progress,
- close the current step,
- mark the current step complete,
- mark isolation complete,
- switch mode,
- emit final report structure,
- emit authorization output,
- silently branch into unrelated diagnostics,
- reinterpret a help request as proof that the step was performed,
- imply repair completion or isolation completion.

### 4.3 Evidence rule

Guidance text is **not** diagnostic evidence.

The current step remains incomplete until the technician reports actual findings or other server-approved completion evidence for that step is received.

---

## 5) Server Authority Rules

### 5.1 Server-owned progress

The server owns authoritative case state and progress, including:
- active mode,
- active procedure,
- active step,
- branch context,
- completion state,
- isolation / terminal gating.

The LLM does **not** own advancement decisions.

### 5.2 Procedure scope still governs explanation

The LLM may explain the current step more flexibly, but only within:
- the active approved procedure,
- the currently active step,
- safe, procedure-aligned explanation boundaries.

If the requested explanation would go beyond approved procedure scope, the response must stay bounded to the current step rather than inventing new diagnostic paths.

### 5.3 No silent completion / no silent advancement

`STEP_GUIDANCE` exists specifically to prevent dual meaning such as:
- “helpful explanation” being treated as “step done”,
- “clarification given” being treated as “progress made”,
- “sounds report-ready” being treated as a valid transition.

Any implementation that allows `STEP_GUIDANCE` to mutate step progress without explicit technician findings is an architecture violation.

---

## 6) Allowed Scope

`STEP_GUIDANCE` must stay within all of the following boundaries:
- the current active step,
- the current active branch,
- approved procedure context,
- safe, concise, pro-tech explanation,
- technician language consistency for the session.

It may include:
- how-to guidance,
- locate guidance,
- identify guidance,
- expected-result guidance,
- acceptable alternate check-point guidance.

It must not become:
- generic training,
- consumer DIY instruction,
- unrelated troubleshooting,
- substitute diagnosis outside the active procedure.

---

## 7) Follow-up Behavior

After a `STEP_GUIDANCE` explanation, the server must control or append a continuation that:
- keeps the case on the **same current step**,
- makes clear that the step is still active,
- asks the technician to perform the check if needed,
- asks the technician to report the actual findings,
- preserves the case language (EN / RU / ES).

This follow-up is server-owned behavior, not LLM-owned advancement behavior.

The function of the continuation is mandatory even if wording later allows narrow server-approved variants.

---

## 8) Multilingual Server-Controlled Continuation Policy

### 8.1 Canonical policy

For `STEP_GUIDANCE`, the server should append or control a continuation in the technician's language that performs all of these functions:
- re-anchor the conversation to the same active step,
- make clear that the case has **not advanced**,
- request actual findings after the technician performs the check,
- maintain language consistency.

### 8.2 Canonical continuation semantics

The continuation must preserve the following semantics:
- still on the same step,
- no advancement,
- report actual findings,
- stay in session language.

The exact wording may vary if the function remains unchanged.

### 8.3 Preferred continuation examples

#### English
`We are still on this step. After you perform that check, tell me exactly what you found.`

#### Russian
`Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.`

#### Spanish
`Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.`

These examples are preferred baselines, not the only acceptable wording, unless a specific implementation intentionally fixes them.

---

## 9) Relationship to Existing Doctrine

### 9.1 Behavior-contract testing doctrine
Tests should protect the actual contract here:
- support does not equal progress,
- active-step guidance does not close the step,
- no unauthorized transition occurs,
- no final-output drift occurs,
- language consistency is preserved,
- authoritative state remains server-owned.

### 9.2 Procedure-as-law / approved procedure boundaries
Per project memory and architecture rules, procedure is law.

`STEP_GUIDANCE` is allowed only as bounded explanation of the active approved step. It must not invent steps, improvise alternate diagnostics, or teach outside the approved procedure.

### 9.3 Server-side authority over state
Per architecture/runtime docs:
- Context Engine / server runtime owns diagnostic flow authority,
- prompt / LLM layer delivers wording,
- prompt / LLM layer does not own completion or advancement decisions.

### 9.4 Avoidance of silent completion / silent advancement
The following remain failures:
- clarification closes step implicitly,
- explanation causes branch loss,
- support answer advances progress,
- unrelated diagnostic branching appears after help,
- server fails to re-anchor to the same step.

---

## 10) Risks / Tradeoffs

### Risks reduced
- clearer separation between explanation and progression,
- lower chance of silent completion defects,
- lower chance of prompt-layer authority drift,
- stronger multilingual consistency after help exchanges,
- lower chance of robotic non-answers to locate/identify questions.

### Tradeoffs introduced
- server orchestration becomes slightly more explicit because continuation must be controlled,
- some highly natural free-form responses may be trimmed to preserve authority,
- implementations must distinguish help intent from evidence-reporting intent carefully.

### Main risk if ignored
Without this contract, a “helpful” answer can accidentally act like:
- step completion,
- branch change,
- report readiness,
- or hidden mode drift.

That would violate single-authority architecture.

---

## 11) Implementation-Ready Wiring Plan

### 11.1 Entry conditions: what should count as `STEP_GUIDANCE`

The runtime should recognize `STEP_GUIDANCE` only when the technician is asking for explanation or execution help about the **currently active step** without supplying completion evidence for that step.

At minimum, the detection contract must cover requests such as:
- how to perform the current check,
- what a measurement means,
- where to look,
- what part / connector / fuse / terminal is being referenced,
- how to identify the right point,
- what alternate point is acceptable for the same check.

The implementation should treat the following as required **non-guidance exclusions**:
- actual findings or results,
- completion confirmations,
- explicit mode-switch requests,
- unrelated new diagnostics,
- messages that introduce a new fault path rather than clarifying the active step.

### 11.2 Orchestration ownership

The server / orchestrator must remain the sole authority for all runtime behavior surrounding `STEP_GUIDANCE`.

For this interaction class, the server must own:
- current-step anchoring,
- no-advance behavior,
- no step completion,
- no branch completion,
- no mode switch,
- no final-report drift,
- no authorization drift,
- response-class enforcement,
- continuation injection or equivalent continuation control,
- output validation against the active procedure scope.

### 11.3 Expected runtime flow

The intended high-level runtime sequence is:

1. detect a `STEP_GUIDANCE`-type request,
2. verify that the request is about the currently active step and does not contain completion evidence,
3. anchor the request to the active step, active branch, active procedure, and current session language,
4. invoke the LLM only for bounded explanation of that active step,
5. validate the generated output against `STEP_GUIDANCE` constraints,
6. append or otherwise enforce the server-owned continuation in EN / RU / ES,
7. return the response while preserving the same active step and same mode,
8. await technician findings before any completion or progression logic runs.

### 11.4 LLM responsibility vs server responsibility

The LLM may:
- explain the current step,
- restate the step in clearer technician-facing language,
- clarify what measurement, connector, fuse, terminal, or observation is being referenced,
- explain what result to look for,
- keep the explanation in the session language,
- use concise collaborative phrasing if it remains bounded.

The LLM must not:
- decide advancement,
- decide that the step is complete,
- infer that guidance equals evidence,
- change branch,
- switch mode,
- emit final-report structure,
- emit authorization structure,
- broaden scope beyond the active approved procedure.

The server must:
- decide whether the message qualifies for `STEP_GUIDANCE`,
- preserve authoritative state before and after the response,
- prevent hidden completion,
- prevent hidden mode or branch drift,
- enforce same-step continuation,
- reject or repair outputs that violate the response-class contract.

### 11.5 Multilingual continuation handling (EN / RU / ES)

The implementation must preserve the session language already established for the case.

For `STEP_GUIDANCE`, continuation selection should therefore be server-owned and language-keyed:
- English session -> English continuation,
- Russian session -> Russian continuation,
- Spanish session -> Spanish continuation.

The continuation must remain functionally stable across all three languages.

### 11.6 Output constraints for `STEP_GUIDANCE`

The runtime response-class contract for `STEP_GUIDANCE` must reject or prevent outputs that contain any of the following:
- final-report structure,
- authorization structure,
- completion declarations,
- next-step advancement language,
- hidden branch drift,
- unrelated diagnostic expansion,
- language that treats explanation as proof the check was performed.

### 11.7 Minimum test plan

At minimum, the implementation must add tests proving all of the following:
- a help request does not advance state,
- same-step anchoring is preserved before and after the response,
- EN continuation is correct in function,
- RU continuation is correct in function,
- ES continuation is correct in function,
- no completion drift occurs,
- no mode switch occurs,
- no final-report drift occurs,
- no authorization drift occurs,
- unrelated branch drift does not occur,
- locate/identify questions are answered with bounded useful guidance rather than repeated generic measurement text.

---

## 12) Final Rule

> `STEP_GUIDANCE` may improve clarity for the current step.  
> It must never become a hidden advancement mechanism.

End of file.