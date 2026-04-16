/**
 * RV Service Desk Output Validator
 * 
 * Validates AI responses against strict language and format rules.
 * Violations are logged but do not crash the app.
 */

import type { DiagnosticState } from "./types/diagnostic";
import type { Language } from "./lang";

export type ValidationResult = {
  valid: boolean;
  violations: string[];
};

// English detection patterns (common English words that wouldn't appear in RU/ES)
const ENGLISH_PATTERNS = [
  /\b(the|and|is|are|was|were|have|has|been|will|would|could|should|this|that|with|from|they|their|there|here|what|when|where|which|who|how|can|may|might|must|shall)\b/gi,
  /\b(check|verify|test|inspect|replace|repair|diagnose|confirm|ensure)\b/gi,
  /\b(pump|motor|valve|system|unit|component|circuit|voltage|pressure)\b/gi,
];

// Translation separator
const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

const FINAL_REPORT_HEADERS = [
  "Complaint",
  "Diagnostic Procedure",
  "Verified Condition",
  "Recommended Corrective Action",
  "Estimated Labor",
  "Required Parts",
];

// Cyrillic detection for Russian
const CYRILLIC_RE = /[\u0400-\u04FF]/;

// Spanish accent detection
const SPANISH_CHARS_RE = /[áéíóúñ¿¡üÁÉÍÓÚÑÜ]/;

/**
 * Count English word occurrences in text
 */
function countEnglishWords(text: string): number {
  let count = 0;
  for (const pattern of ENGLISH_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Check if text appears to be primarily in the expected language
 */
function isTextInLanguage(text: string, expectedLang: Language): boolean {
  if (expectedLang === "EN") return true; // English is always valid for English mode
  
  if (expectedLang === "RU") {
    // Russian should have Cyrillic characters
    return CYRILLIC_RE.test(text);
  }
  
  if (expectedLang === "ES") {
    // Spanish - check for Spanish characters or lack of obvious English
    const hasSpanishChars = SPANISH_CHARS_RE.test(text);
    const englishWordCount = countEnglishWords(text);
    const wordCount = text.split(/\s+/).length;
    
    // Allow Spanish if it has Spanish chars OR low English word ratio
    return hasSpanishChars || (englishWordCount / wordCount < 0.3);
  }
  
  return true;
}

/**
 * Check if response contains English when it shouldn't
 */
function containsEnglishDuringDiagnostics(text: string, dialogueLanguage: Language): boolean {
  if (dialogueLanguage === "EN") return false; // English dialogue is fine
  
  // Check for significant English content
  const englishWordCount = countEnglishWords(text);
  const wordCount = text.split(/\s+/).length;
  
  // If more than 20% English words, flag it
  return wordCount > 5 && (englishWordCount / wordCount) > 0.2;
}

/**
 * Count questions in text
 */
function countQuestions(text: string): number {
  // Count question marks
  const questionMarks = (text.match(/\?/g) || []).length;
  
  // Also count Spanish inverted question marks (¿...?)
  const spanishQuestions = (text.match(/¿[^?]+\?/g) || []).length;
  
  // Return the max to handle both formats
  return Math.max(questionMarks, spanishQuestions || questionMarks);
}

/**
 * Check if Cause format is correct
 *
 * @param includeTranslation - Whether a translation section is expected (from LanguagePolicy).
 */
function isPortalCauseFormatCorrect(text: string, includeTranslation: boolean = true): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (includeTranslation) {
    // Must contain translation separator
    if (!text.includes(TRANSLATION_SEPARATOR)) {
      issues.push("Missing '--- TRANSLATION ---' separator");
    }
  } else {
    // EN mode: must NOT contain translation separator
    if (text.includes(TRANSLATION_SEPARATOR)) {
      issues.push("EN mode must not include '--- TRANSLATION ---' block");
    }
  }
  
  // Should not have numbered lists (1. 2. 3.)
  if (/^\d+\.\s/m.test(text)) {
    issues.push("Contains numbered lists (forbidden in Cause output)");
  }
  
  // Should not have headers (lines ending with :)
  const lines = text.split("\n");
  const potentialHeaders = lines.filter(l => /^[A-Z][^.!?]*:$/m.test(l.trim()));
  if (potentialHeaders.length > 0) {
    issues.push("Contains headers (forbidden in Cause output)");
  }
  
  return { valid: issues.length === 0, issues };
}

function hasShopFinalReportShape(text: string): boolean {
  const headerCount = FINAL_REPORT_HEADERS.filter((header) =>
    new RegExp(`^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "im").test(text),
  ).length;

  return headerCount >= 2;
}

function validateShopFinalReportSurface(args: {
  response: string;
  dialogueLanguage: Language;
  includeTranslation: boolean;
}): ValidationResult {
  const violations: string[] = [];

  if (!hasShopFinalReportShape(args.response)) {
    violations.push("FORMAT_VIOLATION: Missing shop final report section headers");
  }

  if (args.includeTranslation && !args.response.includes(TRANSLATION_SEPARATOR)) {
    violations.push("FORMAT_VIOLATION: Missing '--- TRANSLATION ---' separator");
  }

  if (!args.includeTranslation && args.response.includes(TRANSLATION_SEPARATOR)) {
    violations.push("FORMAT_VIOLATION: EN mode must not include '--- TRANSLATION ---' block");
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function validatePortalCauseOutput(
  text: string,
  includeTranslation: boolean = true,
  translationLanguage?: Language,
): ValidationResult {
  const issues: string[] = [];
  const causeCheck = isPortalCauseFormatCorrect(text, includeTranslation);

  if (!causeCheck.valid) {
    issues.push(...causeCheck.issues.map((issue) => `FORMAT_VIOLATION: ${issue}`));
  }

  if (hasShopFinalReportShape(text)) {
    issues.push("FORMAT_VIOLATION: Portal Cause must not use shop final report headers");
  }

  if (/authorization|authorisation|авторизац|autorizaci[oó]n/i.test(text)) {
    issues.push("FORMAT_VIOLATION: Portal Cause must not use authorization-ready wording");
  }

  if (includeTranslation && translationLanguage && text.includes(TRANSLATION_SEPARATOR)) {
    const [, translationPart = ""] = text.split(TRANSLATION_SEPARATOR);
    if (translationPart.trim() && !isTextInLanguage(translationPart, translationLanguage)) {
      issues.push(`FORMAT_VIOLATION: Translation should be in ${translationLanguage}`);
    }
  }

  return {
    valid: issues.length === 0,
    violations: issues,
  };
}

type OutputValidatorSurface =
  | DiagnosticState
  | "DIAGNOSTICS"
  | "CAUSE_OUTPUT"
  | "portal_cause"
  | "shop_final_report"
  | "authorization_ready";

function normalizeOutputSurface(currentState: OutputValidatorSurface):
  | "diagnostic"
  | "portal_cause"
  | "shop_final_report"
  | "authorization_ready" {
  switch (currentState) {
    case "DIAGNOSTICS":
    case "diagnostic":
      return "diagnostic";
    case "CAUSE_OUTPUT":
    case "portal_cause":
      return "portal_cause";
    case "authorization_ready":
      return "authorization_ready";
    case "final_report":
    case "shop_final_report":
      return "shop_final_report";
    default:
      return "diagnostic";
  }
}

/**
 * Validate AI response against rules
 *
 * @param includeTranslation - Whether a translation block is expected (from LanguagePolicy).
 *                             Defaults to true for backward compat with existing callers.
 */
export function validateResponse(args: {
  response: string;
  currentState: OutputValidatorSurface;
  dialogueLanguage: Language;
  includeTranslation?: boolean;
}): ValidationResult {
  const { response, currentState, dialogueLanguage, includeTranslation = true } = args;
  const violations: string[] = [];
  const outputSurface = normalizeOutputSurface(currentState);
  
  if (!response || !response.trim()) {
    return { valid: true, violations: [] };
  }
  
  if (outputSurface === "diagnostic") {
    // Rule: English is FORBIDDEN during diagnostics (except EN dialogue)
    if (containsEnglishDuringDiagnostics(response, dialogueLanguage)) {
      violations.push(`LANG_VIOLATION: English detected during diagnostic state (dialogue: ${dialogueLanguage})`);
    }
    
    // Rule: Translation is FORBIDDEN during diagnostics
    if (response.includes(TRANSLATION_SEPARATOR)) {
      violations.push("TRANSLATION_VIOLATION: Translation separator found during diagnostic state");
    }
    
    // Rule: ONE question only
    const questionCount = countQuestions(response);
    if (questionCount > 1) {
      violations.push(`QUESTION_VIOLATION: Multiple questions detected (${questionCount}), only ONE allowed`);
    }
    
    // Rule: Response should be in dialogue language
    if (!isTextInLanguage(response, dialogueLanguage)) {
      violations.push(`LANG_MISMATCH: Response not in expected language (${dialogueLanguage})`);
    }
  }
  
  if (outputSurface === "portal_cause") {
    return validatePortalCauseOutput(response, includeTranslation, dialogueLanguage);
  }

  if (outputSurface === "shop_final_report") {
    return validateShopFinalReportSurface({
      response,
      dialogueLanguage,
      includeTranslation,
    });
  }

  if (outputSurface === "authorization_ready") {
    if (hasShopFinalReportShape(response)) {
      violations.push("FORMAT_VIOLATION: Authorization-ready output must not use shop final report headers");
    }
    if (!/authorization|authorisation|авторизац|autorizaci[oó]n|approval/i.test(response)) {
      violations.push("FORMAT_VIOLATION: Authorization-ready output must read as authorization text");
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Log validation violations (non-blocking)
 */
export function logValidationViolations(
  violations: string[],
  context: { caseId?: string; state: DiagnosticState; language: Language }
): void {
  if (violations.length === 0) return;
  
  console.warn(
    `[OutputValidator] Violations detected (case=${context.caseId || "unknown"}, state=${context.state}, lang=${context.language}):`,
    violations
  );
}
