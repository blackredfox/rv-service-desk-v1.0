import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Diagnostic language lock regression", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("diag-lang-lock");
  });

  it("RU input builds fully localized structured diagnostic context", async () => {
    const { initializeCase, buildRegistryContext, getActiveStepMetadata } = await import(
      "@/lib/diagnostic-registry"
    );

    initializeCase("diag-lang-lock", "газовый водонагреватель Suburban");

    const context = buildRegistryContext("diag-lang-lock", "wh_2", "RU");
    const metadata = getActiveStepMetadata("diag-lang-lock", "wh_2", "RU");

    expect(context).toContain("АКТИВНАЯ ДИАГНОСТИЧЕСКАЯ ПРОЦЕДУРА");
    expect(context).toContain("Прогресс:");
    expect(context).toContain("ТЕКУЩИЙ ШАГ: wh_2");
    expect(context).toContain("Какой уровень в LP-баке");
    expect(context).not.toContain("ACTIVE DIAGNOSTIC PROCEDURE");
    expect(context).not.toContain("Progress:");
    expect(context).not.toContain("LP tank level");

    expect(metadata?.procedureName).toBe("Водонагреватель (газовый/комбинированный)");
    expect(metadata?.question).toContain("Какой уровень в LP-баке");
    expect(metadata?.question).not.toContain("LP tank level");
  });

  it("mixed EN structured diagnostic output is rejected in RU session", async () => {
    const { validatePrimaryResponse } = await import("@/lib/chat/response-validation-service");

    const result = validatePrimaryResponse({
      response: [
        "Принято.",
        "Progress: 1/24 steps completed",
        "",
        "Step wh_2: LP tank level — gauge reading or weight check? Main tank valve fully open?",
      ].join("\n"),
      mode: "diagnostic",
      outputSurface: "diagnostic",
      trackedInputLanguage: "RU",
      outputLanguage: "RU",
      includeTranslation: false,
      activeStepMetadata: {
        id: "wh_2",
        question:
          "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
        procedureName: "Водонагреватель (газовый/комбинированный)",
        progress: { completed: 1, total: 24 },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.violations.some((violation) => violation.includes("LANGUAGE_MISMATCH"))).toBe(true);
  });

  it("RU fallback renders the active step without English leakage", async () => {
    const { buildPrimaryFallbackResponse } = await import("@/lib/chat/response-validation-service");

    const fallback = buildPrimaryFallbackResponse({
      validation: {
        valid: false,
        violations: ["LANGUAGE_MISMATCH: leaked English step"],
      },
      mode: "diagnostic",
      outputSurface: "diagnostic",
      outputLanguage: "RU",
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      activeStepMetadata: {
        id: "wh_2",
        question:
          "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
        procedureName: "Водонагреватель (газовый/комбинированный)",
        progress: { completed: 1, total: 24 },
      },
      activeStepId: "wh_2",
    });

    expect(fallback).toContain("Какой уровень в LP-баке");
    // Metadata leak ban (Cases 95–99): the user-visible fallback must
    // NOT contain procedure-banner / progress / step-id labels.
    expect(fallback).not.toContain("— Пошаговая диагностика");
    expect(fallback).not.toMatch(/Прогресс\s*:/);
    expect(fallback).not.toMatch(/Шаг\s+wh_2/);
    expect(fallback).not.toMatch(/\b(Guided Diagnostics|Progress|Step)\b/);
  });

  it("RU roof AC metadata stays localized once subtype is explicit", async () => {
    const { initializeCase, buildRegistryContext, getActiveStepMetadata, clearRegistry } = await import(
      "@/lib/diagnostic-registry"
    );

    const caseId = "diag-lang-lock-roof-ac";
    clearRegistry(caseId);
    initializeCase(caseId, "крышный кондиционер не охлаждает");

    const context = buildRegistryContext(caseId, "ac_1", "RU");
    const metadata = getActiveStepMetadata(caseId, "ac_1", "RU");

    expect(context).toContain("Крышный кондиционер");
    expect(context).toContain("Когда AC включён, компрессор пытается запуститься");
    expect(context).not.toContain("Roof AC / Heat Pump");
    expect(context).not.toContain("When AC is turned on");

    expect(metadata?.procedureName).toBe("Крышный кондиционер");
    expect(metadata?.question).toContain("Когда AC включён, компрессор пытается запуститься");
    expect(metadata?.question).not.toContain("When AC is turned on");
  });
});