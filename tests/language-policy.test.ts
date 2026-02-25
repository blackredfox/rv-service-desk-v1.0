import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for declarative LanguagePolicy architecture.
 *
 * Ensures:
 * - resolveLanguagePolicy produces correct policy for every mode
 * - EN mode never includes translation
 * - RU / ES / AUTO (non-EN) always include translation
 * - Validators enforce the policy at output layer
 * - Prompt composer uses policy, not ad-hoc logic
 */

// ── resolveLanguagePolicy ──────────────────────────────────────────

describe("resolveLanguagePolicy", () => {
  beforeEach(() => { vi.resetModules(); });

  it("EN mode → no translation", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("EN", "EN");

    expect(policy.mode).toBe("EN");
    expect(policy.primaryOutput).toBe("EN");
    expect(policy.includeTranslation).toBe(false);
    expect(policy.translationLanguage).toBeUndefined();
  });

  it("EN mode with RU detected input → still no translation", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("EN", "RU");

    expect(policy.includeTranslation).toBe(false);
  });

  it("RU mode → translation into Russian", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("RU", "RU");

    expect(policy.mode).toBe("RU");
    expect(policy.primaryOutput).toBe("EN");
    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("RU");
  });

  it("ES mode → translation into Spanish", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("ES", "ES");

    expect(policy.mode).toBe("ES");
    expect(policy.primaryOutput).toBe("EN");
    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("ES");
  });

  it("AUTO mode + EN detected → no translation", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("AUTO", "EN");

    expect(policy.mode).toBe("AUTO");
    expect(policy.includeTranslation).toBe(false);
    expect(policy.translationLanguage).toBeUndefined();
  });

  it("AUTO mode + RU detected → translation into Russian", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("AUTO", "RU");

    expect(policy.mode).toBe("AUTO");
    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("RU");
  });

  it("AUTO mode + ES detected → translation into Spanish", async () => {
    const { resolveLanguagePolicy } = await import("@/lib/lang");
    const policy = resolveLanguagePolicy("AUTO", "ES");

    expect(policy.mode).toBe("AUTO");
    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("ES");
  });
});

// ── Validator enforcement ──────────────────────────────────────────

describe("validateFinalReportOutput – policy enforcement", () => {
  beforeEach(() => { vi.resetModules(); });

  const ENGLISH_ONLY_REPORT = [
    "Complaint: Water pump not operating per spec when activated.",
    "Diagnostic Procedure: Diagnostic checks included voltage verification at pump terminals.",
    "Verified Condition: Pump receives power but produces no flow.",
    "Recommended Corrective Action: Replace water pump assembly.",
    "Required Parts: Water pump assembly.",
    "Estimated Labor: Remove and replace pump - 1.5 hr. Total labor: 1.5 hr.",
  ].join("\n");

  const BILINGUAL_REPORT = [
    ENGLISH_ONLY_REPORT,
    "--- TRANSLATION ---",
    "Жалоба: Водяной насос не работает при активации.",
    "Диагностическая процедура: Проверено напряжение на клеммах насоса.",
    "Подтверждённое состояние: Насос получает питание, но нет потока.",
    "Рекомендованное корректирующее действие: Заменить узел водяного насоса.",
    "Оценка трудоёмкости: Снятие и замена — 1.5 ч. Общее время: 1.5 ч.",
    "Требуемые детали: Узел водяного насоса.",
  ].join("\n");

  it("EN mode (includeTranslation=false) → English-only report is valid", async () => {
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");
    const result = validateFinalReportOutput(ENGLISH_ONLY_REPORT, false);

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("EN mode → report with translation block is INVALID", async () => {
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");
    const result = validateFinalReportOutput(BILINGUAL_REPORT, false);

    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("EN mode must not include"))).toBe(true);
  });

  it("RU mode (includeTranslation=true) → bilingual report is valid", async () => {
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");
    const result = validateFinalReportOutput(BILINGUAL_REPORT, true, "RU");

    expect(result.valid).toBe(true);
  });

  it("RU/ES mode → English-only report is INVALID (missing translation)", async () => {
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");
    const result = validateFinalReportOutput(ENGLISH_ONLY_REPORT, true);

    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Missing '--- TRANSLATION ---'"))).toBe(true);
  });

  it("default (no includeTranslation arg) → backward compat: requires translation", async () => {
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");
    const result = validateFinalReportOutput(ENGLISH_ONLY_REPORT);

    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("Missing '--- TRANSLATION ---'"))).toBe(true);
  });
});

describe("validateOutput dispatcher – forwards includeTranslation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("final_report + includeTranslation=false → allows English-only", async () => {
    const { validateOutput } = await import("@/lib/mode-validators");
    const englishOnly = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;

    const result = validateOutput(englishOnly, "final_report", false);
    expect(result.valid).toBe(true);
  });

  it("final_report + includeTranslation=true → rejects English-only", async () => {
    const { validateOutput } = await import("@/lib/mode-validators");
    const englishOnly = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;

    const result = validateOutput(englishOnly, "final_report", true);
    expect(result.valid).toBe(false);
  });

  it("diagnostic mode ignores includeTranslation", async () => {
    const { validateOutput } = await import("@/lib/mode-validators");

    const result = validateOutput("Is the pump working?", "diagnostic", false);
    expect(result.valid).toBe(true);
  });
});

// ── Prompt composer – policy-driven directives ─────────────────────

describe("buildLanguageDirectiveV2 – policy-driven", () => {
  beforeEach(() => { vi.resetModules(); });

  it("final_report + includeTranslation=false → no translation mention", async () => {
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");

    const directive = buildLanguageDirectiveV2({
      inputDetected: "EN",
      outputEffective: "EN",
      mode: "final_report",
      includeTranslation: false,
    });

    expect(directive).toContain("English only");
    expect(directive).not.toContain("--- TRANSLATION ---");
    expect(directive).not.toContain("translate the full output");
  });

  it("final_report + includeTranslation=true → translation to RU", async () => {
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");

    const directive = buildLanguageDirectiveV2({
      inputDetected: "RU",
      outputEffective: "EN",
      mode: "final_report",
      includeTranslation: true,
      translationLanguage: "RU",
    });

    expect(directive).toContain("--- TRANSLATION ---");
    expect(directive).toContain("translate the full output into Russian (RU)");
  });

  it("final_report + includeTranslation=true → translation to ES", async () => {
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");

    const directive = buildLanguageDirectiveV2({
      inputDetected: "ES",
      outputEffective: "EN",
      mode: "final_report",
      includeTranslation: true,
      translationLanguage: "ES",
    });

    expect(directive).toContain("translate the full output into Spanish (ES)");
  });

  it("backward compat: no policy args → falls back to no-translation for EN input", async () => {
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");

    const directive = buildLanguageDirectiveV2({
      inputDetected: "EN",
      outputEffective: "EN",
      mode: "final_report",
    });

    // Without includeTranslation, defaults to no-translation path
    expect(directive).toContain("English only");
    expect(directive).not.toContain("--- TRANSLATION ---");
  });
});

// ── Output-layer enforcement ───────────────────────────────────────

describe("Output-layer enforcement (simulated)", () => {
  it("strips translation block when includeTranslation is false", () => {
    const SEPARATOR = "--- TRANSLATION ---";
    const text = `English report content.\n\n${SEPARATOR}\n\nRussian translation.`;
    const includeTranslation = false;

    let enforced = text;
    if (!includeTranslation && enforced.includes(SEPARATOR)) {
      enforced = enforced.split(SEPARATOR)[0].trim();
    }

    expect(enforced).toBe("English report content.");
    expect(enforced).not.toContain(SEPARATOR);
    expect(enforced).not.toContain("Russian");
  });

  it("preserves translation block when includeTranslation is true", () => {
    const SEPARATOR = "--- TRANSLATION ---";
    const text = `English report content.\n\n${SEPARATOR}\n\nRussian translation.`;
    const includeTranslation = true;

    let enforced = text;
    if (!includeTranslation && enforced.includes(SEPARATOR)) {
      enforced = enforced.split(SEPARATOR)[0].trim();
    }

    expect(enforced).toContain(SEPARATOR);
    expect(enforced).toContain("Russian translation.");
  });
});

// ── End-to-end policy scenarios ────────────────────────────────────

describe("End-to-end: mode → policy → directive → validation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("EN mode → English-only pipeline", async () => {
    const { resolveLanguagePolicy, detectInputLanguageV2 } = await import("@/lib/lang");
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");

    const input = detectInputLanguageV2("Water pump not working");
    const policy = resolveLanguagePolicy("EN", input.detected);

    // Directive should NOT mention translation
    const directive = buildLanguageDirectiveV2({
      inputDetected: input.detected,
      outputEffective: policy.primaryOutput,
      mode: "final_report",
      includeTranslation: policy.includeTranslation,
      translationLanguage: policy.translationLanguage,
    });
    expect(directive).not.toContain("--- TRANSLATION ---");

    // English-only report should pass validation
    const report = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;
    const validation = validateFinalReportOutput(report, policy.includeTranslation);
    expect(validation.valid).toBe(true);
  });

  it("RU mode → bilingual pipeline", async () => {
    const { resolveLanguagePolicy, detectInputLanguageV2 } = await import("@/lib/lang");
    const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");

    const input = detectInputLanguageV2("Насос не работает");
    const policy = resolveLanguagePolicy("RU", input.detected);

    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("RU");

    // Directive should mention translation
    const directive = buildLanguageDirectiveV2({
      inputDetected: input.detected,
      outputEffective: policy.primaryOutput,
      mode: "final_report",
      includeTranslation: policy.includeTranslation,
      translationLanguage: policy.translationLanguage,
    });
    expect(directive).toContain("translate the full output into Russian");

    // English-only report should FAIL validation
    const englishOnly = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;
    const v1 = validateFinalReportOutput(englishOnly, policy.includeTranslation);
    expect(v1.valid).toBe(false);

    // Bilingual report should pass
    const bilingual = englishOnly + "\n\n--- TRANSLATION ---\n\nНасос не работает. Работа: 1.0 час.";
    const v2 = validateFinalReportOutput(bilingual, policy.includeTranslation, policy.translationLanguage);
    expect(v2.valid).toBe(true);
  });

  it("AUTO + EN input → English-only pipeline", async () => {
    const { resolveLanguagePolicy, detectInputLanguageV2 } = await import("@/lib/lang");
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");

    const input = detectInputLanguageV2("The water pump is not producing flow");
    const policy = resolveLanguagePolicy("AUTO", input.detected);

    expect(input.detected).toBe("EN");
    expect(policy.includeTranslation).toBe(false);

    const report = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;
    const validation = validateFinalReportOutput(report, policy.includeTranslation);
    expect(validation.valid).toBe(true);
  });

  it("AUTO + RU input → bilingual pipeline", async () => {
    const { resolveLanguagePolicy, detectInputLanguageV2 } = await import("@/lib/lang");
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");

    const input = detectInputLanguageV2("Клиент заявляет что насос не работает");
    const policy = resolveLanguagePolicy("AUTO", input.detected);

    expect(input.detected).toBe("RU");
    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("RU");

    const englishOnly = `Complaint: Water pump not operating.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;
    const v = validateFinalReportOutput(englishOnly, policy.includeTranslation);
    expect(v.valid).toBe(false);
  });

  it("ES mode → bilingual pipeline", async () => {
    const { resolveLanguagePolicy, detectInputLanguageV2 } = await import("@/lib/lang");
    const { validateFinalReportOutput } = await import("@/lib/mode-validators");

    const input = detectInputLanguageV2("¿Cómo está el diagnóstico?");
    const policy = resolveLanguagePolicy("ES", input.detected);

    expect(policy.includeTranslation).toBe(true);
    expect(policy.translationLanguage).toBe("ES");

    const bilingual = `Complaint: Water pump not operating.
Diagnostic Procedure: Verified voltage at pump terminals.
Verified Condition: Unit not responding under load.
Recommended Corrective Action: Replace pump.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Water pump assembly.

--- TRANSLATION ---

Queja: La bomba de agua no funciona.
Procedimiento de diagnóstico: Se verificó el voltaje en los terminales de la bomba.
Condición verificada: La unidad no responde bajo carga.
Acción correctiva recomendada: Reemplazar la bomba.
Mano de obra estimada: Total mano de obra: 1.0 hr.
Piezas requeridas: Bomba de agua.`;
    const v = validateFinalReportOutput(bilingual, policy.includeTranslation, policy.translationLanguage);
    expect(v.valid).toBe(true);
  });
});

// ── Prompt files: no hardcoded language enforcement ────────────────

describe("Prompt files: no hardcoded translation enforcement", () => {
  it("SYSTEM_PROMPT_BASE.txt should NOT hardcode 'provide a full literal translation'", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    // Should NOT contain the old hardcoded instruction
    expect(content).not.toContain("provide a full literal translation into the dialogue language");
    // Should delegate to the LANGUAGE DIRECTIVE
    expect(content).toContain("LANGUAGE DIRECTIVE");
  });

  it("MODE_PROMPT_FINAL_REPORT.txt should conditionally reference translation", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/modes/MODE_PROMPT_FINAL_REPORT.txt"), "utf-8");

    // Should reference LANGUAGE DIRECTIVE for translation decision
    expect(content).toContain("LANGUAGE DIRECTIVE");
    // Should still contain the separator in the examples
    expect(content).toContain("--- TRANSLATION ---");
  });
});
