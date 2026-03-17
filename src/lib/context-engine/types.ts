/**
 * Context Engine Types
 * 
 * Core type definitions for the diagnostic context management system.
 */

// ── Mode & Submode ──────────────────────────────────────────────────

export type Mode = "diagnostic" | "authorization" | "final_report" | "labor_confirmation";

export type Submode = 
  | "main"           // Primary diagnostic flow
  | "locate"         // Answering "where is it?"
  | "explain"        // Answering "what is this?"
  | "howto"          // Answering "how do I check?"
  | "replan"         // Triggered by new evidence
  | "loop_break";    // Forced forward progress

// ── Branch Types ────────────────────────────────────────────────────

/**
 * Branch definition for conditional diagnostic paths.
 * A branch is a sequence of steps triggered by a specific finding.
 */
export type BranchDefinition = {
  id: string;                    // e.g., "flame_failure", "no_ignition"
  displayName: string;           // Human-readable name
  triggerStepId: string;         // Step that can trigger this branch
  triggerPattern: RegExp;        // Pattern in response that activates branch
  entryStepId: string;           // First step when entering this branch
  stepIds: string[];             // All steps in this branch
  mutuallyExclusive: string[];   // Branch IDs that cannot be active simultaneously
};

/**
 * Branch state tracks which branch is active and the decision path taken.
 */
export type BranchState = {
  activeBranchId: string | null;        // Currently active branch (null = main flow)
  decisionPath: BranchDecision[];       // History of branch decisions
  lockedOutBranches: Set<string>;       // Branches that can no longer be entered
};

/**
 * A single branch decision recorded in the decision path.
 */
export type BranchDecision = {
  stepId: string;                       // Step where decision was made
  branchId: string | null;              // Branch entered (null = stayed in main flow)
  reason: string;                       // Why this branch was chosen
  timestamp: string;
};

// ── Intent Types ────────────────────────────────────────────────────

export type Intent =
  | { type: "MAIN_DIAGNOSTIC"; stepMatch?: string }
  | { type: "LOCATE"; query: string }
  | { type: "EXPLAIN"; query: string }
  | { type: "HOWTO"; query: string }
  | { type: "DISPUTE_OR_NEW_EVIDENCE"; evidence: string; evidenceType: EvidenceType }
  | { type: "CONFIRMATION"; value: number | "accept" }
  | { type: "ALREADY_ANSWERED" }
  | { type: "UNABLE_TO_VERIFY" }
  | { type: "UNCLEAR" };

export type EvidenceType = 
  | "physical_damage"      // hole, leak, crack, burn
  | "measurement_change"   // different reading than before
  | "technician_dispute"   // "that can't be right"
  | "new_observation";     // "I also noticed..."

// ── Fact & Evidence ─────────────────────────────────────────────────

export type FactType = "measurement" | "observation" | "finding" | "component_state";

export type Fact = {
  id: string;
  type: FactType;
  source: "technician" | "inference";
  value: string;
  stepId?: string;
  timestamp: string;
  supersededBy?: string;  // For replan tracking
};

export type Hypothesis = {
  id: string;
  description: string;
  confidence: "high" | "medium" | "low";
  supportingFacts: string[];
  contradictingFacts: string[];
};

export type Contradiction = {
  id: string;
  factA: string;
  factB: string;
  resolution?: string;
  resolvedAt?: string;
};

// ── Topic Stack ─────────────────────────────────────────────────────

export type TopicStackEntry = {
  topic: string;           // e.g., "capacitor_check", "fuse_location"
  submode: Submode;
  returnStepId: string;    // Step to return to after clarification
  pushedAt: string;
};

// ── Agent Actions (for loop detection) ──────────────────────────────

export type AgentActionType = 
  | "question"
  | "clarification"
  | "transition"
  | "fallback"
  | "replan_notice";

export type AgentAction = {
  type: AgentActionType;
  content: string;
  timestamp: string;
  stepId?: string;
  submode?: Submode;
};

// ── Labor State ─────────────────────────────────────────────────────

export type LaborMode = "none" | "draft" | "confirmed" | "skipped";

export type LaborState = {
  mode: LaborMode;
  estimatedHours: number | null;
  confirmedHours: number | null;
  draftGeneratedAt: string | null;
  confirmationRequired: boolean;  // false = non-blocking
};

// ── Diagnostic Context ──────────────────────────────────────────────

export type DiagnosticContext = {
  // Case identification
  caseId: string;
  
  // Primary topic (the system being diagnosed)
  primarySystem: string | null;
  classification: "complex" | "non_complex" | null;
  
  // Mode tracking
  mode: Mode;
  submode: Submode;
  previousSubmode: Submode | null;
  
  // Topic stack for clarification subflows
  topicStack: TopicStackEntry[];
  
  // Active procedure tracking
  activeProcedureId: string | null;
  activeStepId: string | null;
  
  // Step state
  completedSteps: Set<string>;
  unableSteps: Set<string>;
  askedSteps: Set<string>;
  
  // Branch state (P1.5: Branch-aware step resolution)
  branchState: BranchState;
  
  // Evidence tracking
  facts: Fact[];
  hypotheses: Hypothesis[];
  contradictions: Contradiction[];
  
  // Loop detection
  lastAgentActions: AgentAction[];
  consecutiveFallbacks: number;
  
  // Isolation state
  isolationComplete: boolean;
  isolationFinding: string | null;
  isolationInvalidated: boolean;
  replanReason: string | null;
  
  // Labor state
  labor: LaborState;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
};

// ── Loop Guard Result ───────────────────────────────────────────────

export type LoopCheckResult = {
  violation: boolean;
  reason?: string;
  suggestion?: string;
};

// ── Replan Result ───────────────────────────────────────────────────

export type ReplanResult = {
  shouldReplan: boolean;
  reason?: string;
  invalidatedFacts?: string[];
  newBranch?: string;
};

// ── Context Engine Result ───────────────────────────────────────────

export type ContextEngineResult = {
  // Updated context
  context: DiagnosticContext;
  
  // Routing decision
  intent: Intent;
  
  // Response instructions for LLM
  responseInstructions: ResponseInstructions;
  
  // Whether state changed significantly
  stateChanged: boolean;
  
  // Any warnings or notices
  notices: string[];
};

export type ResponseInstructions = {
  // What the LLM should do
  action: "ask_step" | "provide_clarification" | "acknowledge_and_continue" | 
          "replan_notice" | "transition" | "offer_completion" | "generate_labor" | "generate_report";
  
  // Step to ask (if action is ask_step)
  stepId?: string;
  stepQuestion?: string;
  
  // Clarification content (if action is provide_clarification)
  clarificationType?: "locate" | "explain" | "howto";
  clarificationQuery?: string;
  returnToStep?: string;
  
  // Replan info (if action is replan_notice)
  replanReason?: string;
  previousConclusion?: string;
  
  // Additional constraints for the LLM
  constraints: string[];
  
  // Anti-loop directives
  antiLoopDirectives: string[];
};

// ── Configuration ───────────────────────────────────────────────────

export type ContextEngineConfig = {
  // Feature flags
  enableClarificationSubflows: boolean;
  enableReplan: boolean;
  enableNonBlockingLabor: boolean;
  
  // Anti-loop settings
  maxConsecutiveFallbacks: number;
  maxStepRepeatCount: number;
  topicCooldownTurns: number;
  
  // Action history size
  maxActionHistory: number;
};

export const DEFAULT_CONFIG: ContextEngineConfig = {
  enableClarificationSubflows: true,
  enableReplan: true,
  enableNonBlockingLabor: true,
  maxConsecutiveFallbacks: 1,
  maxStepRepeatCount: 2,
  topicCooldownTurns: 3,
  maxActionHistory: 10,
};
