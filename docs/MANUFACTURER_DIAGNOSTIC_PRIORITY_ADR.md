# ADR: Manufacturer Diagnostic Priority

**Status:** Proposed  
**Date:** 2026-03-10  
**Project:** RV Service Desk

## Context

The RV Service Desk diagnostic agent relies on the Context Engine as the single authority that determines diagnostic flow.

The LLM does **not** determine diagnostic sequencing.
It only renders technician-facing language.

Manufacturer-specific diagnostic logic is often more accurate than generic RV-equivalent logic for complex systems such as:
- roof AC units,
- refrigerators,
- furnaces,
- slide systems,
- leveling systems,
- inverters / converters.

However, technicians do not always provide manufacturer or model information in the first message.

The system therefore needs a controlled rule for:
1. preferring manufacturer-specific procedures when available,
2. asking for manufacturer/model information when useful,
3. continuing diagnostics when that information is unknown.

## Decision

Introduce **Manufacturer Diagnostic Priority** as a Context Engine rule.

### Rule 1 — Prefer manufacturer-specific logic when available

If manufacturer / model / year information is available and mapped to a supported procedure family, the Context Engine should prefer the manufacturer-specific diagnostic procedure.

### Rule 2 — Ask one concise manufacturer/model question when useful

If manufacturer/model information is missing and it would materially improve procedure selection, the system may ask **one short targeted question** before or alongside the first diagnostic step.

Example:

> What brand and model is the unit, if available?

This question is allowed to improve routing accuracy.

### Rule 3 — Manufacturer inquiry is non-blocking

If the technician does not know the manufacturer/model, diagnostics must continue using the standard RV-equivalent procedure.

Manufacturer inquiry must **not** block diagnostics.

Example:

Technician:  
> Roof AC not cooling.

Agent:  
> What brand and model is the AC unit, if available?

Technician:  
> Not sure.

Agent:  
> Understood. We’ll continue with the standard roof AC procedure.

## Implementation Notes

1. The **Context Engine remains the single authority** controlling diagnostic flow.
2. The LLM may:
   - ask the concise manufacturer/model question when the runtime allows it,
   - explain why the current check matters,
   - render the next step in natural technician-facing language.
3. The LLM must **not** invent manufacturer-specific logic on its own.
4. Manufacturer routing data should live in structured procedure metadata or equipment-family mappings.
5. The first manufacturer/model clarification may happen before the first diagnostic step, but it must never become a blocking intake form.

## Consequences

### Positive
- Diagnostics better match real manufacturer troubleshooting paths.
- Technicians gain confidence that the system understands real equipment families.
- Routing becomes more accurate without surrendering control to the LLM.

### Trade-offs
- One extra clarifying question may appear at case start.
- Procedure metadata must support manufacturer-aware routing.

## Final Principle

Manufacturer-aware diagnostics improve realism and trust.

But they must be implemented as a **Context Engine routing rule**, not as free-form model improvisation.