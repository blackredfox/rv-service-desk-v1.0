/**
 * Loop Guard
 * 
 * Prevents the agent from falling into repetitive loops:
 * - No "provide more info" twice in a row
 * - No re-asking completed steps
 * - No asking the same step too many times
 */

import type { 
  AgentAction, 
  DiagnosticContext, 
  LoopCheckResult,
  ContextEngineConfig,
} from "./types";

// ── Fallback Detection ──────────────────────────────────────────────

const FALLBACK_PHRASES = [
  /(?:provide|give|share)\s+(?:more|additional)\s+(?:info|information|details)/i,
  /(?:need|require)\s+(?:more|additional)\s+(?:info|information|details)/i,
  /(?:can\s+you|could\s+you)\s+(?:provide|give|share|tell)/i,
  /(?:please\s+)?(?:elaborate|clarify|explain\s+(?:more|further))/i,
  /(?:tell\s+me\s+more|more\s+details?\s+(?:please|needed))/i,
  // Russian
  /(?:предоставь|дай|расскажи)\s+(?:больше|дополнительн)/i,
  /(?:нужн|требу)\w*\s+(?:больше|дополнительн)\s+(?:информац|данн)/i,
  // Spanish
  /(?:proporcione|dé|comparta)\s+(?:más|adicional)\s+(?:información|detalles)/i,
  /(?:necesito|requiero)\s+(?:más|adicional)\s+(?:información|detalles)/i,
];

/**
 * Check if a response looks like a "provide more info" fallback
 */
export function isFallbackResponse(content: string): boolean {
  return FALLBACK_PHRASES.some(p => p.test(content));
}

// ── Loop Check Functions ────────────────────────────────────────────

/**
 * Check if a proposed action would violate loop rules
 */
export function checkLoopViolation(
  proposedAction: AgentAction,
  context: DiagnosticContext,
  config: ContextEngineConfig,
): LoopCheckResult {
  // Rule 1: No consecutive fallbacks
  if (proposedAction.type === "fallback") {
    if (context.consecutiveFallbacks >= config.maxConsecutiveFallbacks) {
      return {
        violation: true,
        reason: `Cannot output fallback ${config.maxConsecutiveFallbacks + 1} times in a row`,
        suggestion: "Ask a specific diagnostic question from the procedure instead",
      };
    }
  }
  
  // Rule 2: No re-asking completed steps
  if (proposedAction.stepId && context.completedSteps.has(proposedAction.stepId)) {
    return {
      violation: true,
      reason: `Step ${proposedAction.stepId} is already completed`,
      suggestion: "Move to the next available step in the procedure",
    };
  }
  
  // Rule 3: No re-asking unable-to-verify steps
  if (proposedAction.stepId && context.unableSteps.has(proposedAction.stepId)) {
    return {
      violation: true,
      reason: `Step ${proposedAction.stepId} was marked unable to verify`,
      suggestion: "Skip this step and move to the next available step",
    };
  }
  
  // Rule 4: Max repeat count for same step
  if (proposedAction.stepId) {
    const recentActions = context.lastAgentActions.slice(-config.maxActionHistory);
    const sameStepCount = recentActions.filter(
      a => a.stepId === proposedAction.stepId && a.type === "question"
    ).length;
    
    if (sameStepCount >= config.maxStepRepeatCount) {
      return {
        violation: true,
        reason: `Step ${proposedAction.stepId} has been asked ${sameStepCount} times already`,
        suggestion: "Accept the last response and move forward, or mark step as unable to verify",
      };
    }
  }
  
  // Rule 5: Topic cooldown (don't re-ask same topic too quickly)
  if (proposedAction.stepId) {
    const recentActions = context.lastAgentActions.slice(-config.topicCooldownTurns);
    const wasRecentlyAsked = recentActions.some(
      a => a.stepId === proposedAction.stepId && a.type === "question"
    );
    
    if (wasRecentlyAsked) {
      // This is a soft warning, not a hard violation
      // The caller can decide whether to proceed
    }
  }
  
  return { violation: false };
}

/**
 * Generate anti-loop directives for the LLM prompt
 */
export function generateAntiLoopDirectives(context: DiagnosticContext): string[] {
  const directives: string[] = [];
  
  // Always include the base directive
  directives.push("ANTI-LOOP RULES (CRITICAL):");
  
  // If we've had fallbacks, add strong directive
  if (context.consecutiveFallbacks > 0) {
    directives.push(
      `- FORBIDDEN: You have output a generic "need more info" response. You MUST NOT do this again.`
    );
    directives.push(
      `- REQUIRED: Ask a SPECIFIC diagnostic question from the procedure.`
    );
  }
  
  // List completed steps that must not be re-asked
  if (context.completedSteps.size > 0) {
    const completed = Array.from(context.completedSteps).join(", ");
    directives.push(
      `- These steps are COMPLETED (do NOT ask again): ${completed}`
    );
  }
  
  // List unable-to-verify steps that must be skipped
  if (context.unableSteps.size > 0) {
    const unable = Array.from(context.unableSteps).join(", ");
    directives.push(
      `- These steps are CLOSED (unable to verify, SKIP): ${unable}`
    );
  }
  
  // Check for recently asked steps
  const recentSteps = context.lastAgentActions
    .filter(a => a.type === "question" && a.stepId)
    .slice(-3)
    .map(a => a.stepId);
  
  if (recentSteps.length > 0) {
    const uniqueRecent = [...new Set(recentSteps)].join(", ");
    directives.push(
      `- Recently asked steps (avoid unless necessary): ${uniqueRecent}`
    );
  }
  
  // Add forward progress directive
  directives.push(
    `- FORWARD PROGRESS: If the technician's response is ambiguous, accept it and move to the next step.`
  );
  directives.push(
    `- Do NOT repeat the same question. If the answer was unclear, summarize what you understood and ask the NEXT step.`
  );
  
  return directives;
}

/**
 * Suggest a recovery action when a loop is detected
 */
export function suggestLoopRecovery(
  context: DiagnosticContext,
  violatedRule: string,
): { action: string; reason: string } {
  // If stuck on fallbacks, force a specific question
  if (violatedRule.includes("fallback")) {
    return {
      action: "force_next_step",
      reason: "Breaking fallback loop by forcing next procedure step",
    };
  }
  
  // If stuck on a specific step, mark it as unable and move on
  if (violatedRule.includes("Step") && violatedRule.includes("times")) {
    const stepMatch = violatedRule.match(/Step (\w+)/);
    const stepId = stepMatch?.[1];
    return {
      action: `mark_unable:${stepId}`,
      reason: `Breaking step loop by marking ${stepId} as unable to verify`,
    };
  }
  
  // Default: force forward progress
  return {
    action: "force_forward",
    reason: "Breaking loop by forcing forward progress to next available step",
  };
}

/**
 * Update loop tracking state after an action
 */
export function updateLoopState(
  context: DiagnosticContext,
  action: AgentAction,
  config: ContextEngineConfig,
): DiagnosticContext {
  // Update consecutive fallback counter
  let consecutiveFallbacks = context.consecutiveFallbacks;
  if (action.type === "fallback" || isFallbackResponse(action.content)) {
    consecutiveFallbacks++;
  } else {
    consecutiveFallbacks = 0;
  }
  
  // Add to action history, trim to max size
  const lastAgentActions = [...context.lastAgentActions, action]
    .slice(-config.maxActionHistory);
  
  return {
    ...context,
    consecutiveFallbacks,
    lastAgentActions,
    updatedAt: new Date().toISOString(),
  };
}
