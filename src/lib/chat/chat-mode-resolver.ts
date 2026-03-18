import { detectModeCommand, type CaseMode } from "@/lib/prompt-composer";

const MODELS = {
  diagnostic: "gpt-5-mini-2025-08-07",
  final: "gpt-5.2-2025-12-11",
} as const;

/**
 * Resolve the stored case mode without introducing semantic inference.
 * Boundary rule: labor_confirmation is normalized to final_report only.
 */
export function resolveStoredCaseMode(mode?: CaseMode | null): CaseMode {
  if (mode === "labor_confirmation") {
    return "final_report";
  }

  return mode ?? "diagnostic";
}

/**
 * Resolve explicit command-driven mode changes only.
 * No semantic interpretation is allowed here.
 */
export function resolveExplicitModeChange(
  currentMode: CaseMode,
  message: string,
): { currentMode: CaseMode; nextMode: CaseMode; changed: boolean } {
  const commandMode = detectModeCommand(message);

  if (!commandMode || commandMode === currentMode) {
    return {
      currentMode,
      nextMode: currentMode,
      changed: false,
    };
  }

  return {
    currentMode,
    nextMode: commandMode,
    changed: true,
  };
}

/**
 * Select the configured model for the already-resolved mode.
 */
export function getModelForMode(mode: CaseMode): string {
  return mode === "final_report" || mode === "authorization"
    ? MODELS.final
    : MODELS.diagnostic;
}