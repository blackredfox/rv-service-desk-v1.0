# ADR: Step Guidance Without Diagnostic Advancement

**Status:** Proposed  
**Date:** 2026-04-01  
**Task:** Step 8A — Guidance responses without diagnostic advancement

---

## 1) Problem

RV Service Desk must answer clarification and help questions about the **current active diagnostic step** more flexibly, including:
- how to perform the check,
- what a measurement means,
- where to look,
- what connector / fuse / part is being referenced,
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

Introduce a dedicated interaction / response class named:

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
- allow explanation text to count as diagnostic evidence by itself.

---

## 4) Interaction Contract

### 4.1 What `STEP_GUIDANCE` is for

Use `STEP_GUIDANCE` when the technician is asking for clarification or execution help about the **current active step**, for example:
- how to perform the current check,
- where the referenced part / fuse / connector is,
- what tool or measurement point is meant,
- what result to look for,
- what the expected reading means,
- how to perform the current check safely within approved procedure boundaries.

The response may:
- explain the current step more clearly,
- restate the current step in technician-friendly wording,
- give short, safe, procedure-aligned guidance,
- clarify the meaning of the current measurement or observation,
- help the technician find the referenced component **only as needed for the current step**.

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

### 8.2 Canonical continuation patterns

The following canonical server-owned patterns are approved:

#### English
`We are still on this step. After you perform that check, tell me exactly what you found.`

#### Russian
`Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.`

#### Spanish
`Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.`

### 8.3 Canonical-function requirements

If later implementation allows controlled wording variants, they must preserve the same function:
- remain on the current step,
- no advancement,
- ask for findings,
- preserve session language.

Behavior-contract tests should treat these continuation patterns as **server-owned contract behavior**, while still preferring functional assertions over incidental wording when exact wording is not required by parsing or policy.

---

## 9) Relationship to Existing Doctrine

This ADR is a direct extension of existing project doctrine:

### 9.1 Behavior-contract testing doctrine

Per `docs/TEST_STRATEGY_QA_CONTRACT.md`, tests should protect the actual contract here:
- support does not equal progress,
- active-step guidance does not close the step,
- no unauthorized transition occurs,
- no final-output drift occurs,
- language consistency is preserved,
- authoritative state remains server-owned.

### 9.2 Procedure-as-law / approved procedure boundaries

Per `PROJECT_MEMORY.md` and `ARCHITECTURE_RULES.md`, procedure is law.

`STEP_GUIDANCE` is allowed only as bounded explanation of the active approved step. It must not invent steps, improvise alternate diagnostics, or teach outside the approved procedure.

### 9.3 Server-side authority over state

Per `ARCHITECTURE_RULES.md`, `AI_RUNTIME_ARCHITECTURE.md`, and `PROMPT_MENTOR_CONTRACT.md`:
- Context Engine / server runtime owns diagnostic flow authority,
- prompt / LLM layer delivers wording,
- prompt / LLM layer does not own completion or advancement decisions.

### 9.4 Avoidance of silent completion / silent advancement

Per benchmark and QA doctrine, the following remain failures:
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
- stronger multilingual consistency after help exchanges.

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

## 11) Implementation-Ready Wiring Plan (Step 8B Addendum)

This section translates the Step 8A contract into a narrow runtime wiring plan for a later implementation PR.

This is still design only.
It defines intended runtime ownership, detection boundaries, response-class handling, and minimum validation expectations without changing code, prompts, procedures, or tests in this PR.

### 11.1 Entry conditions: what should count as `STEP_GUIDANCE`

The runtime should recognize `STEP_GUIDANCE` only when the technician is asking for explanation or execution help about the **currently active step** without supplying completion evidence for that step.

At minimum, the detection contract must cover requests such as:
- how to perform the current check,
- what a measurement means,
- where to look,
- what part / connector / fuse / terminal is being referenced,
- what the current active step is asking for,
- clarification of wording, tool point, expected reading, or safe execution of the current step.

The later implementation should treat the following as required **non-guidance exclusions**:
- actual findings or results,
- completion confirmations,
- explicit mode-switch requests,
- unrelated new diagnostics,
- messages that introduce a new fault path rather than clarifying the active step.

Operationally, this means `STEP_GUIDANCE` should be entered only for **current-step clarification intent**.
If a message includes actual findings, indicates the check was performed, or requests a different diagnostic direction, the request must stay on the normal server-controlled diagnostic path rather than the guidance path.

Where mixed intent is ambiguous, the future implementation should resolve narrowly in favor of **no hidden advancement**:
- either classify as standard diagnostic input,
- or ask for clarification,
- but do not treat a mixed message as pure `STEP_GUIDANCE` if it contains possible evidence.

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

The design intent is explicit:
`STEP_GUIDANCE` is not a special conversational exemption from server authority.
It is a bounded explanation path inside the same authority model.

### 11.3 Expected runtime flow

The intended high-level runtime sequence for a future implementation is:

1. detect a `STEP_GUIDANCE`-type request,
2. verify that the request is about the currently active step and does not contain completion evidence,
3. anchor the request to the active step, active branch, active procedure, and current session language,
4. invoke the LLM only for bounded explanation of that active step,
5. validate the generated output against `STEP_GUIDANCE` constraints,
6. append or otherwise enforce the server-owned continuation in EN / RU / ES,
7. return the response while preserving the same active step and same mode,
8. await technician findings before any completion or progression logic runs.

This flow is intentionally narrow.
The future implementation should not generalize it into free-form mentoring, off-procedure assistance, or implicit branch selection.

### 11.4 LLM responsibility vs server responsibility

The LLM may:
- explain the current step,
- restate the step in clearer technician-facing language,
- clarify what measurement, connector, fuse, terminal, or observation is being referenced,
- explain what result to look for,
- keep the explanation in the session language.

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

This boundary must stay clean in the future code PR:
the LLM explains; the server decides state.

### 11.5 Multilingual continuation handling (EN / RU / ES)

The future implementation must preserve the session language already established for the case.

For `STEP_GUIDANCE`, continuation selection should therefore be server-owned and language-keyed:
- English session -> English continuation,
- Russian session -> Russian continuation,
- Spanish session -> Spanish continuation.

The continuation must remain functionally stable across all three languages.
The translated wording may differ naturally, but the server-owned semantics must remain identical:
- still on the same step,
- no advancement,
- ask the technician to perform the check if needed,
- request actual findings,
- keep procedure scope bounded.

The implementation must not allow translation drift to change meaning, for example by accidentally implying:
- that the step is already complete,
- that the system has moved on,
- that a mode transition has occurred,
- that the technician should start a new unrelated diagnostic path.

The canonical EN / RU / ES continuations in Section 8 remain the contract baseline for this later wiring work.

### 11.6 Output constraints for `STEP_GUIDANCE`

The runtime response-class contract for `STEP_GUIDANCE` must reject or prevent outputs that contain any of the following:
- final-report structure,
- authorization structure,
- completion declarations,
- next-step advancement language,
- hidden branch drift,
- unrelated diagnostic expansion,
- language that treats explanation as proof the check was performed.

The response should stay explanation-first but scope-bounded.
It may be helpful and technician-friendly, but it must remain visibly subordinate to the active step and must end in a same-step continuation path rather than progression language.

### 11.7 Future implementation touchpoints

The later runtime PR will likely need to touch a small number of runtime surfaces at a high level:
- route / orchestration layer,
- current-step clarification detection,
- response-class handling for `STEP_GUIDANCE`,
- output validation / repair / rejection behavior,
- multilingual continuation injection or equivalent continuation enforcement,
- evaluation / regression coverage for no-advance behavior.

These are touchpoints only, not implementation instructions.
The design goal is to keep the future PR narrow and auditable.

### 11.8 Minimum test plan for the future implementation PR

At minimum, the later code PR must add tests proving all of the following:
- a help request does not advance state,
- same-step anchoring is preserved before and after the response,
- EN continuation is correct in function,
- RU continuation is correct in function,
- ES continuation is correct in function,
- no completion drift occurs,
- no mode switch occurs,
- no final-report drift occurs,
- no authorization drift occurs,
- unrelated branch drift does not occur.

These tests should primarily validate behavior-contract outcomes rather than brittle wording, except where fixed canonical continuation text or parser-sensitive wording is intentionally part of the contract.

### 11.9 Rollout and risk plan for the future implementation PR

Rollout should start narrow:
- only current-step clarification,
- only within approved procedure scope,
- no general free-form help expansion,
- no mixed authority between LLM and server.

Risk handling should follow these rules:
- do not generalize `STEP_GUIDANCE` to all free-form assistance,
- keep procedure scope strict,
- verify behavior on real clarification examples,
- treat any hidden advancement, hidden completion, mode drift, or report drift as an authority defect rather than a wording issue.

The later implementation should be considered unsafe if it makes guidance feel more natural by weakening state authority.

---

## 12) Final Rule

> `STEP_GUIDANCE` may improve clarity for the current step.  
> It must never become a hidden advancement mechanism.