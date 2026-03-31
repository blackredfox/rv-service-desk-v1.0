/**
 * Diagnostic Registry — per-case procedure-aware step tracking.
 *
 * Tracks which diagnostic steps have been completed or marked as
 * unable-to-verify, so the agent never repeats closed questions.
 *
 * Also detects "key findings" that trigger immediate diagnostic pivoting,
 * and "already answered" / "unable to verify" signals from the technician.
 */

import {
  detectSystem,
  getProcedure,
  getNextStep,
  getNextStepBranchAware,
  detectBranchTrigger,
  getMutuallyExclusiveBranches,
  mapInitialMessageToSteps,
  buildProcedureContext,
  getLocalizedProcedureDisplayName,
  getLocalizedStepHowToCheck,
  getLocalizedStepQuestion,
  type DiagnosticProcedure,
  type ProcedureBranch,
} from "./diagnostic-procedures";
import type { Language } from "./lang";

type DiagnosticEntry = {
  /** Active procedure system (e.g. "water_pump") */
  procedureSystem: string | null;
  /** Resolved procedure object */
  procedure: DiagnosticProcedure | null;
  /** Step IDs completed by the technician */
  completedStepIds: Set<string>;
  /** Step IDs the technician cannot verify */
  unableStepIds: Set<string>;
  /** Step IDs that have already been asked (de-dupe guard) */
  askedStepIds: Set<string>;
  /** Whether the technician just asked "how to check?" (transient flag) */
  howToCheckRequested: boolean;
  /** Legacy topic tracking (backward compat) */
  answeredKeys: Set<string>;
  /** Legacy unable-to-verify topics */
  unableToVerifyKeys: Set<string>;
  /** Key findings that may trigger early isolation */
  keyFindings: string[];
  /** Whether initial message has been processed */
  initialized: boolean;
  /** P1.5: Active branch ID (null = main flow) */
  activeBranchId: string | null;
  /** P1.5: Decision path history */
  decisionPath: Array<{ stepId: string; branchId: string | null; reason: string; timestamp: string }>;
  /** P1.5: Branches that are locked out */
  lockedOutBranches: Set<string>;
};

const registry = new Map<string, DiagnosticEntry>();

function ensureEntry(caseId: string): DiagnosticEntry {
  let entry = registry.get(caseId);
  if (!entry) {
    entry = {
      procedureSystem: null,
      procedure: null,
      completedStepIds: new Set(),
      unableStepIds: new Set(),
      askedStepIds: new Set(),
      howToCheckRequested: false,
      answeredKeys: new Set(),
      unableToVerifyKeys: new Set(),
      keyFindings: [],
      initialized: false,
      // P1.5: Branch state
      activeBranchId: null,
      decisionPath: [],
      lockedOutBranches: new Set(),
    };
    registry.set(caseId, entry);
  }
  return entry;
}

// ── Answered detection ──────────────────────────────────────────────

const ALREADY_ANSWERED_PATTERNS = [
  /already\s+(?:checked|tested|verified|answered|told|said|mentioned|confirmed|reported|measured|looked)/i,
  /i\s+(?:already|just)\s+(?:checked|tested|verified|told|said|mentioned|confirmed|reported|measured)/i,
  /(?:told|said|mentioned)\s+(?:you|that)\s+(?:already|before|earlier)/i,
  /как\s+(?:я\s+)?(?:уже\s+)?(?:сказал|говорил|проверил|упомянул)/i,
  /уже\s+(?:проверил|проверено|сказал|ответил|делал|смотрел)/i,
  /ya\s+(?:lo\s+)?(?:revisé|verifiqué|dije|mencioné|comprobé)/i,
];

export function detectAlreadyAnswered(message: string): boolean {
  return ALREADY_ANSWERED_PATTERNS.some((p) => p.test(message));
}

// ── Unable-to-verify detection ──────────────────────────────────────

const UNABLE_TO_VERIFY_PATTERNS = [
  /(?:don'?t|do\s+not|can'?t|cannot|can\s+not)\s+(?:know|see|tell|check|verify|measure|test|access|reach)/i,
  /(?:no\s+(?:way|access|tool|meter|multimeter))\s+(?:to\s+)?(?:check|measure|verify|test)/i,
  /unable\s+to\s+(?:verify|check|confirm|measure|test|access)/i,
  /not\s+(?:sure|certain|able)\s+(?:about|how|if)/i,
  /(?:не\s+(?:знаю|могу|вижу|проверить|могу\s+проверить))/i,
  /(?:no\s+(?:sé|puedo|tengo))\s+(?:como|verificar|comprobar|medir)/i,
];

export function detectUnableToVerify(message: string): boolean {
  return UNABLE_TO_VERIFY_PATTERNS.some((p) => p.test(message));
}

// ── How-to-check detection ──────────────────────────────────────────

const HOW_TO_CHECK_PATTERNS = [
  /how\s+(?:do\s+I|to|can\s+I|should\s+I)\s+(?:check|test|measure|verify|inspect|diagnose)/i,
  /how\s+(?:do\s+I|to)\s+(?:do\s+(?:that|this|it))/i,
  /what\s+(?:should\s+I|do\s+I)\s+(?:use|need|look\s+for)/i,
  /(?:explain|show|tell)\s+(?:me\s+)?how/i,
  /как\s+(?:мне\s+)?(?:проверить|протестировать|измерить|проверять)/i,
  /(?:cómo|como)\s+(?:puedo\s+)?(?:verificar|comprobar|medir|probar|revisar)/i,
];

export function detectHowToCheck(message: string): boolean {
  return HOW_TO_CHECK_PATTERNS.some((p) => p.test(message));
}

// ── Legacy topic extraction (backward compat) ───────────────────────

const DIAGNOSTIC_TOPICS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "voltage", patterns: [/volt(?:age|s)?/i, /напряжени/i, /voltaje/i] },
  { key: "ground", patterns: [/ground/i, /земл/i, /tierra/i, /continuity/i] },
  { key: "pump_noise", patterns: [/pump.*(?:noise|sound|hum|vibrat)/i, /насос.*(?:шум|звук)/i] },
  { key: "pressure_switch", patterns: [/pressure\s*switch/i, /реле\s*давлен/i] },
  { key: "visual_inspection", patterns: [/visual|corrosion|burn\s*mark|damage/i, /визуальн|коррози/i] },
  { key: "breaker_fuse", patterns: [/breaker|fuse/i, /автомат|предохранител/i] },
  { key: "thermostat", patterns: [/thermostat/i, /термостат/i] },
  { key: "capacitor", patterns: [/capacitor/i, /конденсатор/i] },
  { key: "compressor", patterns: [/compressor/i, /компрессор/i] },
  { key: "blower_fan", patterns: [/blower|fan\s*(?:blade|wheel|motor)/i, /вентилятор|лопаст/i] },
  { key: "igniter", patterns: [/ignit(?:er|ion)/i, /поджиг|розжиг/i] },
  { key: "gas_valve", patterns: [/gas\s*valve/i, /газовый\s*клапан/i] },
  { key: "flame_sensor", patterns: [/flame\s*sensor/i, /датчик\s*пламен/i] },
  { key: "filter", patterns: [/filter/i, /фильтр/i] },
  { key: "contactor", patterns: [/contactor/i, /контактор/i] },
  { key: "condenser_fan", patterns: [/condenser\s*fan/i, /вентилятор\s*конденсатор/i] },
  { key: "water_damage", patterns: [/water.*(?:damage|leak)/i, /повреждение.*вод/i] },
  { key: "error_codes", patterns: [/error\s*code|fault\s*(?:code|light|indicator)/i, /код\s*ошиб/i] },
  { key: "wiring", patterns: [/wir(?:ing|e)\s*(?:connection|damage)/i, /провод/i] },
];

export function extractTopics(message: string): string[] {
  const found: string[] = [];
  for (const topic of DIAGNOSTIC_TOPICS) {
    if (topic.patterns.some((p) => p.test(message))) {
      found.push(topic.key);
    }
  }
  return found;
}

// ── Key finding (pivot trigger) detection ───────────────────────────

const KEY_FINDING_PATTERNS: Array<{ pattern: RegExp; finding: string }> = [
  { pattern: /missing\s+(?:fan\s*)?blade/i, finding: "missing fan blade" },
  { pattern: /(?:fan|blower)\s*(?:blade|wheel)\s*(?:is\s+)?(?:missing|broken|cracked|gone)/i, finding: "fan/blower blade damage" },
  { pattern: /blower\s*wheel\s*(?:has\s+)?(?:damage|crack|broken|gone|missing)/i, finding: "blower wheel damage" },
  { pattern: /(?:has\s+)?(?:crack|damage)\s*(?:on|in|to)?\s*(?:the\s+)?(?:blower|fan)\s*wheel/i, finding: "blower wheel damage" },
  { pattern: /(?:component|blade|wheel|part)\s*(?:is\s+)?(?:contact|touch|rub|scraping)\s*(?:the\s+)?(?:housing|shroud|casing)/i, finding: "component contacting housing" },
  { pattern: /(?:contact|touch|rub|scrap)(?:s|ing)\s+(?:the\s+)?(?:housing|shroud|casing)/i, finding: "component contacting housing" },
  { pattern: /(?:visibly|visible|obvious)\s*(?:compromised|destroyed|snapped|shattered|melted|burnt)/i, finding: "visibly compromised part" },
  { pattern: /(?:motor|compressor|pump)\s*(?:is\s+)?(?:seized|locked|frozen|burnt\s*out)/i, finding: "seized/locked motor" },
  { pattern: /(?:seized|locked)\s*(?:up)?\s*(?:and)?\s*(?:won'?t|will\s*not|doesn'?t)\s*(?:turn|spin|move|run)/i, finding: "seized/locked motor" },
  { pattern: /(?:coil|winding)\s*(?:is\s+)?(?:open|short|burnt)/i, finding: "open/shorted coil" },
  { pattern: /(?:crack|hole|split)\s*(?:in\s+)?(?:the\s+)?(?:housing|casing|body|tank)/i, finding: "cracked housing" },
  { pattern: /(?:housing|casing|body|tank)\s*(?:has\s+)?(?:a\s+)?(?:crack|hole|split)/i, finding: "cracked housing" },
  { pattern: /(?:no|zero)\s*(?:resistance|continuity)\s*(?:through|across|at)/i, finding: "open circuit confirmed" },
  { pattern: /(?:amp|current)\s*draw\s*(?:is\s+)?(?:zero|0|none)/i, finding: "zero current draw" },
  { pattern: /(?:shaft|axle|bearing)\s*(?:is\s+)?(?:broken|snapped|worn\s*out|play|wobble)/i, finding: "mechanical failure" },
  { pattern: /(?:fuse).*(?:blown|bad|open|dead|burnt|burned|no\s*continu)/i, finding: "blown fuse" },
  { pattern: /(?:blown|bad|open|burnt|burned)\s*(?:fuse)/i, finding: "blown fuse" },
  { pattern: /(?:breaker).*(?:tripped|trip|open|off)/i, finding: "tripped circuit breaker" },
  { pattern: /(?:no\s*power)\s*(?:downstream|after\s*(?:fuse|breaker))/i, finding: "no power downstream of fuse/breaker" },
  { pattern: /предохранител.*(?:сгор|перегор|пробит)/i, finding: "blown fuse (RU)" },
  { pattern: /лопаст.*(?:отсутств|слома|повреж|нет)/i, finding: "blade missing/damaged (RU)" },
  { pattern: /(?:не|нет)\s*(?:сопротивлен|непрерывност)/i, finding: "open circuit (RU)" },
  // Water heater specific findings
  { pattern: /(?:orifice|nozzle|форсунк).*(?:blocked|clogged|damage|burnt|обгор|засор|разва)/i, finding: "damaged/blocked orifice" },
  { pattern: /(?:burner|горел).*(?:blocked|clogged|debris|spider|insect|засор|паук)/i, finding: "burner blockage" },
  { pattern: /(?:thermocouple|термопар).*(?:bad|fail|broken|no\s*reading|0\s*mv)/i, finding: "failed thermocouple" },
  { pattern: /(?:gas\s*valve|газов.*клапан).*(?:stuck|fail|no\s*flow|не\s*открыва)/i, finding: "gas valve failure" },
  { pattern: /(?:igniter|поджиг|розжиг).*(?:fail|no\s*spark|no\s*glow|broken|не\s*работ)/i, finding: "igniter failure" },
  { pattern: /(?:no|0)\s*(?:pressure|давлен).*(?:lp|gas|регулятор)/i, finding: "no LP pressure at regulator" },
  { pattern: /(?:eco|high\s*limit).*(?:trip|tripped|reset)/i, finding: "ECO/high-limit tripped" },
  { pattern: /форсунка.*(?:обгорел|развалива|прогор)/i, finding: "burnt/damaged orifice (RU)" },
];

export function detectKeyFinding(message: string): string | null {
  for (const { pattern, finding } of KEY_FINDING_PATTERNS) {
    if (pattern.test(message)) return finding;
  }
  return null;
}

// ── Procedure initialization ────────────────────────────────────────

/**
 * Initialize a case's procedure from the first message.
 * Detects the system, selects the procedure, and maps initial message to completed steps.
 */
export function initializeCase(caseId: string, message: string): {
  system: string | null;
  procedure: DiagnosticProcedure | null;
  preCompletedSteps: string[];
} {
  const entry = ensureEntry(caseId);

  if (entry.initialized && entry.procedure) {
    return {
      system: entry.procedureSystem,
      procedure: entry.procedure,
      preCompletedSteps: [],
    };
  }

  const system = detectSystem(message);
  const procedure = system ? getProcedure(system) : null;

  entry.procedureSystem = system;
  entry.procedure = procedure;
  entry.initialized = true;

  let preCompletedSteps: string[] = [];

  if (procedure) {
    preCompletedSteps = mapInitialMessageToSteps(message, procedure);
    for (const stepId of preCompletedSteps) {
      entry.completedStepIds.add(stepId);
    }
  }

  return { system, procedure, preCompletedSteps };
}

// ── Per-message processing ──────────────────────────────────────────

/**
 * Process a technician message: update the registry with step completions,
 * unable-to-verify, key findings, and legacy topic tracking.
 *
 * When activeStepId is provided (authoritative mode), step completion matching
 * runs ONLY against that step, not against all steps in the procedure.
 */
export function processUserMessage(caseId: string, message: string, activeStepId?: string | null): {
  newAnswered: string[];
  newUnable: string[];
  keyFinding: string | null;
  alreadyAnswered: boolean;
  completedStepIds: string[];
  unableStepIds: string[];
  howToCheckRequested: boolean;
} {
  const entry = ensureEntry(caseId);
  const topics = extractTopics(message);
  const isAlreadyAnswered = detectAlreadyAnswered(message);
  const isUnableToVerify = detectUnableToVerify(message);
  const isHowToCheck = detectHowToCheck(message);
  const keyFinding = detectKeyFinding(message);

  const newAnswered: string[] = [];
  const newUnable: string[] = [];
  const completedStepIds: string[] = [];
  const unableStepIds: string[] = [];

  // Reset transient flag
  entry.howToCheckRequested = false;

  // If the technician asks "how to check?" — do NOT close the step, just flag it
  if (isHowToCheck) {
    entry.howToCheckRequested = true;
    return {
      newAnswered,
      newUnable,
      keyFinding: null,
      alreadyAnswered: false,
      completedStepIds,
      unableStepIds,
      howToCheckRequested: true,
    };
  }

  // Procedure-aware step tracking — match ONLY against active step
  if (entry.procedure && activeStepId) {
    const step = entry.procedure.steps.find(s => s.id === activeStepId);
    if (step && !entry.completedStepIds.has(step.id) && !entry.unableStepIds.has(step.id)) {
      // In authoritative mode, the technician's reply to the active step
      // is always treated as an answer (pattern match is secondary)
      if (isUnableToVerify) {
        entry.unableStepIds.add(step.id);
        unableStepIds.push(step.id);
      } else {
        entry.completedStepIds.add(step.id);
        completedStepIds.push(step.id);
      }
    }
  } else if (entry.procedure) {
    // Legacy fallback: match against all steps (for backward compat)
    for (const step of entry.procedure.steps) {
      if (entry.completedStepIds.has(step.id) || entry.unableStepIds.has(step.id)) continue;

      if (step.matchPatterns.some((p) => p.test(message))) {
        if (isUnableToVerify) {
          entry.unableStepIds.add(step.id);
          unableStepIds.push(step.id);
        } else {
          entry.completedStepIds.add(step.id);
          completedStepIds.push(step.id);
        }
      }
    }
  }

  // Legacy topic tracking
  for (const topic of topics) {
    if (isUnableToVerify) {
      if (!entry.unableToVerifyKeys.has(topic)) {
        entry.unableToVerifyKeys.add(topic);
        newUnable.push(topic);
      }
    } else {
      if (!entry.answeredKeys.has(topic)) {
        entry.answeredKeys.add(topic);
        newAnswered.push(topic);
      }
    }
  }

  if (keyFinding && !entry.keyFindings.includes(keyFinding)) {
    entry.keyFindings.push(keyFinding);
  }

  return { newAnswered, newUnable, keyFinding, alreadyAnswered: isAlreadyAnswered, completedStepIds, unableStepIds, howToCheckRequested: false };
}

// ── Context building ────────────────────────────────────────────────

/**
 * Build a context string injected into the diagnostic system prompt.
 *
 * AUTHORITATIVE MODE: When activeStepId is provided (from the context engine),
 * only that step's question is passed to the LLM. The engine, not the LLM,
 * determines step progression.
 */
export function buildRegistryContext(
  caseId: string,
  activeStepId?: string | null,
  language: Language = "EN",
): string {
  const entry = registry.get(caseId);
  if (!entry) return "";

  // Procedure-aware context
  if (entry.procedure) {
    return buildProcedureContext(
      entry.procedure,
      entry.completedStepIds,
      entry.unableStepIds,
      {
        howToCheckRequested: entry.howToCheckRequested,
        activeStepId: activeStepId ?? undefined,
        language,
      },
    );
  }

  // Legacy fallback
  const parts: string[] = [];

  if (entry.answeredKeys.size > 0) {
    parts.push(`ALREADY ANSWERED (do NOT ask again): ${[...entry.answeredKeys].join(", ")}`);
  }

  if (entry.unableToVerifyKeys.size > 0) {
    parts.push(`UNABLE TO VERIFY (closed — skip these): ${[...entry.unableToVerifyKeys].join(", ")}`);
  }

  if (entry.keyFindings.length > 0) {
    parts.push(`KEY FINDINGS: ${entry.keyFindings.join("; ")}`);
  }

  if (parts.length === 0) return "";

  return `DIAGNOSTIC REGISTRY (current case state):\n${parts.join("\n")}\nDo NOT repeat questions about topics listed above. Move forward.`;
}

/**
 * Check whether the case should pivot immediately to isolation based on key findings.
 */
export function shouldPivot(caseId: string): { pivot: boolean; finding?: string } {
  const entry = registry.get(caseId);
  if (!entry || entry.keyFindings.length === 0) return { pivot: false };
  return { pivot: true, finding: entry.keyFindings[entry.keyFindings.length - 1] };
}

/**
 * Check if all procedure steps are done for this case.
 */
export function isProcedureComplete(caseId: string): boolean {
  const entry = registry.get(caseId);
  if (!entry?.procedure) return false;
  const nextStep = getNextStep(entry.procedure, entry.completedStepIds, entry.unableStepIds);
  return nextStep === null;
}

/**
 * Mark a step as "asked" (de-dupe guard).
 * Returns false if the step was already asked (duplicate).
 */
export function markStepAsked(caseId: string, stepId: string): boolean {
  const entry = ensureEntry(caseId);
  if (entry.askedStepIds.has(stepId)) return false;
  entry.askedStepIds.add(stepId);
  return true;
}

/**
 * Check whether a step has already been asked.
 */
export function isStepAlreadyAsked(caseId: string, stepId: string): boolean {
  const entry = registry.get(caseId);
  return entry?.askedStepIds.has(stepId) ?? false;
}

/**
 * Get the registry entry (for testing/debugging).
 */
export function getRegistryEntry(caseId: string): DiagnosticEntry | undefined {
  return registry.get(caseId);
}

/**
 * Clear registry for a case (for testing).
 */
export function clearRegistry(caseId: string): void {
  registry.delete(caseId);
}

/**
 * Mark a step as completed in the registry.
 * Called by context-engine when technician answers a step.
 */
export function markStepCompleted(caseId: string, stepId: string): void {
  const entry = ensureEntry(caseId);
  entry.completedStepIds.add(stepId);
  entry.askedStepIds.add(stepId); // Also mark as asked to prevent re-asking
}

/**
 * Mark a step as unable to verify in the registry.
 */
export function markStepUnable(caseId: string, stepId: string): void {
  const entry = ensureEntry(caseId);
  entry.unableStepIds.add(stepId);
  entry.askedStepIds.add(stepId); // Also mark as asked
}

/**
 * Get the next available step ID for this case.
 * Uses branch-aware resolution (P1.5).
 * Returns null if all steps complete or no procedure.
 */
export function getNextStepId(caseId: string): string | null {
  const entry = registry.get(caseId);
  if (!entry?.procedure) return null;
  
  // Use branch-aware step resolution
  const step = getNextStepBranchAware(
    entry.procedure,
    entry.completedStepIds,
    entry.unableStepIds,
    entry.activeBranchId,
    entry.lockedOutBranches,
  );
  return step?.id ?? null;
}

/**
 * Process technician response and check for branch triggers.
 * If a branch is triggered, updates the branch state and returns the new branch info.
 */
export function processResponseForBranch(
  caseId: string,
  stepId: string,
  technicianResponse: string,
): { branchEntered: ProcedureBranch | null; lockedOut: string[] } {
  const entry = registry.get(caseId);
  if (!entry?.procedure) return { branchEntered: null, lockedOut: [] };
  
  // Only check for branch triggers from main flow
  if (entry.activeBranchId !== null) {
    return { branchEntered: null, lockedOut: [] };
  }
  
  const triggeredBranch = detectBranchTrigger(entry.procedure, stepId, technicianResponse);
  if (!triggeredBranch) {
    return { branchEntered: null, lockedOut: [] };
  }
  
  // Check if this branch is locked out (mutual exclusivity)
  if (entry.lockedOutBranches.has(triggeredBranch.id)) {
    console.log(`[DiagnosticRegistry] Branch ${triggeredBranch.id} is locked out, not entering`);
    return { branchEntered: null, lockedOut: [] };
  }
  
  // Enter the branch
  entry.activeBranchId = triggeredBranch.id;
  entry.decisionPath.push({
    stepId,
    branchId: triggeredBranch.id,
    reason: `Triggered by response pattern at ${stepId}`,
    timestamp: new Date().toISOString(),
  });
  
  // Lock out mutually exclusive branches
  const lockedOut = getMutuallyExclusiveBranches(entry.procedure, triggeredBranch.id);
  for (const lockedBranchId of lockedOut) {
    entry.lockedOutBranches.add(lockedBranchId);
  }
  
  console.log(`[DiagnosticRegistry] Branch entered: ${triggeredBranch.id}, locked out: ${lockedOut.join(", ") || "none"}`);
  
  return { branchEntered: triggeredBranch, lockedOut };
}

/**
 * Get current branch state for a case.
 */
export function getBranchState(caseId: string): {
  activeBranchId: string | null;
  decisionPath: Array<{ stepId: string; branchId: string | null; reason: string }>;
  lockedOutBranches: string[];
} {
  const entry = registry.get(caseId);
  if (!entry) {
    return { activeBranchId: null, decisionPath: [], lockedOutBranches: [] };
  }
  return {
    activeBranchId: entry.activeBranchId,
    decisionPath: entry.decisionPath.map(d => ({
      stepId: d.stepId,
      branchId: d.branchId,
      reason: d.reason,
    })),
    lockedOutBranches: [...entry.lockedOutBranches],
  };
}

/**
 * Manually set the active branch (used by context engine for replan).
 */
export function setActiveBranch(caseId: string, branchId: string | null, reason: string): void {
  const entry = ensureEntry(caseId);
  const previousBranch = entry.activeBranchId;
  entry.activeBranchId = branchId;
  entry.decisionPath.push({
    stepId: "manual",
    branchId,
    reason,
    timestamp: new Date().toISOString(),
  });
  console.log(`[DiagnosticRegistry] Branch changed: ${previousBranch} → ${branchId} (${reason})`);
}

/**
 * Exit the current branch and return to main flow.
 */
export function exitBranch(caseId: string, reason: string): void {
  const entry = registry.get(caseId);
  if (!entry || entry.activeBranchId === null) return;
  
  const exitedBranch = entry.activeBranchId;
  entry.activeBranchId = null;
  entry.decisionPath.push({
    stepId: "exit",
    branchId: null,
    reason: `Exited ${exitedBranch}: ${reason}`,
    timestamp: new Date().toISOString(),
  });
  console.log(`[DiagnosticRegistry] Exited branch: ${exitedBranch} (${reason})`);
}

/**
 * Get the active procedure for this case.
 */
export function getActiveProcedure(caseId: string): DiagnosticProcedure | null {
  const entry = registry.get(caseId);
  return entry?.procedure ?? null;
}

/**
 * Get the active step's question text for authoritative rendering.
 * Returns null if no active step.
 */
export function getActiveStepQuestion(caseId: string, activeStepId: string | null): string | null {
  if (!activeStepId) return null;
  const entry = registry.get(caseId);
  if (!entry?.procedure) return null;
  const step = entry.procedure.steps.find(s => s.id === activeStepId);
  return step?.question ?? null;
}

/**
 * Get complete step metadata for authoritative rendering.
 */
export function getActiveStepMetadata(
  caseId: string,
  activeStepId: string | null,
  language: Language = "EN",
): {
  id: string;
  question: string;
  howToCheck: string | null;
  procedureName: string;
  progress: { completed: number; total: number };
} | null {
  if (!activeStepId) return null;
  const entry = registry.get(caseId);
  if (!entry?.procedure) return null;
  const step = entry.procedure.steps.find(s => s.id === activeStepId);
  if (!step) return null;
  return {
    id: step.id,
    question: getLocalizedStepQuestion(entry.procedure, step, language),
    howToCheck: getLocalizedStepHowToCheck(entry.procedure, step, language) ?? null,
    procedureName: getLocalizedProcedureDisplayName(entry.procedure, language),
    progress: {
      completed: entry.completedStepIds.size + entry.unableStepIds.size,
      total: entry.procedure.steps.length,
    },
  };
}

/**
 * Count how many times a step has been asked in recent history.
 * Used for loop detection and recovery.
 */
export function getStepAskCount(caseId: string, stepId: string): number {
  const entry = registry.get(caseId);
  if (!entry) return 0;
  // Count from askedStepIds — each ask is tracked
  // For more granular tracking, we'd need a history array
  return entry.askedStepIds.has(stepId) ? 1 : 0;
}

/**
 * Force-complete a step when loop recovery is needed.
 * Marks the step as "unable to verify" to allow forward progress.
 */
export function forceStepComplete(caseId: string, stepId: string, reason: "loop_recovery" | "unable"): void {
  const entry = ensureEntry(caseId);
  if (reason === "loop_recovery") {
    // Mark as unable rather than completed — preserves diagnostic accuracy
    entry.unableStepIds.add(stepId);
  } else {
    entry.unableStepIds.add(stepId);
  }
  entry.askedStepIds.add(stepId);
  console.log(`[DiagnosticRegistry] Force-completed step ${stepId} (reason: ${reason})`);
}

/**
 * Check if procedure is complete (all steps done or unable).
 */
export function isProcedureFullyComplete(caseId: string): boolean {
  const entry = registry.get(caseId);
  if (!entry?.procedure) return false;
  const nextStep = getNextStep(entry.procedure, entry.completedStepIds, entry.unableStepIds);
  return nextStep === null;
}
