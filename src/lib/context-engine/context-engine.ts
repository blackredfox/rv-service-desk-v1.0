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
  EquipmentIdentity,
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
  getActiveProcedure as registryGetActiveProcedure,
} from "../diagnostic-registry";

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
    equipmentIdentity: { manufacturer: null, model: null, year: null },
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
  
  // 0. Sync activeProcedureId from registry if context doesn't have one
  //    This bridges the gap: initializeCase sets up the registry,
  //    but the context needs to know a procedure is active.
  if (!context.activeProcedureId) {
    const registryProcedure = registryGetActiveProcedure(caseId);
    if (registryProcedure) {
      context.activeProcedureId = registryProcedure.system;
      if (!context.primarySystem) {
        context.primarySystem = registryProcedure.system;
      }
      notices.push(`Procedure synced from registry: ${registryProcedure.displayName}`);
      stateChanged = true;
    }
  }

  // 1. Detect intent
  const intent = detectIntent(message);
  console.log(`[ContextEngine] Intent: ${describeIntent(intent)}`);
  
  // 1b. Extract equipment identity from technician message
  const extractedIdentity = extractEquipmentIdentity(message);
  if (extractedIdentity.manufacturer || extractedIdentity.model || extractedIdentity.year) {
    if (extractedIdentity.manufacturer && !context.equipmentIdentity.manufacturer) {
      context.equipmentIdentity.manufacturer = extractedIdentity.manufacturer;
      notices.push(`Equipment manufacturer identified: ${extractedIdentity.manufacturer}`);
    }
    if (extractedIdentity.model && !context.equipmentIdentity.model) {
      context.equipmentIdentity.model = extractedIdentity.model;
      notices.push(`Equipment model identified: ${extractedIdentity.model}`);
    }
    if (extractedIdentity.year && !context.equipmentIdentity.year) {
      context.equipmentIdentity.year = extractedIdentity.year;
      notices.push(`Equipment year identified: ${extractedIdentity.year}`);
    }
    stateChanged = true;
  }
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
    
    // Mark current step as completed or unable based on intent
    if (context.activeStepId) {
      if (intent.type === "UNABLE_TO_VERIFY") {
        context.unableSteps.add(context.activeStepId);
        registryMarkStepUnable(caseId, context.activeStepId); // Sync to registry
        notices.push(`Step ${context.activeStepId} marked as UNABLE`);
        // Immediately assign next step from registry
        const nextId = registryGetNextStepId(caseId);
        context.activeStepId = nextId;
        if (nextId) {
          notices.push(`Next step assigned: ${nextId}`);
        } else {
          notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      } else if (intent.type === "MAIN_DIAGNOSTIC" || intent.type === "ALREADY_ANSWERED") {
        // Technician answered the current step — mark it complete
        context.completedSteps.add(context.activeStepId);
        registryMarkStepCompleted(caseId, context.activeStepId); // Sync to registry
        notices.push(`Step ${context.activeStepId} marked as COMPLETED`);
        // Immediately assign next step from registry
        const nextId = registryGetNextStepId(caseId);
        context.activeStepId = nextId;
        if (nextId) {
          notices.push(`Next step assigned: ${nextId}`);
        } else {
          notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      }
    }
    
    // Handle "already answered" — prevent re-asking
    if (intent.type === "ALREADY_ANSWERED") {
      notices.push("Technician indicated already answered — moving forward");
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
  //    DRIFT GUARD: never assign a completed or closed step
  if (!context.activeStepId && context.activeProcedureId) {
    const nextId = registryGetNextStepId(caseId);
    if (nextId && !isStepClosed(context, nextId)) {
      context.activeStepId = nextId;
      notices.push(`Active step initialized: ${nextId}`);
      stateChanged = true;
    }
  }
  
  // 7. Final drift guard: if activeStepId somehow points to a closed step, reassign
  if (context.activeStepId && isStepClosed(context, context.activeStepId)) {
    notices.push(`Drift guard: step ${context.activeStepId} is closed, reassigning`);
    const safeNextId = registryGetNextStepId(caseId);
    context.activeStepId = safeNextId;
    stateChanged = true;
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

// ── Drift Guard Helper ──────────────────────────────────────────────

/**
 * Check if a step is closed (completed or unable).
 * The engine must never assign a closed step as activeStepId.
 */
function isStepClosed(context: DiagnosticContext, stepId: string): boolean {
  return context.completedSteps.has(stepId) || context.unableSteps.has(stepId);
}

// ── Equipment Identity Extraction ───────────────────────────────────

const MANUFACTURER_PATTERNS: Array<{ manufacturer: string; patterns: RegExp[] }> = [
  { manufacturer: "Suburban", patterns: [/\bsuburban\b/i, /(?:^|\s)субурбан(?:\s|,|$)/i] },
  { manufacturer: "Atwood", patterns: [/\batwood\b/i, /(?:^|\s)(?:этвуд|атвуд)(?:\s|,|$)/i] },
  { manufacturer: "Dometic", patterns: [/\bdometic\b/i, /(?:^|\s)(?:дометик|доместик)(?:\s|,|$)/i] },
  { manufacturer: "Girard", patterns: [/\bgirard\b/i, /(?:^|\s)(?:жирар|жирард)(?:\s|,|$)/i] },
  { manufacturer: "Norcold", patterns: [/\bnorcold\b/i, /(?:^|\s)(?:норкольд|норколд)(?:\s|,|$)/i] },
  { manufacturer: "Coleman", patterns: [/\bcoleman\b/i, /(?:^|\s)(?:колеман|колман)(?:\s|,|$)/i] },
  { manufacturer: "Lippert", patterns: [/\blippert\b/i, /(?:^|\s)(?:липперт|липерт)(?:\s|,|$)/i] },
  { manufacturer: "Carefree", patterns: [/\bcarefree\b/i] },
  { manufacturer: "Duo-Therm", patterns: [/\bduo[\s-]?therm\b/i] },
  { manufacturer: "Hydroflame", patterns: [/\bhydroflame\b/i, /\bhydro[\s-]?flame\b/i] },
  { manufacturer: "Whale", patterns: [/\bwhale\b/i] },
  { manufacturer: "Shurflo", patterns: [/\bshurflo\b/i] },
  { manufacturer: "Truma", patterns: [/\btruma\b/i] },
];

const MODEL_PATTERNS: RegExp[] = [
  // Suburban water heater models: SW6DE, SW10DE, SW16DE, SW6P, SW12DE, etc.
  /\b(SW\d{1,2}[A-Z]{0,3})\b/i,
  // Atwood water heater models: G6A-8E, G10-2, GC6AA-10E, GC10A-4E, etc.
  /\b(GC?\d{1,2}A{0,2}-?\d{0,2}[A-Z]{0,2})\b/,
  // Atwood with hyphen: G6A-8E
  /\b(G\d{1,2}[A-Z]-\d[A-Z]?)\b/,
  // Generic alphanumeric model patterns (e.g., "model 6941", "RM2652")
  /\bmodel\s+([A-Z0-9][-A-Z0-9]{2,12})\b/i,
  /\b(RM\d{3,5}[A-Z]?)\b/i, // Norcold/Dometic fridge models
  /\b(NXA?\d{3,4}[A-Z]?)\b/i, // Dometic AC models
  // Russian: "модель X"
  /\bмодель\s+([A-Za-z0-9][-A-Za-z0-9]{2,12})\b/i,
];

const YEAR_PATTERN = /\b(19[89]\d|20[012]\d)\b/;

/**
 * Extract equipment identity (manufacturer, model, year) from a technician message.
 * Returns partial identity — only fields that were found.
 */
export function extractEquipmentIdentity(message: string): EquipmentIdentity {
  const identity: EquipmentIdentity = { manufacturer: null, model: null, year: null };

  for (const { manufacturer, patterns } of MANUFACTURER_PATTERNS) {
    if (patterns.some(p => p.test(message))) {
      identity.manufacturer = manufacturer;
      break;
    }
  }

  for (const pattern of MODEL_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      identity.model = match[1].toUpperCase();
      break;
    }
  }

  const yearMatch = message.match(YEAR_PATTERN);
  if (yearMatch) {
    identity.year = parseInt(yearMatch[1], 10);
  }

  return identity;
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
