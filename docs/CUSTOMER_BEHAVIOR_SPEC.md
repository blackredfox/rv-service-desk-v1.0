# RV Service Desk
## CUSTOMER_BEHAVIOR_SPEC.md

**Status:** Canonical customer-approved behavior mirror  
**Purpose:** Normalize the customer-approved prompt into one internal doctrine file so all internal docs align to the same behavioral algorithm.

---

## 1) Precedence Rule

The customer-approved prompt is the canonical behavioral algorithm.

If any internal document conflicts with this behavior spec, this behavior spec wins and the other internal docs must be updated.

---

## 2) Diagnostic Core Doctrine

- The customer prompt is the canonical behavioral algorithm.
- If isolation is not complete, continue diagnostics.
- Do **not** default unresolved diagnostics into questionnaire-first report collection.
- Manufacturer diagnostic priority is required behavior.
- Portal Cause, Shop Final Report, and Authorization-ready output are distinct surfaces.
- Future `START FINAL REPORT` UX is acceptable only as a server-owned, legality-gated UX element.

---

## 3) Diagnostic Completion Doctrine

If a complex system still lacks complete isolation:
- remain in diagnostic behavior,
- continue causally relevant diagnostics,
- state that isolation is not complete when relevant,
- do not emit Portal Cause,
- do not shortcut into generic report-questionnaire collection.

This rule overrides convenience behavior.

---

## 4) Output Surface Doctrine

### 4.1 Portal Cause
- Distinct from Shop Final Report.
- Distinct from Authorization-ready output.
- Only allowed when diagnostic gating conditions are satisfied.

### 4.2 Shop Final Report
- Distinct from Portal Cause.
- Distinct from Authorization-ready output.
- Represents the fixed shop-style final report surface.

### 4.3 Authorization-ready Output
- Distinct from Portal Cause.
- Distinct from Shop Final Report.
- Conservative, approval-safe authorization surface only.

These surfaces must not be collapsed into one generic “report” behavior.

---

## 5) Procedure Priority Doctrine

When an approved manufacturer-specific diagnostic procedure exists for the identified unit, it has priority over a generic/standard procedure.

If manufacturer detail is unavailable or no approved manufacturer procedure exists:
- continue with the approved standard procedure,
- do not block diagnostics,
- do not demote an available manufacturer procedure below a generic path.

---

## 6) Transition / CTA Doctrine

Mode/output transition authority remains server-owned.

Approved trigger paths may include:
- explicit commands,
- server-approved natural-language aliases,
- future server-owned, legality-gated CTA controls.

Hard rule:
- a future `START FINAL REPORT` button or CTA must not create client-owned authority,
- it must not bypass legality/readiness gates,
- it must map to the same approved server transition behavior.

---

## 7) Practical Resolution Rule

When a wording conflict appears inside internal docs, resolve it by preserving these behaviors in this order:
1. Customer-approved behavior spec
2. Diagnostic completeness / continue-diagnostics doctrine
3. Distinct output-surface doctrine
4. Manufacturer procedure priority
5. Server-owned legality-gated transition doctrine

End of file.