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
        "Progress: 1/21 steps completed",
        "",
        "Step wh_2: LP tank level — gauge reading or weight check? Main tank valve fully open?",
      ].join("\n"),
      mode: "diagnostic",
      trackedInputLanguage: "RU",
      outputLanguage: "RU",
      includeTranslation: false,
      activeStepMetadata: {
        id: "wh_2",
        question:
          "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
        procedureName: "Водонагреватель (газовый/комбинированный)",
        progress: { completed: 1, total: 21 },
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
      outputLanguage: "RU",
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      activeStepMetadata: {
        id: "wh_2",
        question:
          "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
        procedureName: "Водонагреватель (газовый/комбинированный)",
        progress: { completed: 1, total: 21 },
      },
      activeStepId: "wh_2",
    });

    expect(fallback).toContain("Водонагреватель (газовый/комбинированный) — Пошаговая диагностика");
    expect(fallback).toContain("Прогресс: 1/21 шагов завершено");
    expect(fallback).toContain("Шаг wh_2:");
    expect(fallback).toContain("Какой уровень в LP-баке");
    expect(fallback).not.toMatch(/\b(Guided Diagnostics|Progress|Step)\b/);
  });
});