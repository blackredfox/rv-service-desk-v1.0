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
  DiagnosticStateSnapshot,
  RecentStepResolution,
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

// ── Terminal-State Engine (P1.7) ───────────────────────────────────────
//
// Three-phase progressive model:
//   Phase "normal"          — diagnostic in progress
//   Phase "fault_candidate" — strong fault identified, ONE restoration check allowed
//   Phase "terminal"        — fault + restoration confirmed → hard stop
//
// RESTORATION_PATTERNS require repair + working → proves all 3 conditions in one message.
// FAULT_PATTERNS identify a concrete fault → moves to fault_candidate.
// SIMPLE_RESTORATION_PATTERNS (used ONLY in fault_candidate) catch simple confirmations.
//
// Terminal state DOMINATES all step assignment. No code path may override it.

import type { TerminalPhase, TerminalState } from "./types";

const MIN_STEPS_FOR_COMPLETION = 1;

const RESTORATION_PATTERNS: RegExp[] = [
  // English: "after [repair] ... works/running/operational"
  /after.{0,80}(?:fix|repair|replac|restor|reconnect|rewir|splicin|replacing|repairing|fixing|restoring|reconnecting|rewiring).{0,100}(?:work(?:ing|s)?|operational|functional|running|heating|firing|started|back\s+up)/i,
  // English: "repaired/fixed/replaced ... now works"
  /(?:repair(?:ed)?|fix(?:ed)?|replac(?:ed)?|restor(?:ed)?|reconnect(?:ed)?|rewir(?:ed)?|spliced?).{0,80}(?:now\s+)?(?:work(?:ing|s)?|operational|running|heating|functional|back\s+up)/i,
  // English: "works/running after repair/fix"
  /(?:work(?:ing|s)?|operational|running|heating)\s*(?:now|again)?\s+(?:after|following)\s+(?:fix|repair|replac|restor|reconnect|rewir)/i,
  // Russian: "после [восстановления/замены/...] ... работает/заработал"
  /после.{0,60}(?:восстановлен|замен|ремонт|починк|устранен|подключен|отремонтир|починен).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился|включается|нагревает)/i,
  // Russian: "[repair verb] + работает" — core pattern for TestCase11/12
  /(?:восстановил|починил|заменил|отремонтировал|подключил|устранил).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился)/i,
  // Russian: explicit resolution phrasing after repair
  /(?:заменил|восстановил|починил|устранил).{0,120}(?:теперь\s+)?(?:водонагреватель|система|оборудование)?.{0,40}(?:работает|работает\s*нормально|функционирует|заработал).{0,40}(?:проблема\s+устранена|неисправность\s+устранена|исправен)/i,
  /(?:проблема\s+устранена|неисправность\s+устранена).{0,80}(?:работает|заработал|функционирует)|(?:работает|заработал|функционирует).{0,80}(?:проблема\s+устранена|неисправность\s+устранена)/i,
  // Russian: "[unk repair] проводку + работает" — wiring-specific restoration
  /(?:заменил|восстановил|отремонтировал|починил)\s+проводку.{0,80}(?:работает|заработал|функционирует)/i,
  // Russian: loose "работает" after a temporal/causal sequence
  /(?:работает(?:\s+нормально)?|заработал).{0,40}после/i,
  // Spanish: "después/tras [repair] ... funciona"
  /(?:después\s+de|tras)\s+(?:reparar|reemplazar|restaurar|reconectar|arreglar|cambiar).{0,100}(?:funciona|opera|trabaja)/i,
  /(?:repar(?:é|e|ado)|reemplaz(?:é|ado)|restaur(?:é|ado)|arregl(?:é|ado)).{0,80}(?:funciona|opera|trabaja)/i,
];

const FAULT_PATTERNS: RegExp[] = [
  /\b(?:blown|failed|faulty|bad)\s+fuse\b/i,
  /\bfuse\b.{0,40}\b(?:blown|failed|faulty|bad)\b/i,
  // English: component first then state word (e.g. "the relay board is burnt")
  /\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b.{0,80}\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b/i,
  // English: state word first then component (e.g. "burnt relay board")
  /\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b.{0,60}\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b/i,
  // English: short circuit / open circuit in wiring
  /\b(?:short\s+circuit|open\s+circuit|wiring\s+fault|wiring\s+break|broken\s+wire|severed\s+wire)\b/i,
  // English: power+ground confirmed but component not responding
  /(?:power|voltage|12v|12\s*volt).{0,60}(?:confirmed|present|verified).{0,80}(?:motor|pump|board|relay|valve).{0,40}(?:not\s+run|not\s+work|won'?t\s+start|no\s+response|dead|nothing)/i,
  // Russian: "короткое замыкание" (short circuit) — Issue 1 in TestCase12
  /короткое\s+замыкание/i,
  /(?:неисправен|перегорел|сгорел)\s+предохранитель/i,
  /предохранитель.{0,40}(?:неисправен|перегорел|сгорел)/i,
  // Russian: "обрыв проводки/провода/цепи" (wiring/circuit break)
  /обрыв\s+(?:проводки|провода|цепи|питания)/i,
  // Russian: "разрыв проводки/провода" (wiring break)
  /разрыв\s+(?:проводки|провода|цепи)/i,
  // Russian: "повреждение проводки" (wiring damage)
  /повреждение\s+(?:проводки|провода)/i,
  // Russian: destructive finding + component — NO \b (Cyrillic not in \w, \b is unreliable)
  /(?:^|[\s,—])(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил|неисправ[а-яё]+)(?:$|[\s,—]).{0,60}(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер)/i,
  // Russian: component + destructive finding
  /(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер).{0,60}(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил)/i,
  // Russian (simpler fallback for start-of-message): "сгорел мотор"
  /^(?:сгорел|оплавился|вздулся|перегорел|подгорел)\s+(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор)/i,
  // Spanish: quemado/fundido + component
  /\b(?:quemado|fundido|dañado|cortocircuito)\b.{0,60}\b(?:placa|motor|relé|válvula|bomba|módulo|condensador)\b/i,
];

// Used ONLY in fault_candidate phase — simpler patterns for restoration confirmation
// after the system asked "Is the system working now?"
const SIMPLE_RESTORATION_PATTERNS: RegExp[] = [
  // English: positive working confirmation
  /\b(?:work(?:ing|s)|operational|functional|running|heating|started|back\s+up|fixed|resolved)\b/i,
  // Russian: positive working confirmation
  /(?:работает|заработал|функционирует|запустился|включается|нагревает|исправен|починен|устранено|устранил)/i,
  // Spanish: positive working confirmation
  /(?:funciona|opera|trabaja|arreglado|resuelto|reparado)/i,
  // Simple affirmative when restoration check was explicitly asked
  // Allows prefix: "да, подтверждаю" (yes, I confirm), "yes, confirmed" etc.
  /^(?:да|yes|sí|si|yep|yup|ага|угу|correct|верно|точно|exactly|подтверждаю|confirmed|confirmo)/i,
];

// Negative restoration patterns — prevent false terminal state on denial
const NEGATIVE_RESTORATION: RegExp[] = [
  /(?:not|don'?t|doesn'?t|won'?t|can'?t|still\s+(?:not|doesn'?t|won'?t))\s+(?:work|run|start|heat|function|operat)/i,
  /(?:не\s+работает|не\s+запускается|не\s+включается|не\s+нагревает|всё\s+ещё\s+не|по-прежнему\s+не)/i,
  /(?:no\s+funciona|no\s+trabaja|no\s+opera|sigue\s+sin)/i,
  /^(?:нет|no|nope|nah)$/i,
];

type TerminalStateUpdate = {
  changed: boolean;
  previousPhase: TerminalPhase;
  newPhase: TerminalPhase;
};

/**
 * P1.7 — Progressive terminal-state update.
 *
 * Checks each message against three conditions and accumulates them:
 *  1. RESTORATION_PATTERNS (repair + working) → proves all 3 in one message
 *  2. FAULT_PATTERNS → records fault, moves to fault_candidate
 *  3. SIMPLE_RESTORATION_PATTERNS (only in fault_candidate) → confirms restoration
 *
 * Once all 3 conditions are met, phase becomes "terminal".
 */
function updateTerminalState(
  message: string,
  context: DiagnosticContext,
): TerminalStateUpdate {
  const ts = context.terminalState;
  const previousPhase = ts.phase;

  // Already terminal — nothing to do
  if (ts.phase === "terminal") {
    return { changed: false, previousPhase, newPhase: "terminal" };
  }

  // Require minimum diagnostic work before considering terminal conditions
  const totalDone = context.completedSteps.size + context.unableSteps.size;
  if (totalDone < MIN_STEPS_FOR_COMPLETION) {
    return { changed: false, previousPhase, newPhase: ts.phase };
  }

  const now = new Date().toISOString();
  let changed = false;

  // ── Phase 1: Check full RESTORATION_PATTERNS ───────────────────────
  // These require repair action + operational confirmation → all 3 conditions implied
  if (!ts.restorationConfirmed) {
    for (const pattern of RESTORATION_PATTERNS) {
      if (pattern.test(message)) {
        const text = message.slice(0, 120).replace(/\s+/g, " ").trim();
        ts.correctiveAction = ts.correctiveAction || { text, detectedAt: now };
        ts.restorationConfirmed = { text, detectedAt: now };
        // Infer fault — you don't repair without one
        if (!ts.faultIdentified) {
          ts.faultIdentified = { text: `Inferred from repair: ${text}`, detectedAt: now };
        }
        changed = true;
        break;
      }
    }
  }

  // ── Phase 2: Check FAULT_PATTERNS ─────────────────────────────────
  // Records fault, moves to fault_candidate (ONE restoration check allowed)
  if (!ts.faultIdentified) {
    for (const pattern of FAULT_PATTERNS) {
      if (pattern.test(message)) {
        ts.faultIdentified = {
          text: message.slice(0, 120).replace(/\s+/g, " ").trim(),
          detectedAt: now,
        };
        changed = true;
        break;
      }
    }
  }

  // ── Phase 3: Simple restoration check (fault_candidate only) ──────
  // When a fault was already identified and system asked one restoration check,
  // simpler patterns like "works" or "да" confirm restoration.
  if (ts.phase === "fault_candidate" && ts.faultIdentified && !ts.restorationConfirmed) {
    const isNegative = NEGATIVE_RESTORATION.some(p => p.test(message));
    if (!isNegative) {
      for (const pattern of SIMPLE_RESTORATION_PATTERNS) {
        if (pattern.test(message)) {
          const text = message.slice(0, 120).replace(/\s+/g, " ").trim();
          ts.correctiveAction = ts.correctiveAction || { text, detectedAt: now };
          ts.restorationConfirmed = { text, detectedAt: now };
          changed = true;
          break;
        }
      }
    }
  }

  // ── Determine phase ───────────────────────────────────────────────
  if (ts.faultIdentified && ts.restorationConfirmed) {
    ts.phase = "terminal";
  } else if (ts.faultIdentified && ts.phase === "normal") {
    ts.phase = "fault_candidate";
  }

  return {
    changed: changed || ts.phase !== previousPhase,
    previousPhase,
    newPhase: ts.phase,
  };
}

function cloneDecisionPath(context: DiagnosticContext) {
  return context.branchState.decisionPath.map((entry) => ({ ...entry }));
}

function cloneTopicStack(context: DiagnosticContext) {
  return context.topicStack.map((entry) => ({ ...entry }));
}

function cloneTerminalState(context: DiagnosticContext) {
  return {
    phase: context.terminalState.phase,
    faultIdentified: context.terminalState.faultIdentified
      ? { ...context.terminalState.faultIdentified }
      : null,
    correctiveAction: context.terminalState.correctiveAction
      ? { ...context.terminalState.correctiveAction }
      : null,
    restorationConfirmed: context.terminalState.restorationConfirmed
      ? { ...context.terminalState.restorationConfirmed }
      : null,
  };
}

function captureDiagnosticStateSnapshot(context: DiagnosticContext): DiagnosticStateSnapshot {
  return {
    activeStepId: context.activeStepId,
    completedSteps: [...context.completedSteps],
    unableSteps: [...context.unableSteps],
    askedSteps: [...context.askedSteps],
    branchState: {
      activeBranchId: context.branchState.activeBranchId,
      decisionPath: cloneDecisionPath(context),
      lockedOutBranches: [...context.branchState.lockedOutBranches],
    },
    terminalState: cloneTerminalState(context),
    isolationComplete: context.isolationComplete,
    isolationFinding: context.isolationFinding,
    isolationInvalidated: context.isolationInvalidated,
    replanReason: context.replanReason,
    submode: context.submode,
    previousSubmode: context.previousSubmode,
    topicStack: cloneTopicStack(context),
  };
}

function buildRecentStepResolution(args: {
  context: DiagnosticContext;
  stepId: string;
  resolution: RecentStepResolution["resolution"];
  technicianMessage: string;
}): RecentStepResolution {
  return {
    stepId: args.stepId,
    resolution: args.resolution,
    technicianMessage: args.technicianMessage,
    capturedAt: new Date().toISOString(),
    snapshot: captureDiagnosticStateSnapshot(args.context),
  };
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
    // P1.7: Terminal state initialization
    terminalState: {
      phase: "normal",
      faultIdentified: null,
      correctiveAction: null,
      restorationConfirmed: null,
    },
    facts: [],
    hypotheses: [],
    contradictions: [],
    lastAgentActions: [],
    consecutiveFallbacks: 0,
    recentStepResolution: null,
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
    // P1.7: Ensure terminalState exists (hot-reload migration safety)
    if (!existing.terminalState) {
      existing.terminalState = {
        phase: "normal",
        faultIdentified: null,
        correctiveAction: null,
        restorationConfirmed: null,
      };
    }
    if (existing.recentStepResolution === undefined) {
      existing.recentStepResolution = null;
    }
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
  
  // 2. Check for replan triggers (only if isolation was complete AND not terminal)
  // P1.7: Terminal state must not be undone by replan
  if (config.enableReplan && context.isolationComplete && context.terminalState.phase !== "terminal") {
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
        context.recentStepResolution = buildRecentStepResolution({
          context,
          stepId: completedStepId,
          resolution: "unable",
          technicianMessage: message,
        });
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
        context.recentStepResolution = buildRecentStepResolution({
          context,
          stepId: completedStepId,
          resolution: "completed",
          technicianMessage: message,
        });
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
  
  // 4.5. P1.7 — Terminal-state progression
  // Runs after step completion so completedSteps count is up-to-date.
  // Progressive: accumulates fault/restoration across messages.
  // When terminal: sets isolationComplete + clears activeStepId.
  // When fault_candidate: clears activeStepId (no more diagnostic steps, ask restoration check).
  const tsUpdate = updateTerminalState(message, context);
  if (tsUpdate.changed) {
    if (context.terminalState.phase === "terminal") {
      context.isolationComplete = true;
      const systemDisplay = (context.primarySystem ?? "system").replace(/_/g, " ");
      const restorationText = context.terminalState.restorationConfirmed?.text ?? message.slice(0, 120);
      context.isolationFinding = `Verified restoration — ${systemDisplay}: ${restorationText}`;
      context.activeStepId = null;
      notices.push(`TERMINAL STATE reached: ${context.isolationFinding}`);
      stateChanged = true;
    } else if (context.terminalState.phase === "fault_candidate" && tsUpdate.previousPhase === "normal") {
      // Just entered fault_candidate — stop step progression, await restoration
      context.activeStepId = null;
      notices.push(`Strong fault identified: ${context.terminalState.faultIdentified!.text} — awaiting restoration confirmation`);
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
  //    (but NOT when isolation is complete or terminal state is non-normal —
  //     fault_candidate and terminal phases must never have a step assigned)
  if (!context.activeStepId && context.activeProcedureId && !context.isolationComplete && context.terminalState.phase === "normal") {
    const nextId = registryGetNextStepId(caseId);
    if (nextId) {
      context.activeStepId = nextId;
      notices.push(`Active step initialized: ${nextId}`);
      stateChanged = true;
    }
  }
  
  // ── P1.7 TERMINAL STATE FINAL ENFORCEMENT ─────────────────────────
  // This is the DOMINANT rule. No matter what steps 1-6 did above,
  // terminal state wins. No code path may assign a step in non-normal phase.
  if (context.terminalState.phase !== "normal") {
    context.activeStepId = null;
    if (context.terminalState.phase === "terminal") {
      context.isolationComplete = true;
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
  
  // Handle isolation complete — offer completion (P1.6/P1.7 terminal)
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

  // Handle fault_candidate — ask ONE restoration check (P1.7)
  // Fault identified but no restoration yet. No more diagnostic questions allowed.
  if (context.terminalState.phase === "fault_candidate" && context.terminalState.faultIdentified) {
    return {
      action: "ask_restoration_check",
      constraints: [
        `FAULT IDENTIFIED: ${context.terminalState.faultIdentified.text}`,
        "MANDATORY: Acknowledge the fault finding briefly.",
        "MANDATORY: Ask ONE question to confirm if repair was done and system is now operational.",
        "MANDATORY: This is the ONLY allowed question. Do NOT ask any other diagnostic question.",
        "PROHIBITED: Do NOT continue with more procedure steps.",
        "PROHIBITED: Do NOT expand into other diagnostic branches.",
        "PROHIBITED: Do NOT ask unrelated diagnostic subquestions.",
        "Example EN: 'Understood. Has the repair been completed? Is the system working now?'",
        "Example RU: 'Принято. Ремонт выполнен? Система работает?'",
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

export function restoreRecentStepResolution(caseId: string): RecentStepResolution | null {
  const context = getContext(caseId);
  const recent = context?.recentStepResolution;
  if (!context || !recent) return null;

  const snapshot = recent.snapshot;
  context.activeStepId = snapshot.activeStepId;
  context.completedSteps = new Set(snapshot.completedSteps);
  context.unableSteps = new Set(snapshot.unableSteps);
  context.askedSteps = new Set(snapshot.askedSteps);
  context.branchState = {
    activeBranchId: snapshot.branchState.activeBranchId,
    decisionPath: snapshot.branchState.decisionPath.map((entry) => ({ ...entry })),
    lockedOutBranches: new Set(snapshot.branchState.lockedOutBranches),
  };
  context.terminalState = {
    phase: snapshot.terminalState.phase,
    faultIdentified: snapshot.terminalState.faultIdentified
      ? { ...snapshot.terminalState.faultIdentified }
      : null,
    correctiveAction: snapshot.terminalState.correctiveAction
      ? { ...snapshot.terminalState.correctiveAction }
      : null,
    restorationConfirmed: snapshot.terminalState.restorationConfirmed
      ? { ...snapshot.terminalState.restorationConfirmed }
      : null,
  };
  context.isolationComplete = snapshot.isolationComplete;
  context.isolationFinding = snapshot.isolationFinding;
  context.isolationInvalidated = snapshot.isolationInvalidated;
  context.replanReason = snapshot.replanReason;
  context.submode = snapshot.submode;
  context.previousSubmode = snapshot.previousSubmode;
  context.topicStack = snapshot.topicStack.map((entry) => ({ ...entry }));
  context.recentStepResolution = null;

  updateContext(context);
  return recent;
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
