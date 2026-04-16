# PRD — Documentation Alignment: Customer Prompt Fidelity

## Original problem statement
Use the docs branch first.

Branch:
- target: docs/customer-prompt-fidelity-alignment
- base: neo-base/customer-prompt-fidelity-alignment

Clarification:
This PR is documentation-only and must align the internal docs to the customer-approved behavioral algorithm.

Priority files:
- PROJECT_MEMORY.md
- API_SCHEMA.md
- ARCHITECTURE_RULES.md

Strongly recommended:
- README.md
- ROADMAP.md

Add:
- docs/CUSTOMER_BEHAVIOR_SPEC.md

Key doctrine to preserve:
- customer prompt is the canonical behavioral algorithm
- if isolation is not complete, continue diagnostics
- do not default unresolved diagnostics into questionnaire-first report collection
- Portal Cause, Shop Final Report, and Authorization-ready output are distinct surfaces
- manufacturer diagnostic priority is required behavior
- future START FINAL REPORT button/CTA is acceptable only as a server-owned, legality-gated UX element

Non-scope:
- no runtime logic changes
- no validators
- no prompts
- no tests
- no procedure files
- no UI implementation
- no contamination files

If anything in the current docs conflicts with the customer behavior document, the customer behavior document wins.

## Architecture decisions
- Treated the customer-approved prompt as the canonical behavioral algorithm.
- Added docs/CUSTOMER_BEHAVIOR_SPEC.md as the normalized internal doctrine file.
- Kept the diff narrow: updated priority docs plus README only; left ROADMAP unchanged because no conflict required correction.
- Preserved docs-only scope: no runtime, validator, prompt, test, procedure, or UI changes.

## What was implemented
- Updated PROJECT_MEMORY.md to codify canonical precedence, distinct output surfaces, continue-diagnostics doctrine, manufacturer procedure priority, and server-owned legality-gated CTA language.
- Updated API_SCHEMA.md to align schema doctrine with server-owned trigger paths, distinct output surfaces, continue-diagnostics behavior, and manufacturer-priority behavior.
- Updated ARCHITECTURE_RULES.md to enforce customer behavior precedence, no questionnaire-first fallback for unresolved diagnostics, manufacturer procedure priority, and server-owned CTA constraints.
- Updated README.md minimally to remove ambiguity around manufacturer priority, incomplete-isolation behavior, and distinct output surfaces.
- Added docs/CUSTOMER_BEHAVIOR_SPEC.md as the canonical internal mirror of the customer-approved behavior doctrine.

## Prioritized backlog
### P0
- Keep all future internal doc changes aligned to docs/CUSTOMER_BEHAVIOR_SPEC.md.
- Audit any remaining non-priority internal docs for accidental wording drift against the new spec.

### P1
- Align additional reference docs only when they materially conflict with the customer behavior spec.
- Add cross-links from secondary docs to CUSTOMER_BEHAVIOR_SPEC.md where helpful.

### P2
- If runtime work is later approved, trace each doctrine item to explicit runtime ownership and validation coverage.

## Next tasks
- Review any future doc PRs against the new customer behavior precedence rule.
- If requested later, perform a second-pass docs audit outside the narrow scope of this PR.
