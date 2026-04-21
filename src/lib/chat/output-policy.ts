/**
 * Output policy enforcement for chat responses.
 *
 * Responsibility: Language policy enforcement, translation stripping.
 * Does NOT own: flow control, diagnostic logic.
 */

import { detectLanguage, type LanguagePolicy, type Language } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";
import type { FinalReportAuthorityFacts } from "@/lib/fact-pack";

// Translation separator (must match mode-validators / output-validator)
export const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

export const STEP_GUIDANCE_CONTINUATIONS: Record<Language, string> = {
  EN: "We are still on this step. After you perform that check, tell me exactly what you found.",
  RU: "Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.",
  ES: "Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.",
};

const STEP_GUIDANCE_LABELS: Record<Language, { currentStep: string; genericGuidance: string }> = {
  EN: {
    currentStep: "Current step",
    genericGuidance:
      "Perform the exact check for this active step at the referenced point with the correct tool, then note the actual reading or condition.",
  },
  RU: {
    currentStep: "Текущий шаг",
    genericGuidance:
      "Выполните точную проверку для этого активного шага в указанной точке подходящим инструментом, затем зафиксируйте фактическое показание или состояние.",
  },
  ES: {
    currentStep: "Paso actual",
    genericGuidance:
      "Realiza la verificación exacta de este paso activo en el punto indicado con la herramienta correcta y anota la lectura o condición real.",
  },
};

function isSessionLanguageText(text: string | null | undefined, language: Language): boolean {
  if (!text?.trim()) return false;
  return detectLanguage(text).language === language;
}

export function getStepGuidanceContinuation(language: Language): string {
  return STEP_GUIDANCE_CONTINUATIONS[language];
}

export function buildStepGuidanceResponse(args: {
  language: Language;
  stepQuestion?: string | null;
  guidance?: string | null;
}): string {
  const labels = STEP_GUIDANCE_LABELS[args.language];
  const safeStepQuestion = isSessionLanguageText(args.stepQuestion, args.language)
    ? args.stepQuestion!.trim()
    : "";
  const safeGuidance = isSessionLanguageText(args.guidance, args.language)
    ? args.guidance!.trim()
    : labels.genericGuidance;

  const lines = [
    safeStepQuestion ? `${labels.currentStep}: ${safeStepQuestion}` : "",
    safeGuidance,
    getStepGuidanceContinuation(args.language),
  ].filter(Boolean);

  return lines.join("\n\n");
}

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
 * Now accepts optional complaint and finding from conversation history.
 */
export function buildFinalReportFallback(args: {
  policy: LanguagePolicy;
  translationLanguage?: Language;
  laborHours?: number;
  complaint?: string;
  diagnosticProcedure?: string;
  finding?: string;
  correctiveAction?: string;
  requiredParts?: string;
}): string {
  const totalLaborText = formatLaborHoursForFallback(args.laborHours ?? 1.0);
  
  // Use provided complaint or fallback to generic
  const complaintText = args.complaint?.trim() || "Complaint details pending verification.";
  const procedureText = args.diagnosticProcedure?.trim() || "Diagnostic isolation completed based on available technician inputs.";
  const findingText = args.finding?.trim() || "Condition not operating per specification under reported test conditions.";
  const correctiveActionText = args.correctiveAction?.trim() || "Perform unit-level corrective action aligned to verified condition.";
  const requiredPartsText = args.requiredParts?.trim() || "Part number to be confirmed at service counter.";
  
  const englishReport = `Complaint: ${complaintText}
Diagnostic Procedure: ${procedureText}
Verified Condition: ${findingText}
Recommended Corrective Action: ${correctiveActionText}
Estimated Labor: System isolation and access - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Required Parts: ${requiredPartsText}`;

  if (!args.policy.includeTranslation || !args.translationLanguage || args.translationLanguage === "EN") {
    return englishReport;
  }

  // For translations, use complaint as-is if provided (may already be in target language)
  const translatedComplaint = args.complaint?.trim() || (
    args.translationLanguage === "RU"
      ? "Детали жалобы ожидают подтверждения."
      : "Los detalles de la queja están pendientes de verificación."
  );
  
  const translatedFinding = args.finding?.trim() || (
    args.translationLanguage === "RU"
      ? "Состояние не соответствует спецификации при заявленных условиях проверки."
      : "La condición no opera según especificación bajo las condiciones de prueba reportadas."
  );

  const translation =
    args.translationLanguage === "RU"
      ? `Жалоба: ${translatedComplaint}
Диагностическая процедура: Диагностическая изоляция завершена на основе доступных данных техника.
Подтверждённое состояние: ${translatedFinding}
Рекомендуемое корректирующее действие: Выполнить корректирующее действие на уровне узла в соответствии с подтверждённым состоянием.
Оценка трудозатрат: Изоляция системы и доступ - ${totalLaborText} ч. Total labor: ${totalLaborText} hr.
Необходимые детали: Номер детали будет уточнён на сервисной стойке.`
      : `Queja: ${translatedComplaint}
Procedimiento de diagnóstico: El aislamiento diagnóstico se completó con base en la información disponible del técnico.
Condición verificada: ${translatedFinding}
Acción correctiva recomendada: Realizar una acción correctiva a nivel de unidad alineada con la condición verificada.
Mano de obra estimada: Aislamiento del sistema y acceso - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Partes requeridas: El número de parte se confirmará en el mostrador de servicio.`;

  return `${englishReport}\n\n${TRANSLATION_SEPARATOR}\n\n${translation}`;
}

/**
 * Build Portal Cause fallback when the active legal surface is portal_cause.
 */
export function buildPortalCauseFallback(args: {
  policy: LanguagePolicy;
  translationLanguage?: Language;
  complaint?: string;
  finding?: string;
}): string {
  const englishCause = args.finding?.trim()
    ? `Technician-verified portal cause: ${args.finding.trim()}`
    : args.complaint?.trim()
    ? `Technician-verified portal cause is not fully established yet. Current complaint on record: ${args.complaint.trim()}`
    : "Technician-verified portal cause is not fully established yet. Additional verified findings are required.";

  if (!args.policy.includeTranslation || !args.translationLanguage || args.translationLanguage === "EN") {
    return englishCause;
  }

  const translation =
    args.translationLanguage === "RU"
      ? args.finding?.trim()
        ? `Подтверждённая техником причина для портала: ${args.finding.trim()}`
        : args.complaint?.trim()
        ? `Причина для портала ещё не установлена полностью. Текущая зарегистрированная жалоба: ${args.complaint.trim()}`
        : "Причина для портала ещё не установлена полностью. Требуются дополнительные подтверждённые данные."
      : args.finding?.trim()
      ? `Causa del portal verificada por el técnico: ${args.finding.trim()}`
      : args.complaint?.trim()
      ? `La causa del portal todavía no está totalmente establecida. Queja registrada actualmente: ${args.complaint.trim()}`
      : "La causa del portal todavía no está totalmente establecida. Se requieren hallazgos verificados adicionales.";

  return `${englishCause}\n\n${TRANSLATION_SEPARATOR}\n\n${translation}`;
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
 * Isolation declaration violation constant.
 */
export const ISOLATION_DECLARATION_VIOLATION =
  "ISOLATION_DECLARATION_BLOCKED: LLM cannot declare isolation complete";

/**
 * Check if violations indicate diagnostic drift that needs correction.
 */
export function isDiagnosticDriftViolation(violations: string[]): boolean {
  return violations.some(v => 
    v.includes("DIAGNOSTIC_DRIFT") || 
    v.includes("DIAGNOSTIC_MODE_GUARD") ||
    v.includes("ISOLATION_DECLARATION_BLOCKED") ||
    v.includes("TRANSITION_MARKER_BLOCKED")
  );
}

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
    "- Do NOT declare 'isolation complete', 'conditions met', or similar phrases.",
    "- Do NOT output [TRANSITION: FINAL_REPORT] or any transition markers.",
    "- Only the TECHNICIAN can end diagnostics by sending 'START FINAL REPORT'.",
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

/**
 * Build an authoritative step fallback that includes the exact step question.
 * Used when LLM fails to render the correct step after retry.
 */
export function buildAuthoritativeStepFallback(
  stepMetadata: { id: string; question: string; procedureName: string; progress: { completed: number; total: number } } | null,
  fallbackStepId?: string,
  language: Language = "EN",
): string {
  const labels =
    language === "RU"
      ? {
          guidedDiagnostics: "Пошаговая диагностика",
          progress: "Прогресс",
          stepsCompleted: "шагов завершено",
          step: "Шаг",
          genericQuestion: "Каков фактический результат по этому активному диагностическому шагу?",
        }
      : language === "ES"
      ? {
          guidedDiagnostics: "Diagnóstico guiado",
          progress: "Progreso",
          stepsCompleted: "pasos completados",
          step: "Paso",
          genericQuestion: "¿Cuál es el resultado observado para este paso de diagnóstico activo?",
        }
      : {
          guidedDiagnostics: "Guided Diagnostics",
          progress: "Progress",
          stepsCompleted: "steps completed",
          step: "Step",
          genericQuestion: "What is the observed result for this active diagnostic step?",
        };

  if (!stepMetadata) {
    // No metadata available — use generic fallback
    const stepLabel = fallbackStepId ? ` (${fallbackStepId})` : "";
    return `${labels.guidedDiagnostics}${stepLabel}: ${labels.genericQuestion}`;
  }
  
  // Build authoritative response with exact step question
  const lines = [
    `${stepMetadata.procedureName} — ${labels.guidedDiagnostics}`,
    `${labels.progress}: ${stepMetadata.progress.completed}/${stepMetadata.progress.total} ${labels.stepsCompleted}`,
    ``,
    `${labels.step} ${stepMetadata.id}: ${stepMetadata.question}`,
  ];
  
  return lines.join("\n");
}

/**
 * ─────────────────────────────────────────────────────────────────────
 * PR1 (agent-freedom): Diagnostic-turn fallbacks moved out of route.ts.
 *
 * These builders used to run as UNCONDITIONAL server bypasses in
 * src/app/api/chat/route.ts, flattening any LLM-authored diagnostic
 * turn into server-scripted status-terminal prose. In PR1 they are
 * demoted to validation-failure fallbacks only. The Context Engine
 * is still the single flow authority; these helpers only produce
 * the deterministic transcript-grounded text used when the LLM
 * output fails mode / step / language validation after retry.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Transcript-grounded completion-offer fallback.
 *
 * Used ONLY when the bounded LLM completion-offer turn fails validation
 * after retry. Produces a short 3-line acknowledgment + restored-state
 * sentence + concise report invitation in the session language. Fuse-
 * case repair wording is preserved so a blown-fuse transcript never
 * drifts into generic "repair" wording on the fallback path.
 */
export function buildAuthoritativeCompletionOffer(args: {
  language: Language;
  isolationFinding?: string | null;
  facts?: FinalReportAuthorityFacts | null;
}): string {
  const evidence = [
    args.isolationFinding,
    args.facts?.verifiedCondition,
    args.facts?.correctiveAction,
    args.facts?.requiredParts,
  ]
    .filter(Boolean)
    .join(" ");

  const isFuseRepair = /предохранител|fuse/i.test(evidence);

  switch (args.language) {
    case "RU":
      return isFuseRepair
        ? [
            "Принято.",
            "Причина подтверждена: неисправный предохранитель в цепи питания водонагревателя.",
            "Ремонт подтверждён: предохранитель заменён, водонагреватель работает штатно.",
            "Если хотите отчёт сейчас, попросите меня сделать отчёт или отправьте START FINAL REPORT.",
          ].join("\n")
        : [
            "Принято.",
            args.isolationFinding ?? "Восстановление после ремонта подтверждено.",
            "Если хотите отчёт сейчас, попросите меня сделать отчёт или отправьте START FINAL REPORT.",
          ].join("\n");
    case "ES":
      return isFuseRepair
        ? [
            "Entendido.",
            "Causa confirmada: fusible defectuoso en el circuito de alimentación del calentador de agua.",
            "Reparación confirmada: se reemplazó el fusible y el calentador funciona normalmente.",
            "Si quieres el informe ahora, pídeme que lo prepare o envía START FINAL REPORT.",
          ].join("\n")
        : [
            "Entendido.",
            args.isolationFinding ?? "La restauración después de la reparación fue confirmada.",
            "Si quieres el informe ahora, pídeme que lo prepare o envía START FINAL REPORT.",
          ].join("\n");
    default:
      return isFuseRepair
        ? [
            "Noted.",
            "Root cause confirmed: failed fuse in the water-heater power path.",
            "Repair confirmed: the fuse was replaced and the water heater is operating normally.",
            "If you want the report now, ask me to write the report, or send START FINAL REPORT.",
          ].join("\n")
        : [
            "Noted.",
            args.isolationFinding ?? "Repair completion and restored operation have been confirmed.",
            "If you want the report now, ask me to write the report, or send START FINAL REPORT.",
          ].join("\n");
  }
}

/**
 * Transcript-grounded "diagnostics not ready" fallback.
 *
 * Used ONLY when a bounded LLM reply to a report request during
 * unresolved diagnostics fails validation after retry. Stays in the
 * diagnostic surface: no report headers, no questionnaire, no
 * START FINAL REPORT wording — just a deterministic redirect back
 * to the active step.
 */
export function buildDiagnosticsNotReadyResponse(language: Language): string {
  switch (language) {
    case "RU":
      return "Диагностика ещё не завершена. Давайте продолжим с текущего шага, прежде чем формировать отчёт.";
    case "ES":
      return "El diagnóstico aún no está completo. Continuemos con el paso actual antes de generar el informe.";
    default:
      return "Diagnostics are not yet complete. Let\u2019s continue with the current step before generating the report.";
  }
}

/**
 * Diagnostic-turn fallback intent carried from route.ts into the
 * primary response pipeline. When the LLM output fails validation
 * after retry, the fallback layer picks the matching grounded text
 * instead of the generic status-terminal step fallback.
 *
 *   - "completion_offer":  isolation confirmed, LLM was asked to
 *                          acknowledge + state root cause + invite report.
 *   - "report_not_ready":  report requested while isolation unresolved,
 *                          LLM was asked to decline + redirect to step.
 */
export type DiagnosticFallbackHint =
  | { kind: "completion_offer"; isolationFinding?: string | null; facts?: FinalReportAuthorityFacts | null }
  | { kind: "report_not_ready" };

/**
 * Directive injected into the Context Engine directive block when the
 * technician requests a report but isolation is not complete. Keeps the
 * LLM in diagnostic mode, prevents questionnaire-first fallback, and
 * does not introduce a second flow authority — legality (mode stays
 * diagnostic, active step unchanged) remains owned by the server.
 */
export function buildReportNotReadyDirective(): string {
  return [
    "── REPORT REQUEST DEFERRED ──",
    "The technician asked for a report, but diagnostic isolation is NOT complete.",
    "The Context Engine is still on an active diagnostic step.",
    "",
    "MANDATORY RESPONSE (this turn only):",
    "1. Briefly acknowledge the report request in one line, in the session language.",
    "2. Say diagnostics are not yet complete, in natural technician-facing phrasing.",
    "3. Redirect back to the current active diagnostic step with one concise question or short instruction.",
    "",
    "CRITICAL RULES:",
    "- Do NOT output any final-report section headers (Complaint / Diagnostic Procedure / Verified Condition / Recommended Corrective Action / Estimated Labor / Required Parts).",
    "- Do NOT mention START FINAL REPORT.",
    "- Do NOT ask questionnaire-style questions about complaint / findings / performed repair.",
    "- Do NOT switch the active system or object.",
    "- Remain in diagnostic mode.",
  ].join("\n");
}
