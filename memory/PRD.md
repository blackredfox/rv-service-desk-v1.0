# RV Service Desk v3 PRD

## Original Problem Statement
Upgrade the Diagnostic Compliance Engine into a Senior RV Technician agent with strict portal discipline, modular prompts, adaptive diagnostics (no looping), server-side cause gating, and strict language policy enforcement. Maintain Context Engine authority and produce insurance-ready final reports with labor breakdown.

## Architecture Decisions
- Prompts remain modular: SYSTEM_PROMPT_BASE + mode-specific prompts (diagnostic, final report, labor confirmation).
- Context Engine remains flow authority; server enforces cause gating via context state (causeAllowed).
- Output-layer language enforcement via applyLangPolicy across all assistant outputs.
- Diagnostic registry used as data provider for step tracking; synced into Context Engine state.
- Final report order updated (Required Parts before Estimated Labor) with labor last.

## Implemented
- SYSTEM_PROMPT_BASE refactored with senior tech persona, industry reality rules, and scope enforcement.
- MODE_PROMPT_DIAGNOSTIC rewritten with diagnostic submodes (main/clarification/unable) and anti-loop rules.
- MODE_PROMPT_FINAL_REPORT rewritten with warranty-defensible tone and new section order.
- Context Engine: clarification submode, unable handling, causeAllowed state, replan resets.
- Server route: applyLangPolicy everywhere, cause gating, transition blocking, labor status localization.
- Diagnostic procedures: LP gas prerequisites tightened; detectSystem patterns expanded.
- Tests updated for new submode and final report order; targeted vitest run passed.

## Prioritized Backlog
P0:
- Run full test suite to confirm no regressions.
- Investigate frontend service availability (connection refused at localhost:3000).

P1:
- Add more explicit causeAllowed criteria for partial isolation requests.
- Expand unit tests for cause gating and unable submode.

P2:
- Add more diagnostic pattern coverage and system synonyms.
- Localize all system status events (non-LLM messages) beyond labor status.

## Next Tasks
- Execute full `vitest run` and resolve any remaining failures.
- Validate Chat API flows with live LLM keys.
- Confirm UI behavior once frontend is available.
