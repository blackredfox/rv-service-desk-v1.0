/**
 * Replan Logic
 * 
 * Handles detection and execution of diagnostic replanning when
 * new evidence invalidates prior conclusions.
 */

import type { 
  DiagnosticContext, 
  ReplanResult, 
  Fact,
  EvidenceType,
} from "./types";
import { detectNewEvidence } from "./intent-router";

// ── Replan Trigger Patterns ─────────────────────────────────────────

// High-confidence physical evidence that forces replan
const HIGH_CONFIDENCE_EVIDENCE = [
  /(?:hole|leak|crack|split)\s+(?:in|on|at)\s+(?:the\s+)?(?:coil|evaporator|condenser|line|housing)/i,
  /refrigerant\s+(?:leak|loss|low)/i,
  /(?:burnt|melted|destroyed)\s+(?:wire|wiring|connector|component)/i,
  /(?:water|coolant|oil)\s+(?:leak|puddle|dripping)/i,
  /(?:visible|obvious)\s+(?:damage|failure|burn|corrosion)/i,
];

// Evidence that contradicts prior measurements
const CONTRADICTION_PATTERNS = [
  /(?:now|but\s+now)\s+(?:it|it'?s|I)\s+(?:shows?|reads?|get|measure)/i,
  /(?:changed|different|not\s+the\s+same)\s+(?:reading|voltage|measurement)/i,
  /(?:wait|actually|hold\s+on)[,.]?\s+(?:the|it)/i,
];

// ── Replan Detection ────────────────────────────────────────────────

/**
 * Check if a message contains evidence that should trigger a replan.
 * Only applies when isolation was previously marked complete.
 */
export function shouldReplan(
  message: string,
  context: DiagnosticContext,
): ReplanResult {
  // Only trigger replan if isolation was previously complete
  if (!context.isolationComplete) {
    return { shouldReplan: false };
  }
  
  // Check for new evidence
  const evidenceCheck = detectNewEvidence(message);
  if (evidenceCheck.hasNewEvidence) {
    // Determine if this is high-confidence evidence
    const isHighConfidence = HIGH_CONFIDENCE_EVIDENCE.some(p => p.test(message));
    
    if (isHighConfidence || evidenceCheck.evidenceType === "physical_damage") {
      return {
        shouldReplan: true,
        reason: `New ${evidenceCheck.evidenceType} evidence after isolation: ${message.slice(0, 100)}`,
        invalidatedFacts: findInvalidatedFacts(context, evidenceCheck.evidenceType!),
        newBranch: determineBranch(message, evidenceCheck.evidenceType!),
      };
    }
    
    // For measurement changes and disputes, be more conservative
    if (evidenceCheck.evidenceType === "measurement_change") {
      // Check if this contradicts a prior fact
      const contradiction = findContradiction(message, context.facts);
      if (contradiction) {
        return {
          shouldReplan: true,
          reason: `Measurement contradicts prior finding: ${contradiction}`,
          invalidatedFacts: [contradiction],
        };
      }
    }
    
    if (evidenceCheck.evidenceType === "technician_dispute") {
      // Log the dispute but don't auto-replan - may need human judgment
      console.log(`[Replan] Technician dispute detected: ${message.slice(0, 100)}`);
      // Only replan if they provide concrete counter-evidence
      if (CONTRADICTION_PATTERNS.some(p => p.test(message))) {
        return {
          shouldReplan: true,
          reason: `Technician disputes with counter-evidence`,
        };
      }
    }
  }
  
  return { shouldReplan: false };
}

/**
 * Execute a replan: invalidate prior conclusions and prepare for new branch
 */
export function executeReplan(
  context: DiagnosticContext,
  replanResult: ReplanResult,
): DiagnosticContext {
  const now = new Date().toISOString();
  
  // Mark prior isolation as invalidated
  const updatedContext: DiagnosticContext = {
    ...context,
    isolationComplete: false,
    causeAllowed: false,
    isolationInvalidated: true,
    replanReason: replanResult.reason || "New evidence invalidated prior conclusion",
    updatedAt: now,
  };
  
  // Mark invalidated facts as superseded
  if (replanResult.invalidatedFacts && replanResult.invalidatedFacts.length > 0) {
    updatedContext.facts = context.facts.map(fact => {
      if (replanResult.invalidatedFacts!.includes(fact.id)) {
        return { ...fact, supersededBy: `replan_${now}` };
      }
      return fact;
    });
  }
  
  // Add a replan notice to action history
  updatedContext.lastAgentActions = [
    ...context.lastAgentActions,
    {
      type: "replan_notice",
      content: replanResult.reason || "Replan triggered",
      timestamp: now,
    },
  ];
  
  // If a new branch was identified, update the active step
  if (replanResult.newBranch) {
    // The new branch will be determined by the procedure logic
    // We just clear the active step so it can be re-evaluated
    updatedContext.activeStepId = null;
  }
  
  return updatedContext;
}

/**
 * Build replan notice for the LLM prompt
 */
export function buildReplanNotice(
  context: DiagnosticContext,
): string | null {
  if (!context.isolationInvalidated || !context.replanReason) {
    return null;
  }
  
  const lines = [
    "REPLAN NOTICE (CRITICAL — READ CAREFULLY):",
    "",
    `Previous isolation was invalidated: ${context.replanReason}`,
    "",
    "You MUST:",
    "1. Acknowledge the new evidence/finding",
    "2. Explain that this changes the diagnosis",
    "3. Return to diagnostic questioning to explore the new branch",
    "4. Do NOT repeat the previous conclusion",
    "",
    "Example response:",
    '"I see — you found [new evidence]. This changes our diagnosis. Let me ask about [new branch]..."',
  ];
  
  return lines.join("\n");
}

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Find facts that would be invalidated by new evidence
 */
function findInvalidatedFacts(
  context: DiagnosticContext,
  evidenceType: EvidenceType,
): string[] {
  const invalidated: string[] = [];
  
  // If new physical damage is found, invalidate prior "component ok" findings
  if (evidenceType === "physical_damage") {
    for (const fact of context.facts) {
      if (
        fact.type === "finding" &&
        (fact.value.includes("ok") || 
         fact.value.includes("good") || 
         fact.value.includes("normal") ||
         fact.value.includes("functioning"))
      ) {
        invalidated.push(fact.id);
      }
    }
  }
  
  // If isolation finding exists, it's now invalid
  if (context.isolationFinding) {
    const isolationFact = context.facts.find(
      f => f.value === context.isolationFinding
    );
    if (isolationFact) {
      invalidated.push(isolationFact.id);
    }
  }
  
  return invalidated;
}

/**
 * Find if a message contradicts any existing fact
 */
function findContradiction(message: string, facts: Fact[]): string | null {
  const msgLower = message.toLowerCase();
  
  for (const fact of facts) {
    if (fact.supersededBy) continue; // Skip already-superseded facts
    
    const factLower = fact.value.toLowerCase();
    
    // Check for direct contradictions
    // e.g., "no voltage" vs "12v present"
    if (
      (factLower.includes("no voltage") && msgLower.includes("volt")) ||
      (factLower.includes("voltage") && msgLower.includes("no volt")) ||
      (factLower.includes("ok") && msgLower.includes("not ok")) ||
      (factLower.includes("good") && msgLower.includes("bad")) ||
      (factLower.includes("working") && msgLower.includes("not working"))
    ) {
      return fact.id;
    }
  }
  
  return null;
}

/**
 * Determine which diagnostic branch to explore based on new evidence
 */
function determineBranch(message: string, evidenceType: EvidenceType): string | undefined {
  const msgLower = message.toLowerCase();
  
  // Physical damage patterns
  if (evidenceType === "physical_damage") {
    if (msgLower.includes("leak") || msgLower.includes("hole")) {
      if (msgLower.includes("coil") || msgLower.includes("evaporator") || msgLower.includes("condenser")) {
        return "refrigerant_leak_path";
      }
      if (msgLower.includes("line") || msgLower.includes("hose")) {
        return "fluid_leak_path";
      }
    }
    if (msgLower.includes("burn") || msgLower.includes("melt")) {
      return "electrical_damage_path";
    }
    if (msgLower.includes("crack") || msgLower.includes("broken")) {
      return "mechanical_damage_path";
    }
  }
  
  return undefined;
}

/**
 * Check if the context is in a replan state
 */
export function isInReplanState(context: DiagnosticContext): boolean {
  return context.isolationInvalidated && !context.isolationComplete;
}

/**
 * Clear replan state after it has been acknowledged
 */
export function clearReplanState(context: DiagnosticContext): DiagnosticContext {
  return {
    ...context,
    isolationInvalidated: false,
    replanReason: null,
    updatedAt: new Date().toISOString(),
  };
}
