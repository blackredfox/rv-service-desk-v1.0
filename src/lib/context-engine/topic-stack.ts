/**
 * Topic Stack
 * 
 * Manages the push/pop of clarification subtopics.
 * When a technician asks "where is it?" or "what is this?",
 * we push to the topic stack, answer, then pop back to the main flow.
 */

import type { 
  DiagnosticContext, 
  TopicStackEntry, 
  Submode,
  Intent,
} from "./types";

// ── Topic Stack Operations ──────────────────────────────────────────

/**
 * Push a clarification topic onto the stack
 */
export function pushTopic(
  context: DiagnosticContext,
  intent: Intent,
): DiagnosticContext {
  if (intent.type !== "LOCATE" && intent.type !== "EXPLAIN" && intent.type !== "HOWTO") {
    return context;
  }
  
  const submode: Submode = 
    intent.type === "LOCATE" ? "locate" :
    intent.type === "EXPLAIN" ? "explain" : "howto";
  
  const query = 
    intent.type === "LOCATE" ? intent.query :
    intent.type === "EXPLAIN" ? intent.query : intent.query;
  
  const entry: TopicStackEntry = {
    topic: query,
    submode,
    returnStepId: context.activeStepId || "",
    pushedAt: new Date().toISOString(),
  };
  
  return {
    ...context,
    topicStack: [...context.topicStack, entry],
    previousSubmode: context.submode,
    submode,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pop from the topic stack and return to previous submode
 */
export function popTopic(context: DiagnosticContext): DiagnosticContext {
  if (context.topicStack.length === 0) {
    return context;
  }
  
  const newStack = context.topicStack.slice(0, -1);
  const poppedEntry = context.topicStack[context.topicStack.length - 1];
  
  // Determine what submode to return to
  const returnSubmode: Submode = 
    newStack.length > 0 
      ? newStack[newStack.length - 1].submode 
      : "main";
  
  return {
    ...context,
    topicStack: newStack,
    submode: returnSubmode,
    activeStepId: poppedEntry.returnStepId || context.activeStepId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Check if we're in a clarification subflow
 */
export function isInClarificationSubflow(context: DiagnosticContext): boolean {
  return context.submode !== "main" && context.topicStack.length > 0;
}

/**
 * Get the current clarification topic (if any)
 */
export function getCurrentClarificationTopic(context: DiagnosticContext): TopicStackEntry | null {
  if (context.topicStack.length === 0) return null;
  return context.topicStack[context.topicStack.length - 1];
}

/**
 * Build return-to-main instruction for LLM prompt
 */
export function buildReturnToMainInstruction(context: DiagnosticContext): string | null {
  if (!isInClarificationSubflow(context)) return null;
  
  const topic = getCurrentClarificationTopic(context);
  if (!topic) return null;
  
  const returnStep = topic.returnStepId;
  
  return [
    "CLARIFICATION SUBFLOW RULES:",
    "",
    `You are answering a ${topic.submode.toUpperCase()} request: "${topic.topic}"`,
    "",
    "REQUIRED RESPONSE FORMAT:",
    "1. Provide a brief, direct answer to the clarification question",
    "2. Keep it shop-appropriate (technician audience)",
    "3. Do NOT go into excessive detail",
    "4. After answering, explicitly return to the diagnostic flow",
    "",
    returnStep 
      ? `5. Then re-ask step ${returnStep}: [exact question from procedure]`
      : "5. Then ask the next available diagnostic step",
    "",
    'Example: "[Brief answer]. Now, back to our diagnostic — [step question]?"',
    "",
    "IMPORTANT: Do NOT close the diagnostic step based on the clarification.",
    "The clarification is informational only.",
  ].join("\n");
}

/**
 * Build clarification response context for different submode types
 */
export function buildClarificationContext(
  submode: Submode,
  query: string,
): string {
  switch (submode) {
    case "locate":
      return [
        `LOCATE REQUEST: Technician asked where to find "${query}"`,
        "",
        "Provide:",
        "- Physical location on the RV/system",
        "- Access instructions if applicable",
        "- Visual landmarks to help locate",
        "",
        "Keep it brief — one paragraph max.",
      ].join("\n");
      
    case "explain":
      return [
        `EXPLAIN REQUEST: Technician asked what "${query}" is`,
        "",
        "Provide:",
        "- Brief functional description",
        "- What it does in the system",
        "- Why it matters for this diagnostic",
        "",
        "Keep it brief — one paragraph max. No history lessons.",
      ].join("\n");
      
    case "howto":
      return [
        `HOW-TO REQUEST: Technician asked how to check/test "${query}"`,
        "",
        "Provide:",
        "- Specific measurement steps",
        "- Expected readings/values",
        "- What tools to use",
        "",
        "Keep it actionable. This is NOT an answer to the diagnostic step.",
        "After providing the how-to, re-ask the same step for the RESULT.",
      ].join("\n");
      
    default:
      return "";
  }
}

/**
 * Determine if a response should auto-pop the topic stack
 * (i.e., was the clarification adequately addressed?)
 */
export function shouldAutoPopTopic(
  response: string,
  context: DiagnosticContext,
): boolean {
  // If the response contains a return-to-diagnostic signal
  const returnSignals = [
    /(?:back\s+to|returning\s+to|continuing\s+with)\s+(?:the\s+)?diagnostic/i,
    /(?:now|let'?s|so)\s*[,.]?\s*(?:the\s+)?(?:next|diagnostic)\s+(?:step|question)/i,
    /(?:moving\s+(?:on|forward)|let'?s\s+continue)/i,
  ];
  
  return returnSignals.some(p => p.test(response));
}
