import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for RV Service Desk Mode Validators
 * Ensures:
 * - Diagnostic mode blocks final report generation
 * - Final report requires format compliance
 * - Prohibited words are caught
 * - Safe fallbacks work
 */

describe("Mode Validators", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("validateDiagnosticOutput", () => {
    it("should pass valid diagnostic question", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput("¿El motor del sistema se activa cuando aplica voltaje directo?");

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should detect output that looks like final report", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const finalReportLike = `
        Observed symptoms indicate pump malfunction.
        Diagnostic checks performed verified no output.
        Verified condition shows motor not operating per spec.
        Recommended replacement of water pump.
        Labor: Remove and replace pump - 2.0 hours. Total labor: 2.0 hours.
      `;

      const result = validateDiagnosticOutput(finalReportLike);

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_DRIFT"))).toBe(true);
    });

    it("should detect translation separator in diagnostic mode", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput("Check the pump.\n\n--- TRANSLATION ---\n\nПроверьте насос.");

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("translation separator"))).toBe(true);
    });

    it("should detect multiple questions", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput("Is the pump running? Does it make noise? What is the voltage?");

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_QUESTION"))).toBe(true);
    });

    it("should detect prohibited words", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput("Is the water pump broken?");

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("PROHIBITED_WORDS"))).toBe(true);
      expect(result.violations.some(v => v.includes("broken"))).toBe(true);
    });

    it("should detect no question in output", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput("Please check the pump voltage.");

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("does not contain a question"))).toBe(true);
    });
  });

  describe("validateAuthorizationOutput", () => {
    it("should pass valid authorization text", async () => {
      const { validateAuthorizationOutput } = await import("@/lib/mode-validators");

      const result = validateAuthorizationOutput(
        "Request authorization for corrective action: Replace water pump assembly. P/N to be determined. Estimated labor: 1.5 hours."
      );

      expect(result.valid).toBe(true);
    });

    it("should detect prohibited words in authorization", async () => {
      const { validateAuthorizationOutput } = await import("@/lib/mode-validators");

      const result = validateAuthorizationOutput(
        "The water pump has failed and needs replacement."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("PROHIBITED_WORDS"))).toBe(true);
      expect(result.violations.some(v => v.includes("failed"))).toBe(true);
    });

    it("should detect translation separator in authorization mode", async () => {
      const { validateAuthorizationOutput } = await import("@/lib/mode-validators");

      const result = validateAuthorizationOutput(
        "Replace pump.\n\n--- TRANSLATION ---\n\nЗаменить насос."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("AUTHORIZATION_DRIFT"))).toBe(true);
    });
  });

  describe("validateFinalReportOutput", () => {
    it("should pass valid final report", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const validReport = `Complaint: Water pump not providing flow when faucets open.
Diagnostic Procedure: Verified 12V DC at pump terminals under demand. Confirmed ground continuity and no response under load.
Verified Condition: Pump receives proper power and ground but does not operate; unit-level malfunction confirmed.
Recommended Corrective Action: Replace water pump assembly.
Estimated Labor: Remove and replace pump - 1.0 hr. System prime and leak check - 0.5 hr. Total labor: 1.5 hr.
Required Parts: Water pump assembly, inlet/outlet hose clamps.

--- TRANSLATION ---

Жалоба: Водяной насос не даёт поток воды при открытии крана.
Диагностическая процедура: Подтверждено 12 В DC на клеммах насоса под нагрузкой. Проверена масса, реакции под нагрузкой нет.
Подтверждённое состояние: Насос получает питание и массу, но не работает; подтверждена неисправность узла.
Рекомендованное корректирующее действие: Заменить узел водяного насоса.
Оценка трудоёмкости: Снятие и замена насоса — 1.0 ч. Прокачка системы и проверка на утечки — 0.5 ч. Общее время: 1.5 ч.
Требуемые детали: Узел водяного насоса, хомуты на вход/выход.`;

      const result = validateFinalReportOutput(validReport);

      expect(result.valid).toBe(true);
    });

    it("should detect missing translation separator", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "Complaint: Water pump not operating.\nDiagnostic Procedure: Verified 12V present.\nVerified Condition: Unit not responding under load.\nRecommended Corrective Action: Replace pump.\nEstimated Labor: Total labor: 2.0 hr.\nRequired Parts: Water pump assembly."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("Missing '--- TRANSLATION ---'"))).toBe(true);
    });

    it("should detect missing section header", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "Complaint: Water pump not operating.\nDiagnostic Procedure: Verified 12V present.\nVerified Condition: Unit not responding.\nRecommended Corrective Action: Replace pump.\nEstimated Labor: Total labor: 1.0 hr.\n\n--- TRANSLATION ---\n\nЖалоба: Насос не работает."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("Missing section header"))).toBe(true);
    });

    it("should detect prohibited words in English section", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "Complaint: Water pump has failed and is broken.\nDiagnostic Procedure: Verified 12V present.\nVerified Condition: Unit does not respond under load.\nRecommended Corrective Action: Replace pump.\nEstimated Labor: Total labor: 2.0 hr.\nRequired Parts: Water pump assembly.\n\n--- TRANSLATION ---\n\nЖалоба: Насос не работает."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("PROHIBITED_WORDS"))).toBe(true);
    });

    it("should detect numbered lists", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "Complaint: 1. Water pump issue\nDiagnostic Procedure: 2. Checked voltage\nVerified Condition: Unit not responding.\nRecommended Corrective Action: Replace pump.\nEstimated Labor: Total labor: 2.0 hr.\nRequired Parts: Water pump assembly.\n\n--- TRANSLATION ---\n\n1. Проблема"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("numbered lists"))).toBe(true);
    });
  });

  describe("validateOutput dispatcher", () => {
    it("should dispatch to correct validator based on mode", async () => {
      const { validateOutput } = await import("@/lib/mode-validators");

      // Diagnostic mode
      const diagnosticResult = validateOutput("Is the pump working?", "diagnostic");
      expect(diagnosticResult.valid).toBe(true);

      // Authorization mode
      const authResult = validateOutput("Request authorization for repair.", "authorization");
      expect(authResult.valid).toBe(true);

      // Final report mode (missing translation)
      const reportResult = validateOutput(
        "Complaint: Water pump not operating.\nDiagnostic Procedure: Verified 12V present.\nVerified Condition: Unit not responding.\nRecommended Corrective Action: Replace pump.\nEstimated Labor: Total labor: 2.0 hr.\nRequired Parts: Water pump assembly.",
        "final_report"
      );
      expect(reportResult.valid).toBe(false);
    });

    it("should reject empty output", async () => {
      const { validateOutput } = await import("@/lib/mode-validators");

      const result = validateOutput("", "diagnostic");
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("EMPTY_OUTPUT"))).toBe(true);
    });
  });

  describe("Safe Fallbacks (Localized)", () => {
    it("should return English fallback for EN language", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallback = getSafeFallback("diagnostic", "EN");
      expect(fallback).toBe("Can you provide more information about the issue?");
    });

    it("should return Russian fallback for RU language", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallback = getSafeFallback("diagnostic", "RU");
      expect(fallback).toBe("Можете предоставить больше информации о проблеме?");
      // Must NOT be Spanish
      expect(fallback).not.toContain("información");
      expect(fallback).not.toContain("problema");
    });

    it("should return Spanish fallback for ES language", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallback = getSafeFallback("diagnostic", "ES");
      expect(fallback).toBe("¿Puede proporcionar más información sobre el problema?");
    });

    it("should return localized authorization fallback", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallbackEN = getSafeFallback("authorization", "EN");
      expect(fallbackEN).toContain("Information not provided");

      const fallbackRU = getSafeFallback("authorization", "RU");
      expect(fallbackRU).toContain("Информация не предоставлена");

      const fallbackES = getSafeFallback("authorization", "ES");
      expect(fallbackES).toContain("Información no proporcionada");
    });

    it("should return localized final report fallback", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallbackEN = getSafeFallback("final_report", "EN");
      expect(fallbackEN).toContain("Unable to generate compliant report");

      const fallbackRU = getSafeFallback("final_report", "RU");
      expect(fallbackRU).toContain("Невозможно сгенерировать");
    });

    it("should default to EN for unknown/undefined language", async () => {
      const { getSafeFallback } = await import("@/lib/mode-validators");

      const fallback1 = getSafeFallback("diagnostic", undefined);
      expect(fallback1).toBe("Can you provide more information about the issue?");

      const fallback2 = getSafeFallback("diagnostic", "AUTO");
      expect(fallback2).toBe("Can you provide more information about the issue?");

      const fallback3 = getSafeFallback("diagnostic", "XX");
      expect(fallback3).toBe("Can you provide more information about the issue?");
    });
  });

  describe("Correction Instruction Builder", () => {
    it("should build correction instruction from violations", async () => {
      const { buildCorrectionInstruction } = await import("@/lib/mode-validators");

      const violations = [
        "PROHIBITED_WORDS: Contains denial-trigger words: broken",
        "DIAGNOSTIC_QUESTION: Output contains 3 questions (should be 1)",
      ];

      const instruction = buildCorrectionInstruction(violations);

      expect(instruction).toContain("Your previous output violated");
      expect(instruction).toContain("PROHIBITED_WORDS");
      expect(instruction).toContain("DIAGNOSTIC_QUESTION");
      expect(instruction).toContain("Produce a compliant output now");
    });
  });
});

describe("Mode Transition Tests", () => {
  describe("Explicit command transitions", () => {
    it("should only transition on explicit alias matches", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");

      // These should NOT trigger transitions
      expect(detectModeCommand("I think we should finalize the report")).toBeNull();
      expect(detectModeCommand("Please authorize the repair")).toBeNull();
      expect(detectModeCommand("Generate the final cause text")).toBeNull();
      expect(detectModeCommand("reporting voltage at converter")).toBeNull();

      // Explicit aliases should work
      expect(detectModeCommand("FINAL REPORT")).toBe("final_report");
      expect(detectModeCommand("GIVE ME THE REPORT")).toBe("final_report");
      expect(detectModeCommand("ВЫДАЙ РЕПОРТ")).toBe("final_report");
      expect(detectModeCommand("AUTHORIZATION REQUEST")).toBe("authorization");
      expect(detectModeCommand("SOLICITAR AUTORIZACIÓN")).toBe("authorization");
    });

    it("should be case-insensitive for aliases", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");

      expect(detectModeCommand("start final report")).toBe("final_report");
      expect(detectModeCommand("preautorización")).toBe("authorization");
    });
  });

  describe("Diagnostic mode blocks final report", () => {
    it("should fail validation if final report content in diagnostic mode", async () => {
      const { validateOutput } = await import("@/lib/mode-validators");

      const finalReportContent = `
        Water pump not operating per spec.
        Diagnostic checks verified no output.
        Verified condition: pump not working.
        Recommend replacement.
        Labor: 2 hours. Total labor: 2 hours.
      `;

      const result = validateOutput(finalReportContent, "diagnostic");

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_DRIFT"))).toBe(true);
    });
  });
});

describe("Prohibited Words Detection", () => {
  it("should catch all prohibited words", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    const prohibitedWords = [
      "broken", "failed", "defective", "bad", 
      "damaged", "worn", "misadjusted", "leaking"
    ];

    for (const word of prohibitedWords) {
      const result = validateDiagnosticOutput(`Is the component ${word}?`);
      expect(result.violations.some(v => v.includes("PROHIBITED_WORDS"))).toBe(true);
      expect(result.violations.some(v => v.includes(word))).toBe(true);
    }
  });

  it("should be case-insensitive for prohibited words", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    const result1 = validateDiagnosticOutput("Is it BROKEN?");
    const result2 = validateDiagnosticOutput("Is it Broken?");
    const result3 = validateDiagnosticOutput("Is it broken?");

    expect(result1.violations.some(v => v.includes("broken"))).toBe(true);
    expect(result2.violations.some(v => v.includes("broken"))).toBe(true);
    expect(result3.violations.some(v => v.includes("broken"))).toBe(true);
  });

  it("should match whole words only", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    // "worn" should be detected
    const result1 = validateDiagnosticOutput("Is the part worn?");
    expect(result1.violations.some(v => v.includes("worn"))).toBe(true);

    // "warning" contains "worn" but should not be flagged
    const result2 = validateDiagnosticOutput("Is there a warning light?");
    expect(result2.violations.some(v => v.includes("worn"))).toBe(false);
  });
});
