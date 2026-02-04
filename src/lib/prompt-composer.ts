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
    default:
      return prompts.MODE_DIAGNOSTIC;
  }
}

/**
 * Check if a message contains an explicit mode command
 * Returns the new mode, or null if no command found
 */
export function detectModeCommand(message: string): CaseMode | null {
  const upperMessage = message.toUpperCase();

  // Check for explicit commands (order matters - more specific first)
  if (upperMessage.includes(MODE_COMMANDS.FINAL_REPORT)) {
    return "final_report";
  }
  if (upperMessage.includes(MODE_COMMANDS.AUTHORIZATION)) {
    return "authorization";
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
 * @param inputDetected - The language the technician wrote in
 * @param outputEffective - The language the assistant must respond in
 * @param mode - Current case mode
 */
export function buildLanguageDirectiveV2(args: {
  inputDetected: string;
  outputEffective: string;
  mode: CaseMode;
}): string {
  const { inputDetected, outputEffective, mode } = args;
  const inputLangName = LANGUAGE_NAMES[inputDetected] || inputDetected;
  const outputLangName = LANGUAGE_NAMES[outputEffective] || outputEffective;

  if (mode === "final_report") {
    // Final report: English first, then translate to DETECTED input language
    // (so technician reads translation in the language they wrote in)
    return `LANGUAGE DIRECTIVE (MANDATORY):
Technician input language: ${inputDetected} (${inputLangName}).
Final output MUST be English first.
Then output '--- TRANSLATION ---' and translate the full output into ${inputLangName} (${inputDetected}).
Do not mix languages inside the English block.
The translation must be complete and literal.`;
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
