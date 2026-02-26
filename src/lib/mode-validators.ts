/**
 * RV Service Desk Mode Validators
 * 
 * Server-side validators to prevent drift and ensure output compliance.
 * Violations are caught and handled with retry/fallback logic.
 */

import type { CaseMode } from "./prompt-composer";
import { PROHIBITED_WORDS } from "./prompt-composer";
import { detectLanguage, type Language } from "./lang";

export type ValidationResult = {
  valid: boolean;
  violations: string[];
  suggestion?: string;
};

// Translation separator for final report
const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

// Final report section headers (exact order required)
const FINAL_REPORT_HEADERS = [
  "Complaint",
  "Diagnostic Procedure",
  "Verified Condition",
  "Recommended Corrective Action",
  "Required Parts",
  "Estimated Labor",
];

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const SPANISH_CHARS_RE = /[áéíóúñ¿¡üÁÉÍÓÚÑÜ]/;

function findHeaderIndex(text: string, header: string): number {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^\\s*${escaped}\\s*:` , "im");
  const match = regex.exec(text);
  return match ? match.index : -1;
}

function englishSectionHasNonEnglish(text: string): boolean {
  return CYRILLIC_RE.test(text) || SPANISH_CHARS_RE.test(text);
}

function detectTranslationLanguage(text: string): Language {
  return detectLanguage(text).language;
}

// Final report section indicators (heuristics)
const FINAL_REPORT_INDICATORS = [
  /complaint\s*:/i,
  /diagnostic\s+procedure\s*:/i,
  /verified\s+condition\s*:/i,
  /recommended\s+corrective\s+action\s*:/i,
  /estimated\s+labor\s*:/i,
  /required\s+parts\s*:/i,
  /total\s+labor/i,
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
 * Check if text looks like a final report (shop-style or legacy markers)
 */
function looksLikeFinalReport(text: string): boolean {
  const sample = (text ?? "");
  const trimmed = sample.trim();
  if (!trimmed) return false;

  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const countMatches = (patterns: RegExp[]): number =>
    patterns.reduce((count, regex) => count + (regex.test(sample) ? 1 : 0), 0);

  // Line-based header matching (start-of-line, optional whitespace)
  const shopHeaderPatterns = FINAL_REPORT_HEADERS.map(
    (header) => new RegExp(`^\\s*${escapeRegExp(header)}\\s*:`, "im")
  );

  const legacyMarkerPatterns = [
    /^\s*Verified\s+condition\s*:/im,
    /^\s*Recommended\b.*$/im,
    /^\s*Labor\s*:/im,
    /^\s*.*\bhours\s+total\b.*$/im,
    /^\s*Required\s+parts\s*:/im,
  ];

  // Rule 1: shop-style headers (2+)
  const shopMatches = countMatches(shopHeaderPatterns);
  if (shopMatches >= 2) return true;

  // Rule 2: legacy markers (2+)
  const legacyMatches = countMatches(legacyMarkerPatterns);
  if (legacyMatches >= 2) return true;

  const totalMarkers = shopMatches + legacyMatches;

  // Rule 3: translation reinforcement (separator + any marker)
  const hasTranslation = sample.includes(TRANSLATION_SEPARATOR);
  if (hasTranslation && totalMarkers >= 1) {
    return true;
  }

  return false;
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
 * Validate final report mode output (shop-style)
 *
 * Translation enforcement is driven by LanguagePolicy:
 *   includeTranslation=true  → must contain '--- TRANSLATION ---'
 *   includeTranslation=false → must NOT contain '--- TRANSLATION ---'
 *
 * @param text  - LLM output to validate
 * @param includeTranslation - Whether a translation block is expected (from LanguagePolicy).
 *                             Defaults to true for backward compatibility.
 * @param translationLanguage - Expected translation language (dialogue language)
 */
export function validateFinalReportOutput(
  text: string,
  includeTranslation: boolean = true,
  translationLanguage?: Language
): ValidationResult {
  const violations: string[] = [];
  const hasSeparator = text.includes(TRANSLATION_SEPARATOR);

  if (includeTranslation) {
    // RU / ES / AUTO-non-EN: Must contain translation separator
    if (!hasSeparator) {
      violations.push("FINAL_REPORT_FORMAT: Missing '--- TRANSLATION ---' separator");
    }
  } else {
    // EN mode: Must NOT contain translation separator
    if (hasSeparator) {
      violations.push("FINAL_REPORT_LANG_POLICY: EN mode must not include '--- TRANSLATION ---' block");
    }
  }

  const englishSection = hasSeparator
    ? text.split(TRANSLATION_SEPARATOR)[0].trim()
    : text.trim();
  const translationSection = hasSeparator
    ? (text.split(TRANSLATION_SEPARATOR)[1] || "").trim()
    : "";

  // Section headers must exist and be in correct order
  const headerPositions = FINAL_REPORT_HEADERS.map((header) => findHeaderIndex(englishSection, header));
  headerPositions.forEach((pos, idx) => {
    if (pos === -1) {
      violations.push(`FINAL_REPORT_FORMAT: Missing section header: ${FINAL_REPORT_HEADERS[idx]}`);
    }
  });

  for (let i = 1; i < headerPositions.length; i++) {
    const prev = headerPositions[i - 1];
    const current = headerPositions[i];
    if (prev !== -1 && current !== -1 && current < prev) {
      violations.push(`FINAL_REPORT_FORMAT: Section order invalid (expected "${FINAL_REPORT_HEADERS[i - 1]}" before "${FINAL_REPORT_HEADERS[i]}")`);
    }
  }

  // Must not contain prohibited words (in English section)
  const prohibited = containsProhibitedWords(englishSection);
  if (prohibited.length > 0) {
    violations.push(`PROHIBITED_WORDS: English section contains denial-trigger words: ${prohibited.join(", ")}`);
  }

  // English block must be English-only
  if (englishSectionHasNonEnglish(englishSection)) {
    violations.push("FINAL_REPORT_LANG_POLICY: English section contains non-English characters");
  }

  // Translation block should match expected dialogue language
  if (includeTranslation && translationLanguage && translationSection) {
    const detected = detectTranslationLanguage(translationSection);
    if (detected !== translationLanguage) {
      violations.push(`FINAL_REPORT_LANG_POLICY: Translation block language mismatch (expected ${translationLanguage})`);
    }
  }

  // Should not have numbered lists
  if (/^\s*\d+[.)]\s/m.test(text)) {
    violations.push("FINAL_REPORT_FORMAT: Contains numbered lists (forbidden)");
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0
      ? "Generate a shop-style Final Report with required headers in order, English-first, then --- TRANSLATION --- and a full translation."
      : undefined,
  };
}


/**
 * Main validator dispatcher based on mode
 *
 * @param includeTranslation  Forwarded to final-report validator.
 *                            Defaults to true for backward compatibility.
 * @param translationLanguage Expected translation language (dialogue language)
 */
export function validateOutput(
  text: string,
  mode: CaseMode,
  includeTranslation?: boolean,
  translationLanguage?: Language
): ValidationResult {
  if (!text || !text.trim()) {
    return { valid: false, violations: ["EMPTY_OUTPUT: Response is empty"] };
  }

  switch (mode) {
    case "diagnostic":
      return validateDiagnosticOutput(text);
    case "authorization":
      return validateAuthorizationOutput(text);
    case "final_report":
      return validateFinalReportOutput(text, includeTranslation, translationLanguage);
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
    case "labor_confirmation":
      return FALLBACK_LABOR_CONFIRMATION[lang];
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
