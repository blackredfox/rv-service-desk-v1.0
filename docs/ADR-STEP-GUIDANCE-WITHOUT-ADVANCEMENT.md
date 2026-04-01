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

## 11) Follow-up Implementation Notes

If/when runtime work is done later, the implementation should ensure:
- `STEP_GUIDANCE` is represented as a distinct interaction class,
- the server preserves the same `activeStepId` before and after the response,
- no completion / isolation / mode flags mutate from guidance alone,
- the server-owned continuation is appended or otherwise enforced in EN / RU / ES,
- behavior-contract tests verify no-advancement semantics, not merely helpful wording.

---

## 12) Final Rule

> `STEP_GUIDANCE` may improve clarity for the current step.  
> It must never become a hidden advancement mechanism.