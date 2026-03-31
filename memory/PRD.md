# RV Service Desk — PRD

## Original Problem Statement
Build route-authority mini-pack v1: a small, reviewable offline fixture set focused on highest-risk RVSD authority boundaries for eval/test purposes only.

## Architecture Tasks Done
- [2026-01-XX] Created route-authority-mini-pack.ts fixture file with 6 authority-focused cases
- [2026-01-XX] Created route-authority-mini-pack.test.ts test file reusing rvsdContractCheck
- [2026-01-XX] All 36 eval tests passing

## User Personas
- Developers reviewing authority boundary regressions
- QA engineers validating RVSD contract compliance

## Core Requirements (Static)
- 5-7 authority-focused cases
- Offline only, deterministic
- One focused test file
- No runtime code changes
- Reuse rvsdContractCheck, no duplicate checker logic

## What's Been Implemented
- 6 authority-focused test cases covering:
  - terminal-completion-offer-valid (control)
  - terminal-state-illegal-follow-up
  - semantic-completion-without-command
  - premature-final-report-generation
  - stale-final-report-missing-header
  - clarification-statement-only

## Prioritized Backlog
- P0: Complete (6 cases implemented)
- P1: Optional 7th case (authorization-mode authority)
- P2: Additional language coverage (ES/RU)

## Next Tasks
- PR review and merge
- Consider expanding authority boundary coverage based on real-world regressions
