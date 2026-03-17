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
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { detectIntent, describeIntent, isClarificationRequest } from "./intent-router";
import { checkLoopViolation, generateAntiLoopDirectives, updateLoopState, isFallbackResponse } from "./loop-guard";
import { shouldReplan, executeReplan, buildReplanNotice, isInReplanState, clearReplanState } from "./replan";
import { pushTopic, popTopic, isInClarificationSubflow, buildReturnToMainInstruction, buildClarificationContext, shouldAutoPopTopic, getCurrentClarificationTopic } from "./topic-stack";
import { 
  markStepCompleted as registryMarkStepCompleted, 
  markStepUnable as registryMarkStepUnable,
  getNextStepId as registryGetNextStepId,
  processResponseForBranch as registryProcessResponseForBranch,
  exitBranch as registryExitBranch,
} from "../diagnostic-registry";

// Re-export config
export { DEFAULT_CONFIG } from "./types";

// ── Completion Detection (P1.6) ───────────────────────────────────────
//
// Two completion classes:
//   "verified_restoration" — repair performed AND system confirmed operational
//   "verified_fault"       — definitive destructive/failure finding confirmed
//
// Conservative: requires MIN_STEPS_FOR_COMPLETION and high-confidence pattern.

const MIN_STEPS_FOR_COMPLETION = 3;

type CompletionClass = "verified_fault" | "verified_restoration";
type CompletionSignalResult =
  | { detected: false }
  | { detected: true; class: CompletionClass; finding: string };

const RESTORATION_PATTERNS: RegExp[] = [
  // English: "after [repair] ... works/running/operational"
  /after.{0,80}(?:fix|repair|replac|restor|reconnect|rewir|splicin|replacing|repairing|fixing|restoring|reconnecting|rewiring).{0,100}(?:work(?:ing|s)?|operational|functional|running|heating|firing|started|back\s+up)/i,
  // English: "repaired/fixed/replaced ... now works"
  /(?:repair(?:ed)?|fix(?:ed)?|replac(?:ed)?|restor(?:ed)?|reconnect(?:ed)?|rewir(?:ed)?|spliced?).{0,80}(?:now\s+)?(?:work(?:ing|s)?|operational|running|heating|functional|back\s+up)/i,
  // English: "works/running after repair/fix"
  /(?:work(?:ing|s)?|operational|running|heating)\s*(?:now|again)?\s+(?:after|following)\s+(?:fix|repair|replac|restor|reconnect|rewir)/i,
  // Russian: "после [восстановления/замены/...] ... работает/заработал"
  /после.{0,60}(?:восстановлен|замен|ремонт|починк|устранен|подключен|отремонтир|починен).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился|включается|нагревает)/i,
  // Russian: "[repair verb] + работает"
  /(?:восстановил|починил|заменил|отремонтировал|подключил|устранил).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился)/i,
  // Russian: loose "работает" after a temporal/causal sequence
  /(?:работает(?:\s+нормально)?|заработал).{0,40}после/i,
  // Spanish: "después/tras [repair] ... funciona"
  /(?:después\s+de|tras)\s+(?:reparar|reemplazar|restaurar|reconectar|arreglar|cambiar).{0,100}(?:funciona|opera|trabaja)/i,
  /(?:repar(?:é|e|ado)|reemplaz(?:é|ado)|restaur(?:é|ado)|arregl(?:é|ado)).{0,80}(?:funciona|opera|trabaja)/i,
];

const FAULT_PATTERNS: RegExp[] = [
  // English: component first then state word (e.g. "the relay board is burnt")
  /\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b.{0,80}\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b/i,
  // English: state word first then component (e.g. "burnt relay board")
  /\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b.{0,60}\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b/i,
  // English: power+ground confirmed but component not responding
  /(?:power|voltage|12v|12\s*volt).{0,60}(?:confirmed|present|verified).{0,80}(?:motor|pump|board|relay|valve).{0,40}(?:not\s+run|not\s+work|won'?t\s+start|no\s+response|dead|nothing)/i,
  // Russian: destructive finding + component — NO \b (Cyrillic not in \w, \b is unreliable)
  /(?:^|[\s,—])(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил|неисправ[а-яё]+)(?:$|[\s,—]).{0,60}(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер)/i,
  // Russian: component + destructive finding
  /(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер).{0,60}(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил)/i,
  // Russian (simpler fallback for start-of-message): "сгорел мотор"
  /^(?:сгорел|оплавился|вздулся|перегорел|подгорел)\s+(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор)/i,
  // Spanish: quemado/fundido + component
  /\b(?:quemado|fundido|dañado|cortocircuito)\b.{0,60}\b(?:placa|motor|relé|válvula|bomba|módulo|condensador)\b/i,
];

function detectCompletionSignal(
  message: string,
  context: DiagnosticContext,
): CompletionSignalResult {
  const totalDone = context.completedSteps.size + context.unableSteps.size;
  if (totalDone < MIN_STEPS_FOR_COMPLETION) return { detected: false };
  if (context.isolationComplete) return { detected: false };
  if (!context.activeProcedureId) return { detected: false };

  // Verified Restoration (primary — TestCase11 scenario)
  for (const pattern of RESTORATION_PATTERNS) {
    if (pattern.test(message)) {
      const systemDisplay = (context.primarySystem ?? "system").replace(/_/g, " ");
      const trimmed = message.slice(0, 120).replace(/\s+/g, " ").trim();
      return {
        detected: true,
        class: "verified_restoration",
        finding: `Verified restoration — ${systemDisplay}: ${trimmed}`,
      };
    }
  }

  // Verified Fault (secondary — destructive finding)
  for (const pattern of FAULT_PATTERNS) {
    if (pattern.test(message)) {
      const systemDisplay = (context.primarySystem ?? "system").replace(/_/g, " ");
      const trimmed = message.slice(0, 120).replace(/\s+/g, " ").trim();
      return {
        detected: true,
        class: "verified_fault",
        finding: `Verified fault — ${systemDisplay}: ${trimmed}`,
      };
    }
  }

  return { detected: false };
}

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
    // P1.5: Branch state initialization
    branchState: {
      activeBranchId: null,
      decisionPath: [],
      lockedOutBranches: new Set(),
    },
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
  // NOTE: CONFIRMATION in diagnostic mode with an active step is treated as MAIN_DIAGNOSTIC
  // (e.g. Russian "да" / "нет" answers to diagnostic questions should advance steps, not
  //  be misrouted as labor confirmations)
  const isConfirmationAsDiagnostic =
    intent.type === "CONFIRMATION" &&
    context.mode === "diagnostic" &&
    context.activeStepId !== null;

  if (
    intent.type === "MAIN_DIAGNOSTIC" ||
    intent.type === "ALREADY_ANSWERED" ||
    intent.type === "UNABLE_TO_VERIFY" ||
    isConfirmationAsDiagnostic
  ) {
    // If we're in a clarification subflow and got a diagnostic response, pop back
    if (isInClarificationSubflow(context) && (intent.type === "MAIN_DIAGNOSTIC" || isConfirmationAsDiagnostic)) {
      context = popTopic(context);
      stateChanged = true;
    }
    
    // Mark current step as completed or unable based on intent
    if (context.activeStepId) {
      if (intent.type === "UNABLE_TO_VERIFY") {
        const completedStepId = context.activeStepId;
        context.unableSteps.add(completedStepId);
        registryMarkStepUnable(caseId, completedStepId); // Sync to registry
        notices.push(`Step ${completedStepId} marked as UNABLE`);
        // Note: unable-to-verify typically does not trigger branches (no positive finding)
        // Get next step (branch-aware)
        const nextId = registryGetNextStepId(caseId);
        // Handle branch exit if all branch steps are exhausted
        if (nextId === null && context.branchState.activeBranchId !== null) {
          registryExitBranch(caseId, "Branch steps exhausted after UNABLE");
          context.branchState.activeBranchId = null;
          notices.push(`Branch exhausted (unable) — returning to main flow`);
          const mainFlowNext = registryGetNextStepId(caseId);
          context.activeStepId = mainFlowNext;
          if (mainFlowNext) notices.push(`Main flow resumed: ${mainFlowNext}`);
          else notices.push(`All procedure steps complete`);
        } else {
          context.activeStepId = nextId;
          if (nextId) notices.push(`Next step assigned: ${nextId}`);
          else notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      } else {
        // MAIN_DIAGNOSTIC, ALREADY_ANSWERED, or diagnostic-context CONFIRMATION
        // Technician answered the current step — mark it complete
        const completedStepId = context.activeStepId;
        context.completedSteps.add(completedStepId);
        registryMarkStepCompleted(caseId, completedStepId); // Sync to registry
        notices.push(`Step ${completedStepId} marked as COMPLETED`);

        // ── P1.5: Branch trigger check ─────────────────────────────
        // MUST happen BEFORE getNextStepId so the registry's activeBranchId is
        // updated when the next step is resolved.
        const branchResult = registryProcessResponseForBranch(caseId, completedStepId, message);
        if (branchResult.branchEntered) {
          notices.push(`Branch entered: ${branchResult.branchEntered.id}`);
          // Sync branch state to context engine state
          context.branchState.activeBranchId = branchResult.branchEntered.id;
          context.branchState.decisionPath.push({
            stepId: completedStepId,
            branchId: branchResult.branchEntered.id,
            reason: "Triggered by technician response",
            timestamp: new Date().toISOString(),
          });
          for (const lockedBranch of branchResult.lockedOut) {
            context.branchState.lockedOutBranches.add(lockedBranch);
          }
        }

        // Now resolve next step — branch-aware because registry.activeBranchId is updated
        const nextId = registryGetNextStepId(caseId);
        // Handle branch exit if all branch steps are exhausted
        if (nextId === null && context.branchState.activeBranchId !== null) {
          registryExitBranch(caseId, "Branch steps exhausted");
          context.branchState.activeBranchId = null;
          notices.push(`Branch exhausted — returning to main flow`);
          const mainFlowNext = registryGetNextStepId(caseId);
          context.activeStepId = mainFlowNext;
          if (mainFlowNext) notices.push(`Main flow resumed: ${mainFlowNext}`);
          else notices.push(`All procedure steps complete`);
        } else {
          context.activeStepId = nextId;
          if (nextId) notices.push(`Next step assigned: ${nextId}`);
          else notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      }
    }
    
    // Handle "already answered" — prevent re-asking
    if (intent.type === "ALREADY_ANSWERED") {
      notices.push("Technician indicated already answered — moving forward");
    }
  }
  
  // 4.5. P1.6 — Detect diagnostic isolation completion
  // Runs after step completion so completedSteps count is up-to-date.
  // Sets isolationComplete + clears activeStepId so the LLM offers report command
  // instead of asking the next step.
  if (!context.isolationComplete && context.activeProcedureId) {
    const completionSignal = detectCompletionSignal(message, context);
    if (completionSignal.detected) {
      context.isolationComplete = true;
      context.isolationFinding = completionSignal.finding;
      context.activeStepId = null; // Stop step progression — offer completion instead
      notices.push(`Isolation complete (${completionSignal.class}): ${completionSignal.finding}`);
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
  
  // 6. Ensure active step is always assigned when a procedure is active
  //    (but NOT when isolation is complete — we want no active step in that case)
  if (!context.activeStepId && context.activeProcedureId && !context.isolationComplete) {
    const nextId = registryGetNextStepId(caseId);
    if (nextId) {
      context.activeStepId = nextId;
      notices.push(`Active step initialized: ${nextId}`);
      stateChanged = true;
    }
  }
  
  // 7. Build response instructions
  const responseInstructions = buildResponseInstructions(context, intent, config);
  
  // 8. Update context in store
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
  
  // Handle isolation complete — offer completion (P1.6)
  // Must NOT auto-transition. Must NOT generate report. Must offer explicit command.
  if (context.isolationComplete && context.isolationFinding) {
    return {
      action: "offer_completion",
      constraints: [
        `ISOLATION FINDING: ${context.isolationFinding}`,
        "MANDATORY: Do NOT ask further diagnostic questions.",
        "MANDATORY: Provide a concise 1-2 sentence root cause / repair summary.",
        "MANDATORY: End with exactly: 'Send START FINAL REPORT and I will generate the report.'",
        "PROHIBITED: Do NOT generate the final report format.",
        "PROHIBITED: Do NOT include Complaint / Procedure / Verified Condition headers.",
        "PROHIBITED: Do NOT declare 'isolation complete' or 'conditions met'.",
        "PROHIBITED: Do NOT auto-transition modes.",
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
