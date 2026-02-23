# ADR: Context Engine (Conversation Manager) for RV Service Desk

**Status:** Accepted  
**Date:** 2026-02-12  
**Author:** Neo (Emergent AI Agent)

## Context

The RV Service Desk agent currently behaves like a "coin-operated chatbot" — rigidly following a step checklist with blocking labor confirmations. Key issues:

1. **Premature labor blocking**: Agent forces labor confirmation after 3 questions, stopping diagnostics.
2. **No clarification handling**: "Where is it?", "What is this part?", "How do I check?" break the flow.
3. **No replanning**: New evidence (e.g., AC leak found after isolation) doesn't update conclusions.
4. **Robotic loops**: Agent outputs "provide more info" repeatedly.
5. **Lost context**: Photo/session artifacts disappear; agent claims to "see" images not present.

## Decision

Implement a **Context Engine** layer that:
- Maintains diagnostic state across turns
- Routes technician messages into appropriate **intent subflows**
- Supports topic stack (push/pop clarification subtopics)
- Detects new evidence and triggers **replan** when conclusions need updating
- Enforces **anti-loop protection**
- Makes labor confirmation **non-blocking** (draft estimate mode)

## Architecture

### 1. State Machine Levels

```
┌─────────────────────────────────────────────────────────────────┐
│                        MODE LAYER                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  diagnostic  │─▶│ authorization│─▶│    final_report      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SUBMODE LAYER (diagnostic only)             │   │
│  │  ┌──────┐  ┌────────┐  ┌────────┐  ┌────────────────┐   │   │
│  │  │ main │◀▶│ locate │◀▶│explain │◀▶│ howto/replan   │   │   │
│  │  └──────┘  └────────┘  └────────┘  └────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Modes:**
- `diagnostic`: Active diagnostic questioning
- `authorization`: Labor estimation (non-blocking draft)
- `final_report`: Portal-Cause generation

**Submodes (inside diagnostic):**
- `main`: Primary diagnostic flow (procedure steps)
- `locate`: Answering "where is it?" questions
- `explain`: Answering "what is this part?" questions
- `howto`: Answering "how do I check?" questions
- `replan`: Triggered when new evidence invalidates prior isolation

### 2. Topic Stack

```typescript
type TopicStackEntry = {
  topic: string;           // e.g., "roof_ac", "capacitor_check"
  submode: Submode;        // what submode was active
  returnStepId: string;    // step to return to after clarification
};

type DiagnosticContext = {
  // Primary topic (the system being diagnosed)
  primarySystem: string;          // e.g., "roof_ac"
  classification: "complex" | "non_complex";
  
  // Topic stack for clarification subflows
  topicStack: TopicStackEntry[];
  
  // Active procedure tracking
  activeProcedureId: string;
  activeStepId: string | null;
  
  // Step state
  completedSteps: Set<string>;
  openSteps: Set<string>;
  
  // Evidence tracking
  facts: Fact[];
  hypotheses: Hypothesis[];
  contradictions: Contradiction[];
  
  // Loop detection
  lastAgentActions: AgentAction[];
  
  // Isolation state
  isolationComplete: boolean;
  isolationFinding: string | null;
  isolationInvalidated: boolean;   // true if replan triggered
};
```

### 3. Diagnostic Context Object

```typescript
type Fact = {
  id: string;
  type: "measurement" | "observation" | "finding";
  source: "technician" | "inference";
  value: string;
  stepId?: string;
  timestamp: string;
  supersededBy?: string;  // for replan tracking
};

type Hypothesis = {
  id: string;
  description: string;
  confidence: "high" | "medium" | "low";
  supportingFacts: string[];
  contradictingFacts: string[];
};

type Contradiction = {
  id: string;
  factA: string;
  factB: string;
  resolution?: string;
};

type AgentAction = {
  type: "question" | "clarification" | "transition" | "fallback";
  content: string;
  timestamp: string;
  stepId?: string;
};
```

### 4. Intent Router

The server deterministically routes technician messages:

```typescript
type Intent =
  | { type: "MAIN_DIAGNOSTIC"; data: DiagnosticData }
  | { type: "LOCATE"; query: string }
  | { type: "EXPLAIN"; query: string }
  | { type: "HOWTO"; query: string }
  | { type: "DISPUTE_OR_NEW_EVIDENCE"; evidence: string }
  | { type: "CONFIRMATION"; value: number | "accept" }
  | { type: "UNCLEAR" };

// Intent detection is pattern-based, NOT LLM-based
const INTENT_PATTERNS = {
  LOCATE: [
    /where\s+(?:is|are|do\s+I\s+find)/i,
    /где\s+(?:находится|искать)/i,
    /dónde\s+(?:está|encuentro)/i,
  ],
  EXPLAIN: [
    /what\s+(?:is|are)\s+(?:a|the|this)/i,
    /что\s+(?:такое|это)/i,
    /qué\s+es/i,
  ],
  HOWTO: [
    /how\s+(?:do\s+I|to|can\s+I|should\s+I)\s+(?:check|test|measure|verify)/i,
    /как\s+(?:мне\s+)?(?:проверить|протестировать)/i,
    /cómo\s+(?:puedo\s+)?(?:verificar|comprobar)/i,
  ],
  NEW_EVIDENCE: [
    /(?:found|discovered|noticed|see|saw)\s+(?:a|the)?\s*(?:hole|leak|crack|burn|damage|corrosion)/i,
    /(?:нашёл|нашел|обнаружил|заметил)\s+(?:дыр|утечк|трещин)/i,
  ],
};
```

### 5. Replan Triggers

New evidence that invalidates prior isolation:

```typescript
const REPLAN_TRIGGERS = [
  // Physical evidence patterns
  /(?:found|discovered|noticed|see|saw)\s+(?:a|the)?\s*(?:hole|leak|crack|burn|damage|corrosion|loose|broken)/i,
  /(?:actually|wait|but)\s+(?:there'?s|I\s+see|I\s+found)/i,
  
  // Technician disputes
  /(?:that'?s\s+not|can'?t\s+be|doesn'?t\s+make\s+sense|are\s+you\s+sure)/i,
  
  // Measurement contradictions
  /(?:now|but\s+now)\s+(?:it'?s|I\s+(?:get|see|measure))/i,
];

function shouldReplan(
  message: string,
  context: DiagnosticContext
): { replan: boolean; reason?: string } {
  // Only trigger replan if isolation was previously marked complete
  if (!context.isolationComplete) return { replan: false };
  
  for (const pattern of REPLAN_TRIGGERS) {
    if (pattern.test(message)) {
      return { 
        replan: true, 
        reason: `New evidence after isolation: ${message.slice(0, 100)}` 
      };
    }
  }
  
  return { replan: false };
}
```

### 6. Anti-Loop Rules

```typescript
const ANTI_LOOP_RULES = {
  // Never output "provide more info" twice in a row
  maxConsecutiveFallbacks: 1,
  
  // Never ask a step already marked DONE
  preventCompletedStepRepeat: true,
  
  // Max repeats of same step phrasing
  maxStepRepeatCount: 2,
  
  // Minimum turns before re-asking same topic
  topicCooldownTurns: 3,
};

function checkLoopViolation(
  proposedAction: AgentAction,
  context: DiagnosticContext
): { violation: boolean; reason?: string } {
  const lastActions = context.lastAgentActions.slice(-3);
  
  // Check consecutive fallbacks
  const consecutiveFallbacks = lastActions
    .filter(a => a.type === "fallback")
    .length;
  if (proposedAction.type === "fallback" && consecutiveFallbacks >= 1) {
    return { 
      violation: true, 
      reason: "Cannot output fallback twice in a row" 
    };
  }
  
  // Check step already completed
  if (proposedAction.stepId && context.completedSteps.has(proposedAction.stepId)) {
    return { 
      violation: true, 
      reason: `Step ${proposedAction.stepId} already completed` 
    };
  }
  
  // Check repeat count
  const sameStepCount = lastActions
    .filter(a => a.stepId === proposedAction.stepId)
    .length;
  if (sameStepCount >= 2) {
    return { 
      violation: true, 
      reason: `Step ${proposedAction.stepId} asked too many times` 
    };
  }
  
  return { violation: false };
}
```

### 7. Labor Gating (Non-Blocking)

```typescript
type LaborMode = "draft" | "confirmed" | "skipped";

type LaborState = {
  mode: LaborMode;
  estimatedHours: number | null;
  confirmedHours: number | null;
  draftGeneratedAt: string | null;
};

// Labor estimate is generated as a draft, NOT blocking
// Technician can:
// 1. Continue diagnostics without confirming
// 2. Confirm later when ready
// 3. Skip entirely and go to final report

const LABOR_GATING_RULES = {
  // Draft labor can be generated at any time after isolation
  draftRequiresIsolation: true,
  
  // Final report can proceed WITHOUT confirmed labor
  finalReportRequiresConfirmation: false,
  
  // If no confirmation, use draft estimate in final report
  useDraftAsFallback: true,
};
```

## File Structure

```
src/lib/context-engine/
├── types.ts              # Type definitions
├── context-engine.ts     # Main orchestrator
├── intent-router.ts      # Intent detection
├── replan.ts             # Replan logic
├── loop-guard.ts         # Anti-loop protection
├── topic-stack.ts        # Topic stack management
└── index.ts              # Public exports
```

## Integration Points

1. **route.ts**: Replace direct diagnostic-registry calls with context-engine calls
2. **prompt-composer.ts**: Add context injection for submode-specific prompts
3. **diagnostic-registry.ts**: Augment (don't replace) with context-engine state
4. **mode-validators.ts**: Add submode-aware validation

## Migration Strategy

1. Context Engine wraps existing diagnostic-registry (backward compatible)
2. New intent routing coexists with existing pattern detection
3. Feature flags control new behavior rollout:
   - `ENABLE_CLARIFICATION_SUBFLOWS`
   - `ENABLE_REPLAN`
   - `ENABLE_NON_BLOCKING_LABOR`

## Testing Strategy

Required test scenarios:

1. **P0a: AC Replan** - New evidence after isolation triggers rollback
2. **P0b: Loop Breaker** - Prevents "provide more info" twice
3. **P0c: Clarification Flow** - where/what/how returns to main flow
4. **P0d: Fan Alt-Power** - Working motor prevents replacement recommendation

## Acceptance Criteria

1. No "coin-operated" gating - diagnostics continue without labor blocking
2. Clarification support - brief answer + return to active step
3. Replan works - new evidence causes rollback and branch switch
4. No loops - never "provide more info" twice, never ask completed steps
5. Warranty-safe constraints preserved

## Consequences

**Positive:**
- Agent feels like a professional partner, not a chatbot
- Technicians can ask clarifying questions without breaking flow
- New evidence updates conclusions correctly
- No more robotic loops

**Negative:**
- More complex state management
- Potential for edge cases in intent detection
- Requires careful testing of replan scenarios

**Neutral:**
- Labor confirmation becomes optional (may need UX adjustment)
- Existing tests need updating for new behavior
