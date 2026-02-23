/**
 * Context Engine
 * 
 * Main orchestrator for diagnostic context management.
 * Integrates intent routing, loop protection, replan logic, and topic stack.
 */

import type {
  DiagnosticContext,
  Intent,
  ContextEngineResult,
  ResponseInstructions,
  ContextEngineConfig,
  AgentAction,
  Fact,
  Submode,
  Mode,
  LaborState,
  DEFAULT_CONFIG,
} from "./types";
import { detectIntent, describeIntent, isClarificationRequest } from "./intent-router";
import { checkLoopViolation, generateAntiLoopDirectives, updateLoopState, isFallbackResponse } from "./loop-guard";
import { shouldReplan, executeReplan, buildReplanNotice, isInReplanState, clearReplanState } from "./replan";
import { pushTopic, popTopic, isInClarificationSubflow, buildReturnToMainInstruction, buildClarificationContext, shouldAutoPopTopic, getCurrentClarificationTopic } from "./topic-stack";

// Re-export config
export { DEFAULT_CONFIG } from "./types";

// ── Context Store ───────────────────────────────────────────────────

const contextStore = new Map<string, DiagnosticContext>();

// ── Context Initialization ──────────────────────────────────────────

/**
 * Create a new diagnostic context for a case
 */
export function createContext(
  caseId: string,
  initialSystem?: string,
  classification?: "complex" | "non_complex",
): DiagnosticContext {
  const now = new Date().toISOString();
  
  const context: DiagnosticContext = {
    caseId,
    primarySystem: initialSystem || null,
    classification: classification || null,
    mode: "diagnostic",
    submode: "main",
    previousSubmode: null,
    topicStack: [],
    activeProcedureId: initialSystem || null,
    activeStepId: null,
    completedSteps: new Set(),
    unableSteps: new Set(),
    askedSteps: new Set(),
    facts: [],
    hypotheses: [],
    contradictions: [],
    lastAgentActions: [],
    consecutiveFallbacks: 0,
    isolationComplete: false,
    isolationFinding: null,
    isolationInvalidated: false,
    replanReason: null,
    labor: {
      mode: "none",
      estimatedHours: null,
      confirmedHours: null,
      draftGeneratedAt: null,
      confirmationRequired: false, // Non-blocking by default
    },
    createdAt: now,
    updatedAt: now,
  };
  
  contextStore.set(caseId, context);
  return context;
}

/**
 * Get or create context for a case
 */
export function getOrCreateContext(
  caseId: string,
  initialSystem?: string,
  classification?: "complex" | "non_complex",
): DiagnosticContext {
  const existing = contextStore.get(caseId);
  if (existing) {
    // Update system/classification if provided and not already set
    if (initialSystem && !existing.primarySystem) {
      existing.primarySystem = initialSystem;
      existing.activeProcedureId = initialSystem;
    }
    if (classification && !existing.classification) {
      existing.classification = classification;
    }
    return existing;
  }
  return createContext(caseId, initialSystem, classification);
}

/**
 * Get context for a case (returns undefined if not found)
 */
export function getContext(caseId: string): DiagnosticContext | undefined {
  return contextStore.get(caseId);
}

/**
 * Update context in store
 */
export function updateContext(context: DiagnosticContext): void {
  context.updatedAt = new Date().toISOString();
  contextStore.set(context.caseId, context);
}

/**
 * Clear context for a case (for testing)
 */
export function clearContext(caseId: string): void {
  contextStore.delete(caseId);
}

// ── Main Processing Function ────────────────────────────────────────

/**
 * Process a technician message through the context engine.
 * This is the main entry point for the engine.
 */
export function processMessage(
  caseId: string,
  message: string,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): ContextEngineResult {
  let context = getOrCreateContext(caseId);
  const notices: string[] = [];
  let stateChanged = false;
  
  // 1. Detect intent
  const intent = detectIntent(message);
  console.log(`[ContextEngine] Intent: ${describeIntent(intent)}`);
  
  // 2. Check for replan triggers (only if isolation was complete)
  if (config.enableReplan && context.isolationComplete) {
    const replanResult = shouldReplan(message, context);
    if (replanResult.shouldReplan) {
      console.log(`[ContextEngine] Replan triggered: ${replanResult.reason}`);
      context = executeReplan(context, replanResult);
      notices.push(`Replan triggered: ${replanResult.reason}`);
      stateChanged = true;
    }
  }
  
  // 3. Handle clarification subflows
  if (config.enableClarificationSubflows) {
    if (intent.type === "LOCATE" || intent.type === "EXPLAIN" || intent.type === "HOWTO") {
      context = pushTopic(context, intent);
      stateChanged = true;
    }
  }
  
  // 4. Handle step completion signals
  if (intent.type === "MAIN_DIAGNOSTIC" || intent.type === "ALREADY_ANSWERED" || intent.type === "UNABLE_TO_VERIFY") {
    // If we're in a clarification subflow and got a diagnostic response, pop back
    if (isInClarificationSubflow(context) && intent.type === "MAIN_DIAGNOSTIC") {
      context = popTopic(context);
      stateChanged = true;
    }
    
    // Mark steps as completed or unable based on intent
    if (intent.type === "UNABLE_TO_VERIFY" && context.activeStepId) {
      context.unableSteps.add(context.activeStepId);
      context.activeStepId = null;
      stateChanged = true;
    }
  }
  
  // 5. Handle labor confirmation
  if (context.mode === "labor_confirmation" && intent.type === "CONFIRMATION") {
    if (intent.value === "accept" && context.labor.estimatedHours) {
      context.labor.confirmedHours = context.labor.estimatedHours;
      context.labor.mode = "confirmed";
    } else if (typeof intent.value === "number") {
      context.labor.confirmedHours = intent.value;
      context.labor.mode = "confirmed";
    }
    stateChanged = true;
  }
  
  // 6. Build response instructions
  const responseInstructions = buildResponseInstructions(context, intent, config);
  
  // 7. Update context in store
  updateContext(context);
  
  return {
    context,
    intent,
    responseInstructions,
    stateChanged,
    notices,
  };
}

// ── Response Instructions Builder ───────────────────────────────────

function buildResponseInstructions(
  context: DiagnosticContext,
  intent: Intent,
  config: ContextEngineConfig,
): ResponseInstructions {
  const antiLoopDirectives = generateAntiLoopDirectives(context);
  const constraints: string[] = [];
  
  // Handle replan state
  if (isInReplanState(context)) {
    const replanNotice = buildReplanNotice(context);
    if (replanNotice) constraints.push(replanNotice);
    
    return {
      action: "replan_notice",
      replanReason: context.replanReason || undefined,
      previousConclusion: context.isolationFinding || undefined,
      constraints,
      antiLoopDirectives,
    };
  }
  
  // Handle clarification subflows
  if (isInClarificationSubflow(context)) {
    const topic = getCurrentClarificationTopic(context);
    const returnInstruction = buildReturnToMainInstruction(context);
    if (returnInstruction) constraints.push(returnInstruction);
    
    const clarificationContext = buildClarificationContext(
      context.submode,
      topic?.topic || "",
    );
    if (clarificationContext) constraints.push(clarificationContext);
    
    return {
      action: "provide_clarification",
      clarificationType: context.submode as "locate" | "explain" | "howto",
      clarificationQuery: topic?.topic,
      returnToStep: topic?.returnStepId,
      constraints,
      antiLoopDirectives,
    };
  }
  
  // Handle labor confirmation mode
  if (context.mode === "labor_confirmation") {
    if (context.labor.mode === "confirmed") {
      return {
        action: "generate_report",
        constraints: [
          `Labor confirmed: ${context.labor.confirmedHours} hours`,
          "Generate final report with this labor budget",
        ],
        antiLoopDirectives,
      };
    }
    return {
      action: "generate_labor",
      constraints: [
        "Generate labor estimate as a DRAFT",
        "Do NOT block diagnostics - this is non-blocking",
        "Technician can continue or confirm later",
      ],
      antiLoopDirectives,
    };
  }
  
  // Handle transition (isolation complete)
  if (context.isolationComplete && context.isolationFinding) {
    return {
      action: "transition",
      constraints: [
        `Isolation finding: ${context.isolationFinding}`,
        "Ready to transition to labor estimate or final report",
      ],
      antiLoopDirectives,
    };
  }
  
  // Default: ask next step
  return {
    action: "ask_step",
    stepId: context.activeStepId || undefined,
    constraints,
    antiLoopDirectives,
  };
}

// ── Step Management ─────────────────────────────────────────────────

/**
 * Mark a step as completed
 */
export function markStepCompleted(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.completedSteps.add(stepId);
  context.activeStepId = null;
  updateContext(context);
}

/**
 * Mark a step as unable to verify
 */
export function markStepUnable(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.unableSteps.add(stepId);
  context.activeStepId = null;
  updateContext(context);
}

/**
 * Set the active step
 */
export function setActiveStep(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.activeStepId = stepId;
  context.askedSteps.add(stepId);
  updateContext(context);
}

/**
 * Mark isolation as complete
 */
export function markIsolationComplete(caseId: string, finding: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.isolationComplete = true;
  context.isolationFinding = finding;
  updateContext(context);
}

// ── Fact Management ─────────────────────────────────────────────────

/**
 * Add a fact to the context
 */
export function addFact(caseId: string, fact: Omit<Fact, "id" | "timestamp">): void {
  const context = getContext(caseId);
  if (!context) return;
  
  const newFact: Fact = {
    ...fact,
    id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  
  context.facts.push(newFact);
  updateContext(context);
}

// ── Agent Action Recording ──────────────────────────────────────────

/**
 * Record an agent action (for loop detection)
 */
export function recordAgentAction(
  caseId: string,
  action: Omit<AgentAction, "timestamp">,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): void {
  const context = getContext(caseId);
  if (!context) return;
  
  const fullAction: AgentAction = {
    ...action,
    timestamp: new Date().toISOString(),
  };
  
  const updatedContext = updateLoopState(context, fullAction, config);
  contextStore.set(caseId, updatedContext);
}

/**
 * Check if a proposed action would violate loop rules
 */
export function wouldViolateLoopRules(
  caseId: string,
  action: Omit<AgentAction, "timestamp">,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): { violation: boolean; reason?: string } {
  const context = getContext(caseId);
  if (!context) return { violation: false };
  
  const fullAction: AgentAction = {
    ...action,
    timestamp: new Date().toISOString(),
  };
  
  return checkLoopViolation(fullAction, context, config);
}

// ── Labor Management ────────────────────────────────────────────────

/**
 * Set labor estimate as draft (non-blocking)
 */
export function setLaborDraft(caseId: string, estimatedHours: number): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.labor = {
    ...context.labor,
    mode: "draft",
    estimatedHours,
    draftGeneratedAt: new Date().toISOString(),
  };
  updateContext(context);
}

/**
 * Confirm labor hours
 */
export function confirmLaborHours(caseId: string, confirmedHours: number): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.labor = {
    ...context.labor,
    mode: "confirmed",
    confirmedHours,
  };
  updateContext(context);
}

/**
 * Check if labor confirmation is blocking
 */
export function isLaborBlocking(caseId: string): boolean {
  const context = getContext(caseId);
  if (!context) return false;
  return context.labor.confirmationRequired && context.labor.mode !== "confirmed";
}

// ── Mode Management ─────────────────────────────────────────────────

/**
 * Set the current mode
 */
export function setMode(caseId: string, mode: Mode): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.mode = mode;
  updateContext(context);
}

/**
 * Get the current mode
 */
export function getMode(caseId: string): Mode | undefined {
  return getContext(caseId)?.mode;
}

// ── Exports ─────────────────────────────────────────────────────────

export {
  detectIntent,
  describeIntent,
  isClarificationRequest,
} from "./intent-router";

export {
  checkLoopViolation,
  generateAntiLoopDirectives,
  isFallbackResponse,
} from "./loop-guard";

export {
  shouldReplan,
  executeReplan,
  buildReplanNotice,
  isInReplanState,
  clearReplanState,
} from "./replan";

export {
  pushTopic,
  popTopic,
  isInClarificationSubflow,
  getCurrentClarificationTopic,
  buildReturnToMainInstruction,
} from "./topic-stack";
