# PRD — howToCheck Rollout for Remaining Equipment Families

## Original Problem Statement
Expand and improve `howToCheck` coverage for the remaining customer-requested equipment families in RV Service Desk. This is a content-quality / procedure-support rollout only. Do not change diagnostic flow, step order, prerequisites, branch logic, completion logic, mode logic, prompt contracts, validators, routes, auth, billing, admin, or unrelated docs. Preserve existing improved families (`water_heater`, `furnace`, `lp_gas`) unless a truly minimal shared-format consistency fix is required. Base branch for validation: `main`. Minimal shared-format consistency fixes were allowed, but only if truly necessary.

## Architecture Decisions
- Limited the rollout to procedure content only in `src/lib/diagnostic-procedures.ts`
- Added a narrow, directly related coverage assertion in `tests/procedures/procedure-contract-audit.test.ts`
- Preserved all existing flow behavior: no step IDs, order, prerequisites, branches, validators, prompts, routes, or auth/runtime logic changed
- Left `water_heater`, `furnace`, and `lp_gas` untouched

## What Was Implemented
- Added technician-facing `howToCheck` guidance for every step in these existing rollout-equivalent procedures:
  - `water_pump`
  - `roof_ac`
  - `refrigerator`
  - `leveling`
  - `consumer_appliance`
- Added a focused audit test that requires complete `howToCheck` coverage for those rollout-targeted existing procedures
- Verified targeted suites pass with no flow drift

## Prioritized Backlog
### P0
- None for this rollout scope

### P1
- Decide whether customer-requested families not represented as dedicated procedures in this codebase (`solar_system`, `aqua_hot_system`, `bmpro_system`, standalone `ice_maker`) need separate authored procedures or explicit mapping rules in a future scoped task

### P2
- Extend the same `howToCheck` coverage standard to other existing warning-only procedures such as `slide_out` and `inverter_converter`
- Add a lightweight coverage matrix/report for rollout tracking by equipment family

## Next Tasks
- Keep this PR review focused on procedure text quality only
- If requested, perform the next narrow rollout for remaining existing procedures with warning-only gaps
