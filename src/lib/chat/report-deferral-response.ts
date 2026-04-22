/**
 * Surface-aware report-request deferral response.
 *
 * When a technician requests a documentation surface (warranty report,
 * estimate, authorization request, portal cause, etc.) but the runtime
 * readiness gate is not satisfied, we MUST NOT:
 *
 *   - unlock the final-output surface from LLM / technician wording
 *     (see CUSTOMER_BEHAVIOR_SPEC §5–§6 and ARCHITECTURE_RULES A1 / G1b)
 *   - fall into a questionnaire-first "what was the complaint / finding
 *     / repair" collection (see ARCHITECTURE_RULES B3 and ROADMAP §7.3)
 *   - invent facts or claim the transcript contains verified evidence
 *     that the Context Engine has not actually recorded
 *
 * But we also MUST NOT reply with a dead-end generic "diagnostics not
 * complete" one-liner that is blind to the surface the technician
 * explicitly requested.
 *
 * This helper produces a deterministic, engine-grounded, surface-aware
 * deferral response:
 *
 *   1. acknowledges the requested documentation surface by its correct
 *      human name, in the active session language
 *   2. states that diagnostics are not yet complete (unchanged doctrine)
 *   3. if a Context-Engine-owned active step exists, quotes the
 *      authoritative next-step question verbatim and points at it as
 *      the legal path forward
 *   4. if no active step is available (case pre-init or degenerate
 *      state), falls back to a generic "let's continue diagnostics"
 *      line (same shape as the prior helper, no worse than baseline)
 *
 * This helper is deliberately:
 *
 *   - pure (no IO, no state mutation)
 *   - mode-neutral (callers MUST keep the case in diagnostic mode)
 *   - gate-neutral (does not mark isolation complete, does not emit
 *     any output-surface signal, does not alter readiness state)
 *   - questionnaire-free (never asks for complaint / findings /
 *     repair / labor / parts as documentation form fields)
 */

import type { Language } from "@/lib/lang";
import type { OutputSurface } from "@/lib/prompt-composer";
import type { ReportKind } from "@/lib/chat/report-intent";

export type ReportDeferralInputs = {
  language: Language;
  requestedSurface?: OutputSurface | null;
  requestedReportKind?: ReportKind | null;
  activeStepQuestion?: string | null;
  activeProcedureDisplayName?: string | null;
};

type SurfaceLabels = {
  EN: string;
  RU: string;
  ES: string;
};

/**
 * Per-surface human labels, in the three supported runtime languages.
 * Keys correspond to OutputSurface values; "shop_final_report" is
 * further disambiguated by ReportKind below.
 */
const SURFACE_LABELS: Record<Exclude<OutputSurface, "diagnostic" | "shop_final_report">, SurfaceLabels> = {
  authorization_ready: {
    EN: "authorization request",
    RU: "запрос на авторизацию",
    ES: "solicitud de autorización",
  },
  portal_cause: {
    EN: "portal cause submission",
    RU: "сообщение о причине в портал",
    ES: "envío de causa al portal",
  },
  labor_confirmation: {
    EN: "labor confirmation",
    RU: "подтверждение трудозатрат",
    ES: "confirmación de mano de obra",
  },
};

/**
 * shop_final_report disambiguated by report kind.
 */
const SHOP_FINAL_REPORT_LABELS: Record<ReportKind | "final", SurfaceLabels> = {
  warranty: {
    EN: "warranty report",
    RU: "гарантийный отчёт",
    ES: "reporte de garantía",
  },
  retail: {
    EN: "retail report",
    RU: "розничный отчёт",
    ES: "reporte minorista",
  },
  generic: {
    EN: "final report",
    RU: "финальный отчёт",
    ES: "informe final",
  },
  final: {
    EN: "final report",
    RU: "финальный отчёт",
    ES: "informe final",
  },
};

function resolveSurfaceLabel(
  language: Language,
  surface: OutputSurface | null | undefined,
  reportKind: ReportKind | null | undefined,
): string {
  const lang: keyof SurfaceLabels = language === "RU" || language === "ES" ? language : "EN";

  if (surface === "shop_final_report" || !surface || surface === "diagnostic") {
    const kindKey: keyof typeof SHOP_FINAL_REPORT_LABELS =
      reportKind === "warranty" || reportKind === "retail" || reportKind === "generic"
        ? reportKind
        : "final";
    return SHOP_FINAL_REPORT_LABELS[kindKey][lang];
  }

  return SURFACE_LABELS[surface][lang];
}

/**
 * Preambles acknowledging the requested surface, per language.
 * The {surface} placeholder is resolved via resolveSurfaceLabel.
 */
const PREAMBLES: SurfaceLabels = {
  EN: "You've asked to generate a {surface}, but diagnostics are not yet complete.",
  RU: "Вы попросили сформировать {surface}, но диагностика ещё не завершена.",
  ES: "Solicitaste generar un {surface}, pero el diagnóstico aún no está completo.",
};

const NEXT_STEP_POINTERS: SurfaceLabels = {
  EN: "Next diagnostic step: \u201C{question}\u201D — continuing from there is what moves this toward a valid report.",
  RU: "Следующий шаг диагностики: «{question}» — именно его прохождение ведёт к корректному отчёту.",
  ES: "Siguiente paso del diagnóstico: «{question}» — continuar desde ahí es lo que permite avanzar hacia un reporte válido.",
};

const GENERIC_CONTINUATIONS: SurfaceLabels = {
  EN: "Let's continue diagnostics so the report can be assembled from verified evidence.",
  RU: "Продолжим диагностику, чтобы отчёт собирался на основе подтверждённых данных.",
  ES: "Continuemos el diagnóstico para que el reporte se elabore con evidencia verificada.",
};

const PROCEDURE_NAME_PREFIX: SurfaceLabels = {
  EN: "Active diagnostic flow: ",
  RU: "Активная диагностическая процедура: ",
  ES: "Flujo de diagnóstico activo: ",
};

/**
 * Build the surface-aware report-deferral response.
 *
 * Contract:
 *   - output is 1-3 short lines, separated by "\n"
 *   - never contains questionnaire-style report-field asks
 *   - never implies the report is about to be generated
 *   - never implies any gate has been unlocked
 *   - if activeStepQuestion is provided, it is quoted verbatim; the
 *     caller is responsible for passing the engine-authoritative
 *     question (typically via diagnostic-registry.getActiveStepQuestion)
 */
export function buildSurfaceAwareReportDeferralResponse(inputs: ReportDeferralInputs): string {
  const language: keyof SurfaceLabels =
    inputs.language === "RU" || inputs.language === "ES" ? inputs.language : "EN";

  const surfaceLabel = resolveSurfaceLabel(
    inputs.language,
    inputs.requestedSurface ?? null,
    inputs.requestedReportKind ?? null,
  );

  const preamble = PREAMBLES[language].replace("{surface}", surfaceLabel);

  const lines: string[] = [preamble];

  const trimmedQuestion = (inputs.activeStepQuestion ?? "").trim();
  const trimmedProcedureName = (inputs.activeProcedureDisplayName ?? "").trim();

  if (trimmedProcedureName) {
    lines.push(`${PROCEDURE_NAME_PREFIX[language]}${trimmedProcedureName}.`);
  }

  if (trimmedQuestion) {
    lines.push(NEXT_STEP_POINTERS[language].replace("{question}", trimmedQuestion));
  } else {
    lines.push(GENERIC_CONTINUATIONS[language]);
  }

  return lines.join("\n");
}
