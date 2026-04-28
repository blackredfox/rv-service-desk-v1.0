# PRD — Live UAT Report and Service Intent Fixes

## Original Problem Statement
Fix RV Service Desk live UAT failures where active diagnostic gates over-prioritized technician intent for inspection reports, component replacement evidence, and service/maintenance how-to requests.

## Architecture Decisions
- Added deterministic inspection-report intent routing ahead of diagnostic gate when transcript contains visual inspection context, findings, and report request.
- Added deterministic service-guidance response path for maintenance/how-to requests without reported faults.
- Generalized component replacement readiness detection across technician transcripts, while preserving server-owned routing and no LLM state authority.
- Final report generation remains legality/fact constrained; no invented repairs, measurements, or safety checks.

## Implemented
- Inspection report route for 15-point / visual inspection report requests, including repeated report requests after prior gates.
- Slide & jack service guidance route with practical safety/maintenance checklist.
- Step-cover actuator component evidence route using power/broken pin/access/replacement evidence to avoid fuse/switch/ground loops.
- Route-level UAT tests for Cases 114–118 plus regression coverage for dimmer, water-heater solenoid, and dirty incomplete report behavior.

## Prioritized Backlog
### P0
- Run non-mocked staging smoke for final-report formatting on the same live UAT transcripts.
### P1
- Split src/app/api/chat/route.ts into smaller route modules to reduce regression risk.
### P2
- Add more generic maintenance how-to templates for other RV service categories.

## Next Tasks
- Validate live LLM final report formatting for inspection and component replacement reports.
- Extend component evidence examples as more field transcripts arrive.
