/**
 * Diagnostic Reply Shaping Helpers
 *
 * Provides bounded, human-like acknowledgment phrases for diagnostic mode.
 * This is a style/output improvement only — does NOT control step flow,
 * completion, or mode transitions.
 *
 * Architecture constraint: This module must NOT become a second flow authority.
 * All step selection, completion, and branching remain with Context Engine.
 */

import type { Language } from "@/lib/lang";

/**
 * Natural acknowledgment phrases by language.
 * These are colleague-like phrases a senior technician might use.
 */
export const DIAGNOSTIC_ACKNOWLEDGMENTS: Record<Language, readonly string[]> = {
  EN: [
    "Understood.",
    "Got it.",
    "Copy.",
    "Noted.",
    "That helps.",
    "Clear.",
  ],
  RU: [
    "Понял.",
    "Принято.",
    "Ясно.",
    "Это уже помогает.",
    "Хорошо.",
  ],
  ES: [
    "Entendido.",
    "Anotado.",
    "Claro.",
    "Eso ya ayuda.",
    "De acuerdo.",
  ],
} as const;

/**
 * Bounded reasoning transition phrases by language.
 * Used to briefly connect the technician's input to the next step.
 * Must remain short and non-speculative.
 */
export const DIAGNOSTIC_REASONING_TRANSITIONS: Record<Language, readonly string[]> = {
  EN: [
    "That narrows the path.",
    "From what you have…",
    "That already helps isolate the issue.",
    "Good starting point.",
  ],
  RU: [
    "Это уже сужает круг.",
    "Из того, что уже есть…",
    "Это помогает локализовать проблему.",
    "Хорошая отправная точка.",
  ],
  ES: [
    "Eso ya acota el problema.",
    "Con lo que ya tienes…",
    "Eso ayuda a aislar el problema.",
    "Buen punto de partida.",
  ],
} as const;

/**
 * Next-step transition phrases by language.
 * Used to introduce the next diagnostic question naturally.
 */
export const DIAGNOSTIC_NEXT_STEP_INTROS: Record<Language, readonly string[]> = {
  EN: [
    "Next, check…",
    "Now verify…",
    "I'd check this next:",
    "Let's confirm:",
  ],
  RU: [
    "Дальше проверь…",
    "Теперь уточни…",
    "Дальше я бы проверил:",
    "Подтверди:",
  ],
  ES: [
    "Ahora verifica…",
    "A continuación, revisa…",
    "Yo revisaría esto primero:",
    "Confirma:",
  ],
} as const;

/**
 * Validates that a diagnostic reply maintains bounded structure.
 * This is for test/validation purposes only — not runtime enforcement.
 *
 * A bounded diagnostic reply should:
 * 1. Not contain multiple diagnostic questions
 * 2. Not contain speculative language outside current branch
 * 3. End with a single actionable question or report suggestion
 *
 * @param reply - The diagnostic reply text
 * @returns Validation result with any violations found
 */
export function validateBoundedDiagnosticReply(reply: string): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check for multiple question marks (potential multi-question drift)
  const questionMarks = (reply.match(/\?/g) || []).length;
  if (questionMarks > 2) {
    // Allow up to 2: one clarification context + one actual question
    violations.push("MULTI_QUESTION_DRIFT: More than 2 question marks detected");
  }

  // Check for speculative language patterns
  const speculativePatterns = [
    /\b(probably|likely|might be|could be|possibly)\b.*\?/i,
    /\b(I think|I believe|I suspect)\b/i,
  ];
  for (const pattern of speculativePatterns) {
    if (pattern.test(reply)) {
      violations.push("SPECULATIVE_LANGUAGE: Reply contains speculative phrasing");
      break;
    }
  }

  // Check for excessive length (verbosity drift)
  const wordCount = reply.split(/\s+/).length;
  if (wordCount > 150) {
    violations.push("VERBOSITY_DRIFT: Reply exceeds 150 words");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Checks if a reply contains proper language-specific acknowledgment.
 * Used for testing multilingual behavior.
 *
 * @param reply - The diagnostic reply text
 * @param language - Expected language
 * @returns Whether the reply contains appropriate acknowledgment for the language
 */
export function hasLanguageAppropriateAcknowledgment(
  reply: string,
  language: Language
): boolean {
  const acknowledgments = DIAGNOSTIC_ACKNOWLEDGMENTS[language] || DIAGNOSTIC_ACKNOWLEDGMENTS.EN;
  return acknowledgments.some((ack) => reply.includes(ack));
}
