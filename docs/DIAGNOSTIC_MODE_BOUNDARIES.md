# DIAGNOSTIC_MODE_BOUNDARIES.md

**Version:** 1.0  
**Status:** Active doctrine alignment note (supports `PROJECT_MEMORY.md`)  
**Last updated:** 2026-04-15

---

## 1) Purpose

This document resolves the doctrine contradictions around:
- Diagnostic mode boundaries,
- server-vs-LLM responsibility split,
- final-output surface separation,
- runtime files that must be updated in the follow-up implementation PR.

This file is a **doctrine / architecture clarification only**.
It does **not** authorize runtime implementation changes by itself.

`PROJECT_MEMORY.md` remains the L1 product authority.
This document clarifies the L2 architecture/doctrine boundary that the next runtime PR must implement.

---

## 2) Canonical Answers

### 2.1 Is Diagnostic mode server-scripted or server-bounded?

**Canonical answer:** Diagnostic mode is **server-bounded, not server-scripted**.

Meaning:
- server/runtime enforces truth, safety, legality, state, and procedure boundaries,
- the LLM speaks naturally inside that active legal state,
- the server may constrain content,
- the server should not over-author ordinary diagnostic wording unless a deterministic fallback or legality path explicitly requires it.

### 2.2 Are `System / Classification / Mode / Status / Step` mandatory assistant speech format?

**Canonical answer:** No.

Those labels are **runtime metadata / prompt grounding**, not mandatory spoken output.

They may appear only when:
- the server intentionally renders a deterministic fallback, or
- a bounded operational path explicitly requires those labels.

They are **not** the default required shape of normal diagnostic dialogue.

### 2.3 Is there one final output format or two?

**Canonical answer:** There are **multiple final-output contracts**.

At minimum, these are distinct and must not be conflated:

1. **Portal Cause**
   - Purpose: portal / customer-facing cause narrative.
   - Shape: single English block, no section headers, no numbering, paragraph order fixed by contract.
   - Allowed only when the server authorizes that surface.
   - Canonical now at the doctrine level.
   - Dedicated prompt-path/runtime enforcement is intentionally deferred to the next implementation PR.

2. **Shop Final Report**
   - Purpose: shop-service final report for internal/service-record use.
   - Shape: sectioned service report with fixed headers.
   - Allowed only when the server authorizes the shop final-report surface.

Related clarification:
- **Authorization-ready output** remains a separate approval-safe surface.
- Portal Cause and Shop Final Report are **different output surfaces**, not two wording variants of one response contract.
- They also are **not** ordinary Diagnostic-mode replies.
- Future readers must not assume Portal Cause already exists as a fully separate runtime prompt path in the current implementation.

### 2.4 Where do restricted wording rules apply?

The restricted wording list
`broken / failed / defective / bad / damaged / worn / misadjusted / leaking`
applies **strictly** to:
- authorization-ready output,
- Portal Cause output,
- Shop Final Report output,
- other warranty / reviewer-facing formal text.

It does **not** operate as a blanket ban on ordinary diagnostic dialogue.

Diagnostic dialogue rules instead are:
- stay factual,
- stay grounded,
- do not invent conclusions,
- do not overstate certainty,
- do not let warranty-safe phrasing turn the dialogue into bureaucratic sludge.

### 2.5 Exact responsibility split

#### Server / runtime owns
- RV-service domain boundary
- active system / equipment family / procedure routing
- active step / branch / completion state
- truth boundaries
- safety boundaries
- report / authorization legality
- no invented facts
- no premature final output
- final-output surface selection

#### LLM owns
- natural diagnostic phrasing
- concise senior-tech tone
- bounded same-step questions
- short same-step clarification / locate / identify / how-to support
- grounded summaries and report drafting using only allowed facts and the selected legal surface

### 2.5a Approved aliases stance (current deliberate product decision)

The current doctrine accepts:
- explicit commands, and
- approved natural-language aliases

as valid server-owned transition triggers.

This is a deliberate current product stance, not an accidental wording looseness.
It may be revisited later if runtime fidelity to the customer/baseline contract proves weaker than expected.

### 2.6 Canonical final-output file ownership

| Output surface | Purpose | Allowed when | Defining files |
|---|---|---|---|
| Portal Cause | portal/customer-facing cause narrative | server-authorized portal/cause path only | `PROJECT_MEMORY.md`, this doctrine doc; runtime enforcement to be added in next PR |
| Shop Final Report | shop-service final report | server-authorized `final_report` path only | `PROJECT_MEMORY.md`, `README.md`, `prompts/modes/MODE_PROMPT_FINAL_REPORT.txt` |
| Authorization-ready output | approval-safe authorization request | server-authorized `authorization` path only | `PROJECT_MEMORY.md`, `prompts/modes/MODE_PROMPT_AUTHORIZATION.txt` |

---

## 3) Runtime Follow-Up File Map (Next PR)

### 3.1 Must-change

| File | Responsibility bucket | Why it must change |
|---|---|---|
| `src/app/api/chat/route.ts` | route / output orchestration | Currently contains output-surface routing, completion-offer wording, and final-report transition behavior that still mixes doctrine, prompt assumptions, and server-authored response text. Must separate Diagnostic dialogue boundaries from formal output-surface selection. |
| `src/lib/chat/chat-mode-resolver.ts` | route / output orchestration | Current resolver reasons in terms of modes only. Next PR must distinguish mode from output surface where applicable, especially Portal Cause vs Shop Final Report. |
| `src/lib/chat/report-intent.ts` | route / output orchestration | Current allow-list detects report requests but does not express the clarified output-surface split. Must map approved intents to the correct legal surface without semantic drift. |
| `src/lib/prompt-composer.ts` | prompt assembly | Current composition model assumes one prompt per mode. Next PR must support the clarified surface contract without collapsing Portal Cause and Shop Final Report together. |
| `src/lib/chat/prompt-context-builder.ts` | prompt assembly | Must pass the resolved legal surface and boundary instructions cleanly into prompt assembly instead of relying on mode-only composition. |
| `src/lib/chat/output-policy.ts` | response shaping | Current fallbacks and authoritative text helpers encode shop-report assumptions and deterministic wording. Must align fallback/shaping logic to the clarified surface split and the server-bounded diagnostic doctrine. |
| `src/lib/chat/response-validation-service.ts` | validator / retry | Current validation/retry pipeline assumes the existing mode-only contract. Must validate the right surface and stop forcing final-output assumptions onto diagnostic turns. |
| `src/lib/mode-validators.ts` | validator / retry | Current validators still reflect older over-rigid doctrine, including diagnostic wording restrictions that belong to formal outputs only. Must be split / narrowed by legal surface. |
| `src/lib/output-validator.ts` | validator / retry | Legacy validation language still conflates final-report state with Cause-style formatting. Must be reconciled with the canonical Portal Cause vs Shop Final Report split. |
| `src/lib/eval/rvsd-contract-check.ts` | validator / retry / contract-check | The evaluation contract currently reasons by runtime mode only. It must gain explicit surface-aware contract coverage so doctrine and evaluation no longer disagree. |

### 3.2 Maybe-change

| File | Responsibility bucket | Why it may need change |
|---|---|---|
| `src/lib/context-engine/context-engine.ts` | state / legality enforcement | Core flow authority should remain intact, but next PR may need an explicit runtime marker for allowed output surface / completion summary legality so route logic stops inferring around it. |
| `src/lib/chat/final-report-flow-service.ts` | response shaping | May need a separate flow service or renamed responsibility once Shop Final Report is no longer the only formal final-output path. |
| `src/lib/fact-pack.ts` | state / legality enforcement | May need surface-specific authority fact shaping so Portal Cause and Shop Final Report draw from the same truth source without collapsing into one wording contract. |
| `src/lib/chat/repair-summary-intent.ts` | route / output orchestration | May need to distinguish “enough facts for Portal Cause” vs “enough facts for Shop Final Report” depending on the selected legal surface. |
| `src/lib/chat/final-report-service.ts` | response shaping | May need surface-specific correction instructions / fallback wording if it currently assumes only sectioned final reports. |

### 3.3 Should-not-change

| File | Why it should not change in the follow-up doctrinal implementation |
|---|---|
| `src/lib/diagnostic-registry.ts` | Procedure catalog / registry data is not the root contradiction here. |
| `src/lib/diagnostic-procedures.ts` | Equipment procedures are not the doctrine problem being solved. |
| procedure definition files under `src/lib/procedures/*` | Procedure content should stay stable while output-surface/runtime boundaries are corrected. |
| unrelated API routes outside `src/app/api/chat/route.ts` | This doctrine issue is isolated to chat runtime boundaries. |

---

## 4) Implementation Guardrail For The Next PR

The next PR must:
- implement the doctrine in runtime,
- keep the Context Engine as the only diagnostic-flow authority,
- separate Portal Cause from Shop Final Report explicitly,
- narrow wording restrictions to the correct formal surfaces,
- preserve server legality enforcement without turning Diagnostic mode into server-scripted boilerplate.

The next PR must **not** solve the doctrine problem by:
- hardcoding more canned diagnostic prose,
- adding another hidden route-side state machine,
- letting the LLM choose the output surface,
- or collapsing all final outputs back into one prompt contract.

---

End of file.