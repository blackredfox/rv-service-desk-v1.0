# PRD — RV Service Desk Prompt Orchestration Stabilization

## Problem Statement
Stabilize explicit mode transitions while keeping Context Engine (STRICT) as sole authority. Final Report must be reliably triggerable via allow‑listed aliases, and output must follow shop‑style report sections with English‑first + translation. Update prompts to use senior RV tech terminology (converter/charger, inverter) and avoid deep teardown for non‑complex units.

## Architecture Decisions
- Command alias detection is explicit allow‑list only (case/whitespace normalization; no NLP intent inference).
- Final Report validation enforces header order and translation separator; translation language aligns with tracked case inputLanguage.
- Prompt files remain the single source of truth for diagnostic/authorization/final report tone and terminology.

## Implemented
- Added explicit alias allow‑lists for Final Report and Authorization commands (EN/RU/ES) in prompt composer.
- Updated final report prompt to shop‑style sections and tightened diagnostics tone/terminology for RV contexts.
- Added strict final report validator (required headers in order, translation separator, English‑only block) and updated chat route to pass translation language from case metadata.
- Updated tests for alias detection, validator coverage, and prompt enforcement; refreshed docs (API_SCHEMA, PROJECT_MEMORY) to record aliases.

## Backlog
### P0
- None.

### P1
- Add explicit tests for translation language mismatch detection (RU/ES) with failing samples.

### P2
- Align supervisor service paths with repo structure if runtime UI/API is needed in this environment.

## Next Tasks
- Run full `yarn test` suite once Prisma dependency issue is resolved in the environment.
- Add more deterministic prompt regression tests for additional RV components (converter/charger, inverter, slide‑outs).
