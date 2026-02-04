/**
 * Shared diagnostic state types.
 * 
 * IMPORTANT: Keep shared types independent of prompt sources.
 * Do NOT import from prompts/* here.
 */

export type InputLanguage = "en" | "ru" | "es";

export type CaseMode = "diagnostic" | "authorization" | "final_report";

/**
 * Diagnostic state for tracking case progress
 */
export type DiagnosticState = CaseMode;

/**
 * Extended diagnostic context (for future use)
 */
export type DiagnosticContext = {
  mode?: CaseMode;
  inputLanguage?: InputLanguage;
  completenessPassed?: boolean;
  postRepair?: boolean;
};
