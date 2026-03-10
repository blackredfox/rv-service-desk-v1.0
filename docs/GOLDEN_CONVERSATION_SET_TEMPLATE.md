# GOLDEN_CONVERSATION_SET_TEMPLATE.md

Use this template for each evaluation case.

---

## Case ID
`ac_no_cooling_01`

## Category
Roof AC / Guided Diagnostics

## Why this case matters
Short description of what behavior this case is meant to test.

## Initial technician message
```text
AC is blowing warm air. Compressor may be running.
```

## Follow-up technician messages
```text
1. I checked power. 120V is present.
2. Thermostat is calling for cooling.
3. Compressor hums but no cold air.
```

## Expected active procedure
Name of expected procedure.

## Expected diagnostic behavior
- Must not skip first valid step
- Must not generate final report too early
- Must not invent cause
- May briefly explain why power check matters

## Expected UX behavior
- Should feel like senior technician guidance
- Should not expose raw internal labels
- Should not sound like a rigid form terminal

## Critical guardrails
- No cause before isolation completion
- No component replacement advice if rules do not allow it
- No repeated questions

## Final output expectation
If applicable, describe final-report or authorization expectations.

## Scoring notes
Optional notes for human review.

