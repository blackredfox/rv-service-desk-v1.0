# PRD

## Original problem statement
Fix the AC subtype clarification authority bug in RV Service Desk so a bounded clarification answer (especially Case-39: `Не работает AC` -> `кондиционер кабины`) becomes the authoritative subtype for subsequent routing, labels, and metadata, without unrelated report, UI, or broad diagnostic changes.

## Architecture decisions
- Kept the fix narrow inside AC routing and nearby regression tests.
- Stopped treating assistant clarification text as authoritative roof-AC evidence; only prior user evidence can influence fallback roof detection.
- Added explicit `cab_ac` subtype detection and a dedicated focused cab/dash AC procedure so clarified cab AC answers route deterministically instead of collapsing into roof AC.
- Simplified roof AC default metadata label to `Roof AC` to avoid silent `Roof AC / Heat Pump` expansion in generic roof routing.

## Implemented
- Updated `/src/app/api/chat/route.ts` so fallback roof evidence is sourced from prior user messages only.
- Updated `/src/lib/diagnostic-procedures.ts` with explicit cab/dash AC detection, a `cab_ac` procedure, RU localized cab AC labels/questions, and a narrower default roof AC label.
- Added focused regression coverage in `/tests/chat-route.test.ts` for Case-39 authoritative cab AC routing.
- Added focused unit coverage in `/tests/unit/diagnostic-procedures.test.ts` for explicit cab AC detection and procedure availability.
- Verified procedure contract and diagnostic language lock still pass after the change.

## Prioritized backlog
### P0
- Add explicit heat-pump-specific metadata labeling if product requires roof AC vs roof AC with heat pump labels to remain distinct in every language.

### P1
- Add deeper route/runtime regressions for multi-turn AC subtype follow-ups beyond cab AC.
- Add localized ES metadata/questions for the new cab AC procedure if Spanish cab AC usage is expected soon.

### P2
- Consider a shared AC subtype authority helper if more AC families or HVAC subtypes are introduced later.
- Add snapshot-style prompt assertions for subtype-specific structured context blocks.

## Next tasks
- If desired, add one more focused regression for explicit `roof AC with heat pump` labeling behavior.
- If desired, capture a full multi-turn Case-39 transcript fixture for future benchmark packs.
