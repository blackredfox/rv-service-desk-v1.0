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
 * Compose the full system prompt for a request
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

  // Add language context if provided
  if (dialogueLanguage) {
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push(`CURRENT DIALOGUE LANGUAGE: ${dialogueLanguage}`);
    parts.push(`Output diagnostic questions in ${dialogueLanguage}.`);
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
