# PRD

## Original problem statement
Implement a narrow, production-safe improvement to RV Service Desk so that approved EN/ES/RU natural-language final-report requests can enter the existing final-report path only when report readiness is already satisfied, and current-step guidance can answer how/where/identify/alternate-check-point questions without advancing the active diagnostic step.

## Architecture decisions
- Kept the Context Engine as the single authority for diagnostic readiness, active step, branching, completion, and terminal state.
- Moved approved natural final-report alias handling into bounded route/server orchestration only after runtime readiness is confirmed.
- Removed natural-language report activation from the generic explicit mode resolver so prompt/helper layers do not become a second flow authority.
- Added deterministic, allow-listed helper classifiers for report intent and step guidance; no fuzzy semantic mode switching.
- Improved water-heater `wh_5` / `wh_5a` guidance content in EN/ES/RU, but kept guidance non-advancing and same-step bounded.

## What's implemented
- Added deterministic approved final-report alias detection for EN / ES / RU.
- Gated natural report transitions so they only switch to `final_report` after readiness is satisfied at runtime.
- Preserved explicit `START FINAL REPORT`, but blocked premature final-report entry when readiness is not met.
- Expanded step-guidance detection to cover `HOW_TO_CHECK`, `LOCATE_COMPONENT`, `IDENTIFY_POINT`, and `ALTERNATE_CHECK_POINT` phrasing in EN / ES / RU.
- Improved `wh_5` and `wh_5a` guidance text with practical locate/identify cues and acceptable alternate check points.
- Added/updated deterministic tests for report aliases, readiness bypass prevention, same-step guidance continuation, and architecture authority boundaries.

## Prioritized backlog
### P0
- Add equivalent bounded guidance enrichment for other high-friction electrical steps beyond `wh_5` / `wh_5a`.
- Add a tiny shared helper for reusable report-readiness checks if more routes need the same gate.

### P1
- Add unit coverage directly for the new report-intent and step-guidance helper modules.
- Expand ES localizations for additional water-heater steps so more step questions are fully localized, not only the priority case.

### P2
- Add more approved natural report aliases if product explicitly approves them.
- Add a compact audit log field for which approved alias/category matched, if needed for observability.

## Next tasks
1. Extend the same bounded guidance approach to other diagnostic procedures with repeated locate/identify friction.
2. Add a small helper test file for alias normalization and multilingual category classification.
3. Review whether additional server-owned transition aliases are needed for authorization parity, using the same architecture guardrails.
