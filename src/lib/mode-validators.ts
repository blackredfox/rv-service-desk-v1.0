/**
 * RV Service Desk Mode Validators
 * 
 * Server-side validators to prevent drift and ensure output compliance.
 * Violations are caught and handled with retry/fallback logic.
 */

import type { CaseMode } from "./prompt-composer";
import { PROHIBITED_WORDS } from "./prompt-composer";
import { detectLanguage, getLanguageChoiceFallback, type Language } from "./lang";

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
  "Estimated Labor",
  "Required Parts",
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

export const FALLBACK_LABOR_CONFIRMATION: Record<"EN" | "RU" | "ES", string> = {
  EN: "Estimated total labor: 1.0 hours\nPlease confirm this estimate, or enter a different total (e.g., '2.0 hours').",
  RU: "Ориентировочное общее время работы: 1.0 час\nПожалуйста, подтвердите эту оценку или введите другое значение (например, '2.0 часа').",
  ES: "Tiempo total estimado de mano de obra: 1.0 horas\nPor favor confirme esta estimación, o ingrese un total diferente (por ejemplo, '2.0 horas').",
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
// DEPRECATED: Transition markers are no longer supported
// Mode transitions happen ONLY via explicit user command (START FINAL REPORT)
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
 * Check if output contains isolation-complete language that should be blocked
 * LLM must NEVER declare isolation complete — only technician can trigger final report
 */
function containsIsolationCompleteLanguage(text: string): boolean {
  const patterns = [
    // English
    /isolation\s+(?:is\s+)?complete/i,
    /conditions?\s+(?:are\s+)?met/i,
    /ready\s+to\s+transition/i,
    /\[TRANSITION:/i,
    // Russian
    /изоляция\s+завершен/i,
    /условия\s+выполнен/i,
    /готов\s+к\s+переходу/i,
    // Spanish
    /aislamiento\s+complet/i,
    /condiciones?\s+cumplid/i,
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Validate diagnostic mode output
 * 
 * Guided Diagnostics format allows:
 * - Multi-line header (System, Classification, Mode, Status)
 * - ONE diagnostic question at the end
 * 
 * PROHIBITED in diagnostic mode:
 * - Final report format (headers like Complaint:, Verified Condition:, etc.)
 * - Isolation-complete declarations (LLM cannot end diagnostics)
 * - Transition markers
 */
export function validateDiagnosticOutput(text: string): ValidationResult {
  const violations: string[] = [];

  // CRITICAL: Must not look like a final report — checked FIRST, always
  if (looksLikeFinalReport(text)) {
    violations.push("DIAGNOSTIC_DRIFT: Output looks like a final report while in diagnostic mode. Diagnostic mode must ask questions, not generate reports.");
  }

  // CRITICAL: Must not declare isolation complete — LLM cannot end diagnostics
  if (containsIsolationCompleteLanguage(text)) {
    violations.push("ISOLATION_DECLARATION_BLOCKED: LLM cannot declare isolation complete. Only the technician can trigger final report via explicit command.");
  }

  // Strip transition marker if present (legacy LLM behavior) — but still flag as violation
  if (text.includes(TRANSITION_MARKER)) {
    violations.push("TRANSITION_MARKER_BLOCKED: Transition markers are not allowed. Mode transitions require explicit user command.");
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
 * Validate language consistency in diagnostic output.
 * Output language must match the expected dialogue language.
 */
export function validateLanguageConsistency(
  text: string, 
  expectedLanguage: Language
): ValidationResult {
  const violations: string[] = [];
  
  const hasCyrillic = CYRILLIC_RE.test(text);
  const hasSpanish = SPANISH_CHARS_RE.test(text);
  
  if (expectedLanguage === "RU") {
    // Russian session — should have Cyrillic, should NOT have Spanish chars
    if (!hasCyrillic && text.length > 50) {
      violations.push("LANGUAGE_MISMATCH: Russian session but output appears to be in English");
    }
    if (hasSpanish) {
      violations.push("LANGUAGE_MISMATCH: Russian session but output contains Spanish characters");
    }
  } else if (expectedLanguage === "ES") {
    // Spanish session — should have Spanish chars or at least not Cyrillic
    if (hasCyrillic) {
      violations.push("LANGUAGE_MISMATCH: Spanish session but output contains Cyrillic characters");
    }
  } else if (expectedLanguage === "EN") {
    // English session — should NOT have Cyrillic or heavy Spanish markers
    if (hasCyrillic) {
      violations.push("LANGUAGE_MISMATCH: English session but output contains Cyrillic characters");
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
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
 * Validate labor confirmation mode output
 * 
 * Must contain an estimated labor total and a prompt for confirmation.
 */
export function validateLaborConfirmationOutput(text: string): ValidationResult {
  const violations: string[] = [];

  // Must contain labor estimate pattern
  if (!/(?:estimated\s+total\s+labor|total\s+labor)[:\s]+\d+(?:\.\d+)?\s*(?:hours?|hrs?|hr)/i.test(text)) {
    violations.push("LABOR_CONFIRMATION: Missing 'Estimated total labor: X.X hours' pattern");
  }

  // Must ask for confirmation
  if (!/confirm|adjust|different/i.test(text)) {
    violations.push("LABOR_CONFIRMATION: Missing confirmation prompt");
  }

  // Must not contain prohibited words
  const prohibited = containsProhibitedWords(text);
  if (prohibited.length > 0) {
    violations.push(`PROHIBITED_WORDS: Contains denial-trigger words: ${prohibited.join(", ")}`);
  }

  // Must not look like a full final report
  if (looksLikeFinalReport(text)) {
    violations.push("LABOR_CONFIRMATION_DRIFT: Output looks like a final report (should only show estimate)");
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0
      ? "Output an estimated total labor with confirmation prompt. Do NOT generate the full report."
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
    case "labor_confirmation":
      return validateLaborConfirmationOutput(text);
    default:
      return validateDiagnosticOutput(text);
  }
}

/**
 * Normalize language to a valid Language type
 * Never returns AUTO - defaults to EN if unknown
 */
function normalizeLanguage(lang?: string): "EN" | "RU" | "ES" | null {
  const upper = (lang || "").toUpperCase();
  if (upper === "RU" || upper === "ES" || upper === "EN") {
    return upper as "EN" | "RU" | "ES";
  }
  return null;
}

/**
 * Get safe fallback response for a mode, localized to the effective language
 * 
 * @param mode - The current case mode
 * @param language - The effective dialogue language (EN/RU/ES, NOT AUTO)
 */
export function getSafeFallback(mode: CaseMode, language?: string): string {
  const lang = normalizeLanguage(language);
  if (!lang) {
    return getLanguageChoiceFallback();
  }

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

// ── Step Compliance Validation ──────────────────────────────────────────

/**
 * Validate that the LLM response corresponds to the active step.
 * This is the key architectural enforcement — the LLM can only render
 * the server-selected step, not choose its own.
 * 
 * @param responseText - The LLM-generated response
 * @param activeStepId - The engine-selected step ID
 * @param activeStepQuestion - The exact question that should be asked
 * @returns Validation result with specific violation if step mismatch
 */
export function validateStepCompliance(
  responseText: string,
  activeStepId: string | null,
  activeStepQuestion: string | null,
): ValidationResult {
  const violations: string[] = [];
  
  // If no active step, can't validate compliance
  if (!activeStepId || !activeStepQuestion) {
    return { valid: true, violations: [] };
  }
  
  const responseLower = responseText.toLowerCase();
  const questionLower = activeStepQuestion.toLowerCase();
  
  // Extract key terms from the expected question (3+ char words)
  const questionKeyTerms = questionLower
    .split(/[\s\?\.,;:]+/)
    .filter(w => w.length >= 3)
    .filter(w => !["the", "and", "for", "are", "any", "does", "when", "what", "how", "you", "can", "has", "have", "this", "that", "with"].includes(w));
  
  // Check if response contains enough key terms from the expected question
  const matchedTerms = questionKeyTerms.filter(term => responseLower.includes(term));
  const matchRatio = questionKeyTerms.length > 0 ? matchedTerms.length / questionKeyTerms.length : 1;
  
  // Allow some flexibility — at least 40% of key terms should be present
  // This allows natural paraphrasing while catching complete drift
  if (matchRatio < 0.4 && questionKeyTerms.length >= 3) {
    violations.push(
      `STEP_COMPLIANCE: Response does not match active step ${activeStepId}. ` +
      `Expected question about: ${questionKeyTerms.slice(0, 5).join(", ")}`
    );
  }
  
  // Check for explicit step ID references that don't match
  const stepIdPattern = /\b(wh|wp|furn|ac|ref|so|lv|ic|e12|eac|lpg|awn|ca)_\w+\b/gi;
  const mentionedSteps = responseText.match(stepIdPattern) || [];
  const wrongSteps = mentionedSteps.filter(s => s.toLowerCase() !== activeStepId.toLowerCase());
  
  if (wrongSteps.length > 0) {
    violations.push(
      `STEP_COMPLIANCE: Response references wrong step(s): ${wrongSteps.join(", ")}. ` +
      `Active step is ${activeStepId}.`
    );
  }
  
  return {
    valid: violations.length === 0,
    violations,
    suggestion: violations.length > 0
      ? `Render ONLY the active step (${activeStepId}): "${activeStepQuestion}"`
      : undefined,
  };
}

/**
 * Check if a response indicates the step was answered (contextual completion).
 * More lenient than regex patterns — accepts short answers in context.
 * 
 * @param responseText - Technician's message
 * @param activeStepQuestion - The question that was asked
 * @returns Whether the response likely answers the question
 */
export function isStepAnswered(
  responseText: string,
  activeStepQuestion: string | null,
): boolean {
  if (!activeStepQuestion) return false;
  
  const text = responseText.trim().toLowerCase();
  
  // Very short responses are likely answers to a yes/no or value question
  if (text.length <= 20) {
    // Common affirmative/negative patterns
    if (/^(?:yes|no|yeah|yep|nope|si|да|нет|ok|okay|good|bad|none|zero|0|nothing)$/i.test(text)) {
      return true;
    }
    // Measurement values
    if (/^\d+(?:\.\d+)?(?:\s*(?:v|volts?|mv|millivolts?|ohms?|amps?|psi|wc))?$/i.test(text)) {
      return true;
    }
    // Simple state responses
    if (/^(?:open|closed|on|off|full|empty|present|absent|running|dead|working|not working)$/i.test(text)) {
      return true;
    }
  }
  
  // Medium responses that describe a finding
  if (text.length >= 5 && text.length <= 200) {
    // Contains a conclusion indicator
    if (/(?:found|checked|verified|confirmed|measured|tested|looks|appears|seems|shows|reading|got)/i.test(text)) {
      return true;
    }
    // Contains a value or state
    if (/(?:\d+(?:\.\d+)?|yes|no|good|bad|ok|damaged|burnt|blocked|clean|dirty|open|closed)/i.test(text)) {
      return true;
    }
  }
  
  // "Already checked" patterns
  if (/(?:already|told you|mentioned|said|checked that|did that|done)/i.test(text)) {
    return true;
  }
  
  // "Unable to check" patterns
  if (/(?:can'?t|cannot|unable|don'?t know|no way|no tool|no access)/i.test(text)) {
    return true;
  }
  
  return false;
}
