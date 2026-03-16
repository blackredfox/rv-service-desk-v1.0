/**
 * Output policy enforcement for chat responses.
 *
 * Responsibility: Language policy enforcement, translation stripping.
 * Does NOT own: flow control, diagnostic logic.
 */

import type { LanguagePolicy, Language } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";

// Translation separator (must match mode-validators / output-validator)
export const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

/**
 * Output-layer enforcement: strip translation block when policy says none.
 * This is the final safety net — even if the LLM produces a translation,
 * it will be removed before the user sees it.
 */
export function enforceLanguagePolicy(text: string, policy: LanguagePolicy): string {
  if (!policy.includeTranslation && text.includes(TRANSLATION_SEPARATOR)) {
    return text.split(TRANSLATION_SEPARATOR)[0].trim();
  }
  return text;
}

/**
 * Extract the primary report block (before translation).
 */
export function extractPrimaryReportBlock(text: string): string {
  if (!text.includes(TRANSLATION_SEPARATOR)) return text;
  return text.split(TRANSLATION_SEPARATOR)[0].trim();
}

/**
 * Build final report fallback when LLM fails to generate valid output.
 */
export function buildFinalReportFallback(args: {
  policy: LanguagePolicy;
  translationLanguage?: Language;
  laborHours?: number;
}): string {
  const totalLaborText = formatLaborHoursForFallback(args.laborHours ?? 1.0);
  const englishReport = `Complaint: Complaint details pending verification.
Diagnostic Procedure: Diagnostic isolation completed based on available technician inputs.
Verified Condition: Condition not operating per specification under reported test conditions.
Recommended Corrective Action: Perform unit-level corrective action aligned to verified condition.
Estimated Labor: System isolation and access - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Required Parts: Part number to be confirmed at service counter.`;

  if (!args.policy.includeTranslation || !args.translationLanguage || args.translationLanguage === "EN") {
    return englishReport;
  }

  const translation =
    args.translationLanguage === "RU"
      ? `Жалоба: Детали жалобы ожидают подтверждения.
Диагностическая процедура: Диагностическая изоляция завершена на основе доступных данных техника.
Подтверждённое состояние: Состояние не соответствует спецификации при заявленных условиях проверки.
Рекомендуемое корректирующее действие: Выполнить корректирующее действие на уровне узла в соответствии с подтверждённым состоянием.
Оценка трудозатрат: Изоляция системы и доступ - ${totalLaborText} ч. Total labor: ${totalLaborText} hr.
Необходимые детали: Номер детали будет уточнён на сервисной стойке.`
      : `Queja: Los detalles de la queja están pendientes de verificación.
Procedimiento de diagnóstico: El aislamiento diagnóstico se completó con base en la información disponible del técnico.
Condición verificada: La condición no opera según especificación bajo las condiciones de prueba reportadas.
Acción correctiva recomendada: Realizar una acción correctiva a nivel de unidad alineada con la condición verificada.
Mano de obra estimada: Aislamiento del sistema y acceso - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Partes requeridas: El número de parte se confirmará en el mostrador de servicio.`;

  return `${englishReport}\n\n${TRANSLATION_SEPARATOR}\n\n${translation}`;
}

/**
 * Format labor hours for fallback display.
 */
function formatLaborHoursForFallback(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1);
}

/**
 * Diagnostic mode guard violation constant.
 */
export const DIAGNOSTIC_MODE_GUARD_VIOLATION =
  "DIAGNOSTIC_MODE_GUARD: Diagnostic mode output must not use final report section format";

/**
 * Apply diagnostic mode validation guard.
 * In diagnostic mode, output must NOT look like a final report.
 */
export function applyDiagnosticModeValidationGuard(
  validation: { valid: boolean; violations: string[] },
  mode: CaseMode,
  responseText: string
): { valid: boolean; violations: string[] } {
  if (mode !== "diagnostic") return validation;
  if (!looksLikeFinalReportForGuard(responseText)) return validation;

  if (validation.violations.includes(DIAGNOSTIC_MODE_GUARD_VIOLATION)) {
    return {
      ...validation,
      valid: false,
    };
  }

  return {
    ...validation,
    valid: false,
    violations: [...validation.violations, DIAGNOSTIC_MODE_GUARD_VIOLATION],
  };
}

/**
 * Check if text looks like a final report (for guard purposes).
 */
function looksLikeFinalReportForGuard(text: string): boolean {
  const t = text.toLowerCase();
  const required = [
    "complaint:",
    "diagnostic procedure:",
    "verified condition:",
    "recommended corrective action:",
    "estimated labor:",
    "required parts:",
  ];
  const hits = required.filter((k) => t.includes(k)).length;
  return hits >= 4;
}

/**
 * Build diagnostic drift correction instruction.
 */
export function buildDiagnosticDriftCorrectionInstruction(activeStepId?: string): string {
  const stepHint = activeStepId
    ? `Return to the active guided step (${activeStepId}).`
    : "Return to the active guided diagnostic step.";

  return [
    "Diagnostic drift correction (MANDATORY):",
    "- You are in DIAGNOSTIC mode, not FINAL_REPORT mode.",
    "- Do NOT output final report headers (Complaint/Diagnostic Procedure/Verified Condition/etc.).",
    `- ${stepHint}`,
    "- Ask exactly ONE concise diagnostic question that advances the procedure.",
  ].join("\n");
}

/**
 * Build diagnostic drift fallback response.
 */
export function buildDiagnosticDriftFallback(activeStepId?: string): string {
  const stepLabel = activeStepId ? ` (${activeStepId})` : "";
  return `Guided Diagnostics${stepLabel}: What is the observed result for this active diagnostic step?`;
}
