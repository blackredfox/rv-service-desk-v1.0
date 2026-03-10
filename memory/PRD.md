# PRD — Diagnostic Agent Pre-Production Stabilization

## Original Problem Statement
Stabilize diagnostic-agent behavior before CI/CD and deployment without refactoring the core architecture, Context Engine, or diagnostic state machine. Preserve all existing guarantees: step-by-step procedure discipline, no repeated questions, unknown-step closure, key finding pivot logic, output validator rules, and prompt contract tests. Fix four areas: manufacturer/model intake for complex systems, RV rooftop AC domain anchoring, translation consistency for ES/RU final reports, and improved first-response framing.

## Architecture Decisions
- Kept the core architecture intact: no Context Engine refactor, no state-machine refactor, no weakening of existing guards.
- Used localized prompt/procedure/validator adjustments only.
- Added first-reply framing through diagnostic procedure metadata + registry context injection, not through flow-authority changes.
- Limited early framing to the first assistant reply so it does not become repetitive or block diagnostics.
- Strengthened final-report translation consistency through validator enforcement of translated section headers in ES/RU blocks, plus clearer prompt/runtime instructions.
- Kept all existing tests green and added focused regression coverage for the new UAT issues.

## What’s Implemented
- Added optional early framing questions for complex equipment procedures:
  - roof AC / heat pump
  - furnace
  - refrigerator
  - inverter / converter
  - slide-out
  - leveling
- Registry now suppresses the framing question when the initial technician message already provides brand/model info or explicitly says it is unknown.
- Chat route now includes the framing cue only on the first diagnostic reply.
- Reworded roof AC procedure steps to stay in RV rooftop AC / heat pump context and avoid residential split-system defaults such as “outside unit,” “outdoor condenser fan,” and generic contactor phrasing.
- Strengthened diagnostic/final-report prompts for:
  - RV rooftop AC anchoring
  - first-reply framing guidance
  - translated section-header expectations
- Strengthened final-report translation validation so ES/RU translation blocks must translate report headers, while the English block and `--- TRANSLATION ---` separator remain unchanged.
- Added focused regression tests for:
  - manufacturer/model intake behavior
  - RV rooftop AC anchoring
  - translation consistency/header translation
- Verified full `yarn vitest run` passes.

## Prioritized Backlog
### P0
- Keep future AC procedure additions explicitly RV-specific unless another equipment type is confirmed.
- Add one more route-level regression test that inspects the first diagnostic system prompt for complex-equipment framing on first reply.

### P1
- Consolidate repeated translation-instruction strings in chat/final-report generation paths if more translation rules are added.
- Expand manufacturer/model brand detection heuristics carefully with real RV brand samples if routing becomes more manufacturer-aware.

### P2
- Reduce regression risk around `/app/src/app/api/chat/route.ts` by extracting narrow helpers only if future work touches the same areas repeatedly.
- Add bilingual report fixtures shared across validator tests to reduce duplication.

## Next Tasks
- Validate the same behavior in CI to confirm no environment-specific drift.
- If additional UAT scenarios arrive, extend only the relevant procedure/prompt/validator surfaces while preserving current flow guarantees.
