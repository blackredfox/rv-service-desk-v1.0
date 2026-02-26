# RV Service Desk v4 PRD

## Original Problem Statement
Orchestration v4: enforce a senior RV technician chat flow with no internal telemetry in assistant output, remove labor_confirmation mode, add report command routing, server-side cause gating, telemetry scrubber, SSE-only badges, and strict final report format (labor last). All OpenAI calls must use a single OPENAI_MODEL constant.

## Architecture Decisions
- Centralize model selection via `OPENAI_MODEL` constant in chat route.
- Command router in `route.ts` handles report/continue intents outside the LLM.
- Server-side `computeCauseAllowed` enforces report eligibility; LLM cannot decide.
- Output scrubber removes telemetry lines before streaming/saving.
- SSE badges emitted from backend; frontend renders badge panel.
- Labor confirmation mode removed; labor included only in final report.

## Implemented
- Added `OPENAI_MODEL` constant and replaced all model references.
- Added `detectUserCommand`, `computeCauseAllowed`, and telemetry scrubber in `route.ts`.
- Removed labor_confirmation mode across context engine, mode validators, route flow, and tests.
- Added report command handling (allowed → final report, blocked → refusal + next question).
- Added SSE `badges` event and frontend badge panel with data-testid coverage.
- Updated prompts to remove telemetry output and keep labor last in final report.
- Added/updated tests for routing, telemetry scrubber, model constant, and report format.

## Prioritized Backlog
P0:
- Run full test suite to confirm no regressions.
- Verify frontend SSE badge rendering in live UI.

P1:
- Expand telemetry scrub patterns if new internal labels appear.
- Add unit tests for report refusal text localization.

P2:
- Add badge persistence on page reload.
- Add UI compact badge layout for mobile.

## Next Tasks
- Validate report command behavior with live LLM key.
- Confirm no internal telemetry appears in live chat output.
