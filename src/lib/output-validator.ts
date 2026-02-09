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
 */
function isCauseFormatCorrect(text: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Must contain translation separator
  if (!text.includes(TRANSLATION_SEPARATOR)) {
    issues.push("Missing '--- TRANSLATION ---' separator");
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

/**
 * Validate AI response against rules
 *
 * @param includeTranslation - Whether a translation block is expected (from LanguagePolicy).
 *                             Defaults to true for backward compat with existing callers.
 */
export function validateResponse(args: {
  response: string;
  currentState: DiagnosticState;
  dialogueLanguage: Language;
  includeTranslation?: boolean;
}): ValidationResult {
  const { response, currentState, dialogueLanguage, includeTranslation = true } = args;
  const violations: string[] = [];
  
  if (!response || !response.trim()) {
    return { valid: true, violations: [] };
  }
  
  if (currentState === "DIAGNOSTICS") {
    // Rule: English is FORBIDDEN during diagnostics (except EN dialogue)
    if (containsEnglishDuringDiagnostics(response, dialogueLanguage)) {
      violations.push(`LANG_VIOLATION: English detected during DIAGNOSTICS state (dialogue: ${dialogueLanguage})`);
    }
    
    // Rule: Translation is FORBIDDEN during diagnostics
    if (response.includes(TRANSLATION_SEPARATOR)) {
      violations.push("TRANSLATION_VIOLATION: Translation separator found during DIAGNOSTICS state");
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
  
  if (currentState === "CAUSE_OUTPUT") {
    // Rule: Must have proper Cause format
    const causeCheck = isCauseFormatCorrect(response);
    if (!causeCheck.valid) {
      violations.push(...causeCheck.issues.map(i => `FORMAT_VIOLATION: ${i}`));
    }
    
    // Rule: If has separator, check both parts
    if (response.includes(TRANSLATION_SEPARATOR)) {
      const [englishPart, translationPart] = response.split(TRANSLATION_SEPARATOR);
      
      // English part should be in English
      if (englishPart && dialogueLanguage !== "EN") {
        const isEnglish = countEnglishWords(englishPart) > 5;
        if (!isEnglish) {
          violations.push("FORMAT_VIOLATION: Cause text before separator should be in English");
        }
      }
      
      // Translation part should be in dialogue language
      if (translationPart && dialogueLanguage !== "EN") {
        if (!isTextInLanguage(translationPart, dialogueLanguage)) {
          violations.push(`FORMAT_VIOLATION: Translation should be in ${dialogueLanguage}`);
        }
      }
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
