/**
 * Unit tests for buildSurfaceAwareReportDeferralResponse.
 *
 * Pure helper — no mocking. These tests pin:
 *   - surface label correctness across EN/RU/ES and ReportKind
 *   - engine-step-quote pass-through (verbatim)
 *   - generic-continuation fallback when no active step is provided
 *   - the questionnaire-first ban (no complaint/findings/repair prompts
 *     ever appear regardless of inputs)
 */

import { describe, expect, it } from "vitest";

import { buildSurfaceAwareReportDeferralResponse } from "@/lib/chat/report-deferral-response";

describe("buildSurfaceAwareReportDeferralResponse", () => {
  it("EN / warranty / active step: quotes step verbatim, acknowledges warranty report", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "EN",
      requestedSurface: "shop_final_report",
      requestedReportKind: "warranty",
      activeStepQuestion: "Check the fuse. What does your meter read?",
      activeProcedureDisplayName: "Water Heater",
    });
    expect(out).toContain("warranty report");
    expect(out).toContain("diagnostics are not yet complete");
    expect(out).toContain("Check the fuse. What does your meter read?");
    expect(out).toContain("Water Heater");
  });

  it("EN / retail / no active step: falls back to generic continuation with retail label", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "EN",
      requestedSurface: "shop_final_report",
      requestedReportKind: "retail",
      activeStepQuestion: null,
      activeProcedureDisplayName: null,
    });
    expect(out).toContain("retail report");
    expect(out).toContain("diagnostics are not yet complete");
    expect(out).toMatch(/continue diagnostics so the report can be assembled from verified evidence/i);
  });

  it("EN / shop_final_report / generic kind: uses neutral \"final report\" label", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "EN",
      requestedSurface: "shop_final_report",
      requestedReportKind: "generic",
      activeStepQuestion: null,
      activeProcedureDisplayName: null,
    });
    expect(out).toContain("final report");
    expect(out).not.toContain("warranty report");
    expect(out).not.toContain("retail report");
  });

  it("RU / warranty / active step: produces RU deferral with quoted step", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "RU",
      requestedSurface: "shop_final_report",
      requestedReportKind: "warranty",
      activeStepQuestion: "Проверьте предохранитель.",
      activeProcedureDisplayName: "Водонагреватель",
    });
    expect(out).toContain("гарантийный отчёт");
    expect(out).toContain("диагностика ещё не завершена");
    expect(out).toContain("Проверьте предохранитель.");
  });

  it("ES / warranty / active step: produces ES deferral with quoted step", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "ES",
      requestedSurface: "shop_final_report",
      requestedReportKind: "warranty",
      activeStepQuestion: "Verifica el fusible.",
      activeProcedureDisplayName: "Calentador",
    });
    expect(out).toContain("reporte de garantía");
    expect(out).toContain("el diagnóstico aún no está completo");
    expect(out).toContain("Verifica el fusible.");
  });

  it("authorization_ready surface produces the correct label per language", () => {
    expect(
      buildSurfaceAwareReportDeferralResponse({
        language: "EN",
        requestedSurface: "authorization_ready",
        requestedReportKind: null,
        activeStepQuestion: null,
        activeProcedureDisplayName: null,
      }),
    ).toContain("authorization request");

    expect(
      buildSurfaceAwareReportDeferralResponse({
        language: "RU",
        requestedSurface: "authorization_ready",
        requestedReportKind: null,
        activeStepQuestion: null,
        activeProcedureDisplayName: null,
      }),
    ).toContain("запрос на авторизацию");

    expect(
      buildSurfaceAwareReportDeferralResponse({
        language: "ES",
        requestedSurface: "authorization_ready",
        requestedReportKind: null,
        activeStepQuestion: null,
        activeProcedureDisplayName: null,
      }),
    ).toContain("solicitud de autorización");
  });

  it("portal_cause surface produces the correct label per language", () => {
    expect(
      buildSurfaceAwareReportDeferralResponse({
        language: "EN",
        requestedSurface: "portal_cause",
        requestedReportKind: null,
        activeStepQuestion: null,
        activeProcedureDisplayName: null,
      }),
    ).toContain("portal cause submission");
  });

  it("unknown / null surface defaults to neutral final-report label", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "EN",
      requestedSurface: null,
      requestedReportKind: null,
      activeStepQuestion: null,
      activeProcedureDisplayName: null,
    });
    expect(out).toContain("final report");
  });

  it("NEVER contains questionnaire-first report-field asks regardless of inputs", () => {
    const variants = [
      { language: "EN" as const, requestedSurface: "shop_final_report" as const, requestedReportKind: "warranty" as const },
      { language: "EN" as const, requestedSurface: "shop_final_report" as const, requestedReportKind: "retail" as const },
      { language: "EN" as const, requestedSurface: "authorization_ready" as const, requestedReportKind: null },
      { language: "RU" as const, requestedSurface: "shop_final_report" as const, requestedReportKind: "warranty" as const },
      { language: "ES" as const, requestedSurface: "shop_final_report" as const, requestedReportKind: "warranty" as const },
    ];

    for (const v of variants) {
      const out = buildSurfaceAwareReportDeferralResponse({
        ...v,
        activeStepQuestion: "Some active step",
        activeProcedureDisplayName: "Some Procedure",
      });

      // EN questionnaire labels
      expect(out).not.toMatch(/the original complaint/i);
      expect(out).not.toMatch(/what you found/i);
      expect(out).not.toMatch(/what repair you completed/i);
      expect(out).not.toMatch(/missing report details/i);
      expect(out).not.toMatch(/what was the complaint/i);
      expect(out).not.toMatch(/what did you find/i);
      // RU questionnaire labels
      expect(out).not.toContain("исходную жалобу");
      expect(out).not.toContain("что именно было обнаружено");
      expect(out).not.toContain("какой ремонт был фактически выполнен");
      // ES questionnaire labels
      expect(out).not.toContain("la queja original");
      expect(out).not.toContain("qué encontraste exactamente");
      expect(out).not.toContain("qué reparación completaste exactamente");
    }
  });

  it("trims whitespace on the active step question and procedure name", () => {
    const out = buildSurfaceAwareReportDeferralResponse({
      language: "EN",
      requestedSurface: "shop_final_report",
      requestedReportKind: "warranty",
      activeStepQuestion: "   Check the fuse.   ",
      activeProcedureDisplayName: "   Water Heater   ",
    });
    // Quoted verbatim inside the step pointer, but trimmed.
    expect(out).toContain("\u201CCheck the fuse.\u201D");
    expect(out).toContain("Water Heater");
    expect(out).not.toContain("   Water Heater   ");
  });
});
