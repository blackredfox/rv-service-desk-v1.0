# RV Service Desk
## CUSTOMER_BEHAVIOR_SPEC.md

**Status:** Canonical customer-approved behavior mirror (engineering-normalized)
**Scope:** docs-only. Internal doctrine mirror of the customer-approved behavioral algorithm.
**Precedence:** If any internal product, architecture, or API document conflicts with this spec, this spec wins and the conflicting doc MUST be reconciled.

---

## 1) Purpose

- Normalize the customer-approved behavioral algorithm into one internal, engineering-readable contract.
- Provide the single internal reference used to align `PROJECT_MEMORY.md`, `API_SCHEMA.md`, `ARCHITECTURE_RULES.md`, `README.md`, and `ROADMAP.md`.
- Prevent internal docs from drifting away from the customer behavioral intent.
- This file is a normalized mirror. It is not a raw transcript of the customer document.

---

## 2) Diagnostic Flow Rules

- Identify the equipment first. Equipment identification is a prerequisite to procedure selection.
- When manufacturer and model are known, follow a manufacturer-consistent diagnostic path.
- If manufacturer/model is unknown or unavailable, continue with the approved standard procedure. Missing manufacturer detail MUST NOT block diagnostics.
- Ask one diagnostic question at a time.
- Follow causal, procedure-aligned diagnostics. Do not behave like a flat, numbered checklist.
- If isolation/readiness is not satisfied, continue diagnostics.
- Do NOT substitute continued diagnostics with a questionnaire-first report collection flow.
- Questionnaire-first "confirm complaint / what was found / what repair was performed" collection is NOT the default unresolved path. It is allowed only when the case is already in a legally appropriate near-final / report-edit state.

---

## 3) Isolation / Cause Gating

- Do NOT generate Cause before the required diagnostic gate is satisfied.
- Do NOT recommend replacement before the allowed gate is satisfied.
- Do NOT estimate labor before the allowed gate is satisfied.
- Gate satisfaction is runtime-owned (Context Engine). Prompt wording does not satisfy the gate.
- If isolation is incomplete, the system MUST state that isolation is not complete (when relevant) and continue diagnostics.

---

## 4) Manufacturer-Priority Behavior

- When an approved manufacturer-specific diagnostic procedure exists for the identified unit, it has priority over the generic/standard procedure.
- If an approved manufacturer procedure is unavailable, fall back to the approved standard procedure.
- Missing manufacturer detail MUST NOT demote an available manufacturer procedure below a generic path.
- Missing manufacturer detail MUST NOT block diagnostics.

---

## 5) Output Surface Behavior

The following output surfaces are distinct and MUST NOT be collapsed:

- `authorization_ready` — conservative, approval-safe authorization surface.
- `portal_cause` — portal-cause surface, only after the diagnostic cause gate is satisfied.
- `shop_final_report` — fixed shop-style final report surface, only after repair/readiness gate is satisfied.

Rules:
- Final output on any surface is legal ONLY after the relevant readiness gate is satisfied.
- Output surface legality is a runtime property, not a wording property.
- Surfaces are never merged into a single generic "report" behavior.

---

## 6) Prohibited Premature Outputs

The system MUST NOT, before the relevant gate is satisfied:

- Generate Cause.
- Recommend replacement.
- Estimate labor.
- Emit Portal Cause, Shop Final Report, or Authorization-ready text.
- Invite the technician to start a final report.
- Collapse unresolved diagnostics into report-field questionnaire collection.
- Infer readiness from model wording alone.

A premature output is a contract breach, not a stylistic defect.

---

## 7) Practical Implementation Notes

- The customer behavioral spec is the practical algorithm reference for diagnostic flow. Internal documents must align to it.
- Mode/surface transition authority is server-owned. Approved trigger paths are:
  - explicit commands,
  - server-approved natural-language aliases (deterministic, allow-listed),
  - server-owned, legality-gated CTA/button controls (allowed as future product direction).
- A future server-owned `START FINAL REPORT` button / CTA for final report launch is acceptable product direction ONLY if:
  - the control is server-owned,
  - legality/readiness gates are satisfied server-side,
  - the CTA resolves to the same approved transition class as an explicit command/alias,
  - it is NOT inferred from LLM wording alone.
- Client-owned transition authority is prohibited.
- Single authority: there must be exactly one diagnostic flow authority at runtime (the Context Engine). No hidden second brain in route handlers, helpers, or prompt layer.
- This file is docs-only. It does not replace runtime validation; it defines the doctrine runtime must enforce.

End of file.
