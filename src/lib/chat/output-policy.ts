/**
 * Output policy enforcement for chat responses.
 *
 * Responsibility: Language policy enforcement, translation stripping.
 * Does NOT own: flow control, diagnostic logic.
 */

import { detectLanguage, type LanguagePolicy, type Language } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";

// Translation separator (must match mode-validators / output-validator)
export const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

export const STEP_GUIDANCE_CONTINUATIONS: Record<Language, string> = {
  EN: "We are still on this step. After you perform that check, tell me exactly what you found.",
  RU: "Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.",
  ES: "Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.",
};

/**
 * PR4: Chained clarification responses — more natural locate/identify help
 * that stays on the same active step.
 */
export const CHAINED_LOCATE_GUIDANCE: Record<Language, Record<string, string>> = {
  EN: {
    fuse: "The fuse is typically located in the DC distribution panel or near the water heater itself. Look for the fuse/breaker panel inside a compartment on the exterior of the RV, or check behind a removable panel near the water heater. Measure battery voltage at the switch input and output, or check both upstream (source side) and downstream (load side) of the fuse.",
    connector: "The connector is usually at the back of the control board or near the gas valve assembly. Follow the wiring harness from the board to locate the connection point.",
    board: "The control board is typically mounted inside the water heater access panel. Remove the exterior cover to access the electronics compartment.",
    relay: "The relay is usually mounted on or near the control board. It may be a small black box with multiple terminals.",
    generic: "Check the component location in the equipment access panel. Look for labels or follow the wiring from known points.",
  },
  RU: {
    fuse: "Предохранитель обычно находится в распределительном щитке постоянного тока или рядом с самим водонагревателем. Ищите панель предохранителей/автоматов внутри отсека снаружи автодома, или проверьте за съёмной панелью рядом с водонагревателем. Проверьте напряжение аккумулятора на вход и выход предохранителя.",
    connector: "Разъём обычно находится на задней стороне платы управления или рядом с газовым клапаном. Проследите жгут проводов от платы, чтобы найти точку подключения.",
    board: "Плата управления обычно установлена внутри панели доступа водонагревателя. Снимите наружную крышку для доступа к отсеку электроники.",
    relay: "Реле обычно установлено на плате управления или рядом с ней. Это может быть небольшая чёрная коробочка с несколькими клеммами.",
    generic: "Проверьте расположение компонента в панели доступа оборудования. Ищите маркировку или проследите проводку от известных точек.",
  },
  ES: {
    fuse: "El fusible generalmente está ubicado en el panel de distribución de CC o cerca del calentador de agua. Busca el panel de fusibles/interruptores dentro de un compartimento en el exterior de la casa rodante, o revisa detrás de un panel removible cerca del calentador de agua. Verifica tanto aguas arriba (lado de la fuente) como aguas abajo (lado de la carga) del fusible.",
    connector: "El conector generalmente está en la parte posterior de la placa de control o cerca del conjunto de la válvula de gas. Sigue el arnés de cables desde la placa para localizar el punto de conexión.",
    board: "La placa de control generalmente está montada dentro del panel de acceso del calentador de agua. Retira la cubierta exterior para acceder al compartimento de electrónica.",
    relay: "El relé generalmente está montado en o cerca de la placa de control. Puede ser una pequeña caja negra con múltiples terminales.",
    generic: "Verifica la ubicación del componente en el panel de acceso del equipo. Busca etiquetas o sigue el cableado desde puntos conocidos.",
  },
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
  isChainedClarification?: boolean;
  clarificationTarget?: string | null;
}): string {
  const labels = STEP_GUIDANCE_LABELS[args.language];
  const safeStepQuestion = isSessionLanguageText(args.stepQuestion, args.language)
    ? args.stepQuestion!.trim()
    : "";
  const safeGuidance = isSessionLanguageText(args.guidance, args.language)
    ? args.guidance!.trim()
    : labels.genericGuidance;

  // PR4: For chained clarification, provide more specific locate help
  if (args.isChainedClarification && args.clarificationTarget) {
    const locateGuidance = CHAINED_LOCATE_GUIDANCE[args.language];
    const targetKey = detectLocateTarget(args.clarificationTarget);
    const specificGuidance = locateGuidance[targetKey] || locateGuidance.generic;
    
    const lines = [
      specificGuidance,
      getStepGuidanceContinuation(args.language),
    ];
    return lines.join("\n\n");
  }

  const lines = [
    safeStepQuestion ? `${labels.currentStep}: ${safeStepQuestion}` : "",
    safeGuidance,
    getStepGuidanceContinuation(args.language),
  ].filter(Boolean);

  return lines.join("\n\n");
}

/**
 * PR4: Detect what component the technician is trying to locate
 */
function detectLocateTarget(message: string): string {
  const lower = message.toLowerCase();
  
  // Fuse patterns (EN/RU/ES)
  if (/fuse|fusible|предохранител/i.test(lower)) return "fuse";
  
  // Connector patterns
  if (/connector|conector|разъ[её]м|подключен/i.test(lower)) return "connector";
  
  // Board patterns
  if (/board|placa|плат/i.test(lower)) return "board";
  
  // Relay patterns
  if (/relay|rel[eé]|реле/i.test(lower)) return "relay";
  
  return "generic";
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
