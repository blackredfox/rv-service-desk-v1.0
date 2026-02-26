/**
 * RV Service Desk Prompt Composer
 * 
 * Deterministic server-side prompt composition based on case mode.
 * Prevents model "guessing" modes or jumping to final output early.
 */

import { readFileSync } from "fs";
import { join } from "path";

// Case modes
export type CaseMode = "diagnostic" | "authorization" | "final_report";

// Default memory window (last N messages to include)
export const DEFAULT_MEMORY_WINDOW = 12;

// Command strings for explicit mode transitions
export const MODE_COMMANDS = {
  FINAL_REPORT: "START FINAL REPORT",
  AUTHORIZATION: "START AUTHORIZATION REQUEST",
} as const;

// Explicit command alias allow-lists (exact/near-exact matches only)
const FINAL_REPORT_COMMAND_ALIASES = [
  "START FINAL REPORT",
  "FINAL REPORT",
  "GENERATE FINAL REPORT",
  "REPORT",
  "GIVE ME THE REPORT",
  // RU
  "ВЫДАЙ РЕПОРТ",
  "РЕПОРТ",
  "ФИНАЛЬНЫЙ РЕПОРТ",
  "СДЕЛАЙ РЕПОРТ",
  // ES
  "REPORTE FINAL",
  "GENERAR REPORTE",
  "REPORTE",
];

const AUTHORIZATION_COMMAND_ALIASES = [
  "START AUTHORIZATION REQUEST",
  "AUTHORIZATION REQUEST",
  "REQUEST AUTHORIZATION",
  "PRE-AUTHORIZATION",
  // RU
  "ЗАПРОС АВТОРИЗАЦИИ",
  "АВТОРИЗАЦИЯ",
  "ПРЕАВТОРИЗАЦИЯ",
  // ES
  "SOLICITAR AUTORIZACIÓN",
  "AUTORIZACIÓN",
  "PREAUTORIZACIÓN",
];

// Transition signal that LLM outputs when ready to change mode
export const TRANSITION_SIGNAL = "[TRANSITION: FINAL_REPORT]";

// Prohibited denial-trigger words
export const PROHIBITED_WORDS = [
  "broken",
  "failed",
  "defective",
  "bad",
  "damaged",
  "worn",
  "misadjusted",
  "leaking",
] as const;

// Cache for prompt files
let promptCache: Record<string, string> | null = null;

/**
 * Load all prompt files into memory (cached)
 */
function loadPrompts(): Record<string, string> {
  if (promptCache) return promptCache;

  const promptsDir = join(process.cwd(), "prompts");

  promptCache = {
    SYSTEM_BASE: readFileSync(join(promptsDir, "system", "SYSTEM_PROMPT_BASE.txt"), "utf-8"),
    MODE_DIAGNOSTIC: readFileSync(join(promptsDir, "modes", "MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8"),
    MODE_AUTHORIZATION: readFileSync(join(promptsDir, "modes", "MODE_PROMPT_AUTHORIZATION.txt"), "utf-8"),
    MODE_FINAL_REPORT: readFileSync(join(promptsDir, "modes", "MODE_PROMPT_FINAL_REPORT.txt"), "utf-8"),
    MODE_LABOR_CONFIRMATION: readFileSync(join(promptsDir, "modes", "MODE_PROMPT_LABOR_CONFIRMATION.txt"), "utf-8"),
  };

  return promptCache;
}

/**
 * Get the mode prompt for a given mode
 */
function getModePrompt(mode: CaseMode): string {
  const prompts = loadPrompts();

  switch (mode) {
    case "diagnostic":
      return prompts.MODE_DIAGNOSTIC;
    case "authorization":
      return prompts.MODE_AUTHORIZATION;
    case "final_report":
      return prompts.MODE_FINAL_REPORT;
    case "labor_confirmation":
      return prompts.MODE_LABOR_CONFIRMATION;
    default:
      return prompts.MODE_DIAGNOSTIC;
  }
}

/**
 * Normalize a command candidate for strict alias matching
 */
function normalizeCommandAlias(text: string): string {
  return (text ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const FINAL_REPORT_ALIAS_SET = new Set(FINAL_REPORT_COMMAND_ALIASES.map(normalizeCommandAlias));
const AUTHORIZATION_ALIAS_SET = new Set(AUTHORIZATION_COMMAND_ALIASES.map(normalizeCommandAlias));

/**
 * Detect explicit command aliases from a fixed allow-list
 */
export function detectExplicitCommandAlias(message: string): CaseMode | null {
  const normalized = normalizeCommandAlias(message);
  if (!normalized) return null;

  if (FINAL_REPORT_ALIAS_SET.has(normalized)) return "final_report";
  if (AUTHORIZATION_ALIAS_SET.has(normalized)) return "authorization";

  return null;
}

/**
 * Check if a message contains an explicit mode command (alias allow-list)
 * Returns the new mode, or null if no command found
 */
export function detectModeCommand(message: string): CaseMode | null {
  return detectExplicitCommandAlias(message);
}

/**
 * Check if the LLM response contains a transition signal
 * Returns the new mode and cleaned response, or null if no transition
 */
export function detectTransitionSignal(response: string): {
  newMode: CaseMode;
  cleanedResponse: string;
} | null {
  if (response.includes(TRANSITION_SIGNAL)) {
    // Remove the transition signal from the response
    const cleanedResponse = response
      .replace(TRANSITION_SIGNAL, "")
      .trim();
    
    return {
      newMode: "final_report",
      cleanedResponse,
    };
  }
  
  return null;
}

/**
 * Language name mapping for clearer directives
 */
const LANGUAGE_NAMES: Record<string, string> = {
  EN: "English",
  RU: "Russian",
  ES: "Spanish",
};

/**
 * Build a HARD language directive for LLM (v1 - single language)
 * @deprecated Use buildLanguageDirectiveV2 for proper input/output separation
 */
export function buildLanguageDirective(args: {
  inputLanguage: string;
  mode: CaseMode;
}): string {
  const { inputLanguage, mode } = args;
  const langName = LANGUAGE_NAMES[inputLanguage] || inputLanguage;

  if (mode === "final_report") {
    return `LANGUAGE DIRECTIVE (MANDATORY):
Final output MUST be English first.
Then output '--- TRANSLATION ---' and translate the full output into ${langName} (${inputLanguage}).
Do not mix languages inside the English block.
The translation must be complete and literal.`;
  }

  // For diagnostic and authorization modes
  return `LANGUAGE DIRECTIVE (MANDATORY):
Technician input language: ${inputLanguage} (${langName}).
All dialogue MUST be in ${langName}.
Do not respond in any other language.
Do not use English unless the technician's language is English.`;
}

/**
 * Build a HARD language directive for LLM (v2 - separate input/output)
 * 
 * Translation behavior is driven by the LanguagePolicy (declarative),
 * NOT by ad-hoc prompt logic. The policy's `includeTranslation` field
 * determines whether a translation section appears.
 *
 * @param inputDetected - The language the technician wrote in
 * @param outputEffective - The language the assistant must respond in
 * @param mode - Current case mode
 * @param includeTranslation - Whether the output must include a translation block (from LanguagePolicy)
 * @param translationLanguage - Target language for the translation block (from LanguagePolicy)
 */
export function buildLanguageDirectiveV2(args: {
  inputDetected: string;
  outputEffective: string;
  mode: CaseMode;
  includeTranslation?: boolean;
  translationLanguage?: string;
}): string {
  const { inputDetected, outputEffective, mode, includeTranslation, translationLanguage } = args;
  const inputLangName = LANGUAGE_NAMES[inputDetected] || inputDetected;
  const outputLangName = LANGUAGE_NAMES[outputEffective] || outputEffective;

  if (mode === "final_report") {
    if (includeTranslation && translationLanguage) {
      const translationLangName = LANGUAGE_NAMES[translationLanguage] || translationLanguage;
      return `LANGUAGE DIRECTIVE (MANDATORY):
Technician input language: ${inputDetected} (${inputLangName}).
Final output MUST be English first.
Then output '--- TRANSLATION ---' and translate the full output into ${translationLangName} (${translationLanguage}).
Do not mix languages inside the English block.
The translation must be complete and literal.`;
    }
    // No translation section (EN mode or AUTO+EN detected)
    return `LANGUAGE DIRECTIVE (MANDATORY):
Technician input language: ${inputDetected} (${inputLangName}).
Final output MUST be in English only.`;
  }

  // For diagnostic and authorization modes
  // Use the EFFECTIVE output language (which may be forced)
  return `LANGUAGE DIRECTIVE (MANDATORY):
Technician input language: ${inputDetected} (${inputLangName}).
All dialogue MUST be in ${outputLangName} (${outputEffective}).
Do not respond in any other language.
Do not use English unless the output language is English.`;
}

/**
 * Compose the full system prompt for a request (v1 - backward compatible)
 */
export function composePrompt(args: {
  mode: CaseMode;
  dialogueLanguage?: string;
  additionalConstraints?: string;
}): string {
  const { mode, dialogueLanguage, additionalConstraints } = args;
  const prompts = loadPrompts();

  const parts: string[] = [
    prompts.SYSTEM_BASE,
    "",
    "---",
    "",
    getModePrompt(mode),
  ];

  // Add HARD language directive if provided
  if (dialogueLanguage) {
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push(buildLanguageDirective({ inputLanguage: dialogueLanguage, mode }));
  }

  // Add additional constraints if provided
  if (additionalConstraints) {
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push(additionalConstraints);
  }

  return parts.join("\n");
}

/**
 * Compose the full system prompt for a request (v2 - proper input/output separation)
 * 
 * @param mode - Current case mode (diagnostic/authorization/final_report)
 * @param inputDetected - The language the technician wrote in (always detected from message)
 * @param outputEffective - The language the assistant must respond in (may be forced)
 * @param includeTranslation - Whether the output must include a translation block (from LanguagePolicy)
 * @param translationLanguage - Target language for the translation block (from LanguagePolicy)
 */
export function composePromptV2(args: {
  mode: CaseMode;
  inputDetected: string;
  outputEffective: string;
  includeTranslation?: boolean;
  translationLanguage?: string;
  additionalConstraints?: string;
}): string {
  const { mode, inputDetected, outputEffective, includeTranslation, translationLanguage, additionalConstraints } = args;
  const prompts = loadPrompts();

  const parts: string[] = [
    prompts.SYSTEM_BASE,
    "",
    "---",
    "",
    getModePrompt(mode),
  ];

  // Add v2 language directive with separate input/output languages
  // Translation behavior is driven by LanguagePolicy (declarative)
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push(buildLanguageDirectiveV2({ inputDetected, outputEffective, mode, includeTranslation, translationLanguage }));

  // Add additional constraints if provided
  if (additionalConstraints) {
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push(additionalConstraints);
  }

  return parts.join("\n");
}

/**
 * Build messages array for LLM with memory window
 */
export function buildMessagesWithMemory(args: {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  memoryWindow?: number;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const { systemPrompt, history, userMessage, memoryWindow = DEFAULT_MEMORY_WINDOW } = args;

  // Truncate history to memory window (last N messages)
  const truncatedHistory = history.slice(-memoryWindow);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...truncatedHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  return messages;
}

/**
 * Clear prompt cache (for testing)
 */
export function clearPromptCache(): void {
  promptCache = null;
}
