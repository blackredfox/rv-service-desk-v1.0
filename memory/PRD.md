# RV Service Desk - Product Requirements Document

## Original Problem Statement
Create a robust RV Service Desk assistant that acts and communicates like a senior RV technician. The assistant should guide technicians through diagnostic procedures, generate service reports, and handle multilingual communication.

## Critical Issues (P0)
### Diagnostic Loop Bug
The agent gets stuck in diagnostic loops, repeats questions, misinterprets user answers, and fails to handle clarification requests. Three solution variants have been developed:

1. **Variant A** (`fix/diagnostic-confirm-loop-water-pump-A`): "Passive Server" - Trust LLM to manage diagnostic state
2. **Variant B** (`fix/diagnostic-confirm-loop-water-pump-B`): "Hybrid" - Dedicated LLM call to interpret ambiguous answers  
3. **Variant C** (`fix/diagnostic-confirm-loop-water-pump-C`): "Server-LLM Sync" - Extract stepId from LLM response, store as pendingStepId

## Current Implementation Status

### Completed Features
- [x] Dynamic language switching (EN/RU/ES)
- [x] Final output stability with output lock mechanism
- [x] Labor formatting with canonical format
- [x] Report-only mode for direct findings
- [x] Unit replacement policy
- [x] Robust Yes/No parser (`yesno.ts`)
- [x] Clarification request detector (`clarification.ts`)
- [x] Step sync mechanism (`step-sync.ts`) - Variant C

### In Progress
- [ ] User testing of Variants A, B, C to select best solution

### P1 Tasks (After P0 resolved)
- [ ] Upfront context gathering (travel trailer vs motorhome, engine vs house battery)

### Backlog
- [ ] Persist Context Engine state to Prisma database
- [ ] Fix ~47 pre-existing Vitest test failures

## Architecture

```
/app/rv-service-desk/
├── src/
│   ├── app/api/chat/
│   │   └── route.ts              # Main orchestrator
│   ├── lib/
│   │   ├── context-engine/       # Core state machine
│   │   ├── step-sync.ts          # Variant C: Server-LLM sync
│   │   ├── yesno.ts              # Yes/No parser + clarification
│   │   └── diagnostic-registry.ts
│   └── ...
├── tests/
│   ├── step-sync.test.ts         # 22 tests
│   ├── yesno-parser.test.ts      # 55 tests
│   └── ...
└── package.json
```

## Key Files
- `/app/rv-service-desk/src/app/api/chat/route.ts` - Main API handler
- `/app/rv-service-desk/src/lib/step-sync.ts` - Variant C step synchronization
- `/app/rv-service-desk/src/lib/yesno.ts` - Answer parsing

## 3rd Party Integrations
- OpenAI GPT for response generation

## User Preferences
- Primary language: Russian
- All variants should be tested before choosing final solution
