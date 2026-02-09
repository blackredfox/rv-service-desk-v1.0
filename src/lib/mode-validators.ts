/**
 * RV Service Desk Mode Validators
 * 
 * Server-side validators to prevent drift and ensure output compliance.
 * Violations are caught and handled with retry/fallback logic.
 */

import type { CaseMode } from "./prompt-composer";
import { PROHIBITED_WORDS } from "./prompt-composer";

export type ValidationResult = {
  valid: boolean;
  violations: string[];
  suggestion?: string;
};

// Translation separator for final report
const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

// Final report section indicators (heuristics)
const FINAL_REPORT_INDICATORS = [
  /labor[:\s]/i,
  /hours?\s*[:.]/i,
  /total\s+labor/i,
  /recommend(ed)?\s+(replacement|repair)/i,
  /verified\s+(condition|failure|that)/i,
  /observed\s+symptom/i,
  /diagnostic\s+check/i,
];

// Safe fallback responses - LOCALIZED by language
export const FALLBACK_QUESTIONS: Record<"EN" | "RU" | "ES", string> = {
  EN: "Can you provide more information about the issue?",
  RU: "Можете предоставить больше информации о проблеме?",
  ES: "¿Puede proporcionar más información sobre el problema?",
} as const;

export const FALLBACK_AUTHORIZATION: Record<"EN" | "RU" | "ES", string> = {
  EN: "Information not provided; need additional diagnostic verification.",
  RU: "Информация не предоставлена; требуется дополнительная диагностическая проверка.",
  ES: "Información no proporcionada; se necesita verificación diagnóstica adicional.",
} as const;

export const FALLBACK_FINAL_REPORT: Record<"EN" | "RU" | "ES", string> = {
  EN: "Unable to generate compliant report. Please provide complete diagnostic information.",
  RU: "Невозможно сгенерировать соответствующий отчёт. Пожалуйста, предоставьте полную диагностическую информацию.",
  ES: "No se puede generar un informe compatible. Proporcione información de diagnóstico completa.",
} as const;

/**
 * Check if text contains prohibited denial-trigger words
 */
function containsProhibitedWords(text: string): string[] {
  const found: string[] = [];
  const lowerText = text.toLowerCase();

  for (const word of PROHIBITED_WORDS) {
    // Whole word match
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(lowerText)) {
      found.push(word);
    }
  }

  return found;
}

/**
 * Check if text looks like a final report (has multiple report indicators)
 */
function looksLikeFinalReport(text: string): boolean {
  let matchCount = 0;
  for (const indicator of FINAL_REPORT_INDICATORS) {
    if (indicator.test(text)) {
      matchCount++;
    }
  }
  // If 3+ indicators found, it looks like a final report
  return matchCount >= 3;
}

// Transition signal marker
const TRANSITION_MARKER = "[TRANSITION: FINAL_REPORT]";

/**
 * Check if diagnostic output has at least one question and not too many
 * Guided Diagnostics format allows multi-line output with ONE question at the end
 */
function hasValidDiagnosticQuestions(text: string): { valid: boolean; count: number } {
  const questionMarks = (text.match(/\?/g) || []).length;
  // Allow 1-2 questions (for clarifications) but no more
  return { valid: questionMarks >= 1 && questionMarks <= 2, count: questionMarks };
}

/**
 * Check if output is a valid transition response (isolation complete)
 */
function isTransitionResponse(text: string): boolean {
  return text.includes(TRANSITION_MARKER);
}

/**
 * Validate diagnostic mode output
 * 
 * Guided Diagnostics format allows:
 * - Multi-line header (System, Classification, Mode, Status)
 * - ONE diagnostic question at the end
 * - OR a transition response (isolation complete, no question)
 */
export function validateDiagnosticOutput(text: string): ValidationResult {
  const violations: string[] = [];

  // Check if this is a transition response (isolation complete)
  if (isTransitionResponse(text)) {
    // Transition responses are valid - they signal mode change
    // Only check for prohibited words
    const prohibited = containsProhibitedWords(text);
    if (prohibited.length > 0) {
      violations.push(`PROHIBITED_WORDS: Contains denial-trigger words: ${prohibited.join(", ")}`);
    }
    
    return {
      valid: violations.length === 0,
      violations,
      suggestion: violations.length > 0 
        ? "Remove denial-trigger words from the transition response."
        : undefined,
    };
  }

  // Must not look like a final report
  if (looksLikeFinalReport(text)) {
    violations.push("DIAGNOSTIC_DRIFT: Output looks like a final report while in diagnostic mode");
  }

  // Must not contain translation separator (not in final mode)
  if (text.includes(TRANSLATION_SEPARATOR)) {
    violations.push("DIAGNOSTIC_DRIFT: Output contains translation separator (final report format)");
  }

  // Should have at least one question, but not too many
  const questionCheck = hasValidDiagnosticQuestions(text);
  if (questionCheck.count === 0) {
    violations.push("DIAGNOSTIC_QUESTION: Output does not contain a question");
  } else if (questionCheck.count > 2) {
    violations.push(`DIAGNOSTIC_QUESTION: Output contains ${questionCheck.count} questions (max 2 allowed)`);
  }

  // Must not contain prohibited words
  const prohibited = containsProhibitedWords(text);
  if (prohibited.length > 0) {
    violations.push(`PROHIBITED_WORDS: Contains denial-trigger words: ${prohibited.join(", ")}`);
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0 
      ? "Produce diagnostic output with system info and ONE specific diagnostic question."
      : undefined,
  };
}

/**
 * Validate authorization mode output
 */
export function validateAuthorizationOutput(text: string): ValidationResult {
  const violations: string[] = [];

  // Must not contain prohibited words
  const prohibited = containsProhibitedWords(text);
  if (prohibited.length > 0) {
    violations.push(`PROHIBITED_WORDS: Contains denial-trigger words: ${prohibited.join(", ")}`);
  }

  // Should not be a full final report (with translation)
  if (text.includes(TRANSLATION_SEPARATOR)) {
    violations.push("AUTHORIZATION_DRIFT: Output contains translation separator (final report format)");
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0
      ? "Generate authorization text without denial-trigger words or final report format."
      : undefined,
  };
}

/**
 * Validate final report mode output
 *
 * Translation enforcement is driven by LanguagePolicy:
 *   includeTranslation=true  → must contain '--- TRANSLATION ---'
 *   includeTranslation=false → must NOT contain '--- TRANSLATION ---'
 *
 * @param text  - LLM output to validate
 * @param includeTranslation - Whether a translation block is expected (from LanguagePolicy).
 *                             Defaults to true for backward compatibility.
 */
export function validateFinalReportOutput(text: string, includeTranslation: boolean = true): ValidationResult {
  const violations: string[] = [];

  if (includeTranslation) {
    // RU / ES / AUTO-non-EN: Must contain translation separator
    if (!text.includes(TRANSLATION_SEPARATOR)) {
      violations.push("FINAL_REPORT_FORMAT: Missing '--- TRANSLATION ---' separator");
    }
  } else {
    // EN mode: Must NOT contain translation separator
    if (text.includes(TRANSLATION_SEPARATOR)) {
      violations.push("FINAL_REPORT_LANG_POLICY: EN mode must not include '--- TRANSLATION ---' block");
    }
  }

  // Must have labor information
  if (!/labor/i.test(text)) {
    violations.push("FINAL_REPORT_FORMAT: Missing labor justification");
  }

  // Must not contain prohibited words (in English section)
  const englishSection = text.includes(TRANSLATION_SEPARATOR)
    ? text.split(TRANSLATION_SEPARATOR)[0]
    : text;
  const prohibited = containsProhibitedWords(englishSection);
  if (prohibited.length > 0) {
    violations.push(`PROHIBITED_WORDS: English section contains denial-trigger words: ${prohibited.join(", ")}`);
  }

  // Should not have headers (lines ending with : alone)
  if (/^[A-Z][^.!?\n]*:\s*$/m.test(text)) {
    violations.push("FINAL_REPORT_FORMAT: Contains headers (should be plain paragraphs)");
  }

  // Should not have numbered lists
  if (/^\d+[.)]\s/m.test(text)) {
    violations.push("FINAL_REPORT_FORMAT: Contains numbered lists (forbidden)");
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0
      ? "Generate a Portal-Cause with: English paragraphs (no headers/numbers), labor last, then --- TRANSLATION --- and full translation."
      : undefined,
  };
}

/**
 * Main validator dispatcher based on mode
 */
export function validateOutput(text: string, mode: CaseMode): ValidationResult {
  if (!text || !text.trim()) {
    return { valid: false, violations: ["EMPTY_OUTPUT: Response is empty"] };
  }

  switch (mode) {
    case "diagnostic":
      return validateDiagnosticOutput(text);
    case "authorization":
      return validateAuthorizationOutput(text);
    case "final_report":
      return validateFinalReportOutput(text);
    default:
      return validateDiagnosticOutput(text);
  }
}

/**
 * Normalize language to a valid Language type
 * Never returns AUTO - defaults to EN if unknown
 */
function normalizeLanguage(lang?: string): "EN" | "RU" | "ES" {
  const upper = (lang || "").toUpperCase();
  if (upper === "RU" || upper === "ES" || upper === "EN") {
    return upper as "EN" | "RU" | "ES";
  }
  // Default to EN for unknown/AUTO
  console.warn(`[Fallback] Unknown language "${lang}", defaulting to EN`);
  return "EN";
}

/**
 * Get safe fallback response for a mode, localized to the effective language
 * 
 * @param mode - The current case mode
 * @param language - The effective dialogue language (EN/RU/ES, NOT AUTO)
 */
export function getSafeFallback(mode: CaseMode, language?: string): string {
  const lang = normalizeLanguage(language);

  switch (mode) {
    case "diagnostic":
      return FALLBACK_QUESTIONS[lang];
    case "authorization":
      return FALLBACK_AUTHORIZATION[lang];
    case "final_report":
      return FALLBACK_FINAL_REPORT[lang];
    default:
      return FALLBACK_QUESTIONS[lang];
  }
}

/**
 * Build correction instruction for retry
 */
export function buildCorrectionInstruction(violations: string[]): string {
  const reasons = violations.map((v) => `- ${v}`).join("\n");
  return `Your previous output violated the following rules:\n${reasons}\n\nProduce a compliant output now.`;
}

/**
 * Log validation result for observability
 */
export function logValidation(
  result: ValidationResult,
  context: { caseId?: string; mode: CaseMode }
): void {
  if (!result.valid) {
    console.warn(
      `[ModeValidator] Violations (case=${context.caseId || "unknown"}, mode=${context.mode}):`,
      result.violations
    );
  }
}
