import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Payload v2: Input Language Detection + Output Policy
 * 
 * Ensures:
 * - Input language is always detected from message text (independent of selector)
 * - Output policy respects AUTO vs forced modes
 * - Composer uses inputDetected vs outputEffective correctly
 */

describe("Payload v2: Language Detection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("detectInputLanguageV2", () => {
    it("should detect Russian from Cyrillic text", async () => {
      const { detectInputLanguageV2 } = await import("@/lib/lang");
      
      const result = detectInputLanguageV2("Клиент заявляет что водный насос не работает");

      expect(result.detected).toBe("RU");
      expect(result.source).toBe("server");
      expect(result.reason).toBe("heuristic-cyrillic");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should detect Spanish from Spanish markers", async () => {
      const { detectInputLanguageV2 } = await import("@/lib/lang");
      
      const result = detectInputLanguageV2("¿Cómo está el diagnóstico del motor?");

      expect(result.detected).toBe("ES");
      expect(result.source).toBe("server");
      expect(result.reason).toBe("heuristic-spanish-markers");
    });

    it("should default to English for plain text", async () => {
      const { detectInputLanguageV2 } = await import("@/lib/lang");
      
      const result = detectInputLanguageV2("The water pump is not working");

      expect(result.detected).toBe("EN");
      expect(result.source).toBe("server");
      expect(result.reason).toBe("heuristic-default");
    });

    it("should return server as source", async () => {
      const { detectInputLanguageV2 } = await import("@/lib/lang");
      
      const result = detectInputLanguageV2("any text");

      expect(result.source).toBe("server");
    });
  });

  describe("computeOutputPolicy", () => {
    it("should follow detected language in AUTO mode", async () => {
      const { computeOutputPolicy } = await import("@/lib/lang");
      
      const policy = computeOutputPolicy("AUTO", "RU");

      expect(policy.mode).toBe("AUTO");
      expect(policy.effective).toBe("RU"); // Follows detected
      expect(policy.strategy).toBe("auto");
    });

    it("should use forced language when mode is explicit", async () => {
      const { computeOutputPolicy } = await import("@/lib/lang");
      
      // User selected ES, but input was detected as RU
      const policy = computeOutputPolicy("ES", "RU");

      expect(policy.mode).toBe("ES");
      expect(policy.effective).toBe("ES"); // Forced to ES
      expect(policy.strategy).toBe("forced");
    });

    it("should handle EN forced mode", async () => {
      const { computeOutputPolicy } = await import("@/lib/lang");
      
      // User selected EN, but input was detected as RU
      const policy = computeOutputPolicy("EN", "RU");

      expect(policy.mode).toBe("EN");
      expect(policy.effective).toBe("EN"); // Forced to EN
      expect(policy.strategy).toBe("forced");
    });

    it("should handle RU forced mode with EN input", async () => {
      const { computeOutputPolicy } = await import("@/lib/lang");
      
      // User selected RU, but input was detected as EN
      const policy = computeOutputPolicy("RU", "EN");

      expect(policy.mode).toBe("RU");
      expect(policy.effective).toBe("RU"); // Forced to RU
      expect(policy.strategy).toBe("forced");
    });
  });
});

describe("Payload v2: Prompt Composer", () => {
  describe("buildLanguageDirectiveV2", () => {
    it("should show both input and output languages in diagnostic mode", async () => {
      const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirectiveV2({
        inputDetected: "EN",
        outputEffective: "RU",
        mode: "diagnostic",
      });

      expect(directive).toContain("Technician input language: EN");
      expect(directive).toContain("All dialogue MUST be in Russian (RU)");
    });

    it("should use detected language for final report translation", async () => {
      const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");
      
      // Input is Russian, output is forced to EN
      // Translation should be to Russian (detected input)
      const directive = buildLanguageDirectiveV2({
        inputDetected: "RU",
        outputEffective: "EN",
        mode: "final_report",
      });

      expect(directive).toContain("Technician input language: RU");
      expect(directive).toContain("translate the full output into Russian (RU)");
    });

    it("should distinguish input and output in directive", async () => {
      const { buildLanguageDirectiveV2 } = await import("@/lib/prompt-composer");
      
      // User writes in Russian, but forces Spanish output
      const directive = buildLanguageDirectiveV2({
        inputDetected: "RU",
        outputEffective: "ES",
        mode: "authorization",
      });

      expect(directive).toContain("Technician input language: RU (Russian)");
      expect(directive).toContain("All dialogue MUST be in Spanish (ES)");
    });
  });

  describe("composePromptV2", () => {
    it("should include v2 language directive", async () => {
      const { composePromptV2 } = await import("@/lib/prompt-composer");
      
      const prompt = composePromptV2({
        mode: "diagnostic",
        inputDetected: "RU",
        outputEffective: "RU",
      });

      expect(prompt).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(prompt).toContain("Technician input language: RU");
      expect(prompt).toContain("All dialogue MUST be in Russian");
    });

    it("should handle forced output different from input", async () => {
      const { composePromptV2 } = await import("@/lib/prompt-composer");
      
      const prompt = composePromptV2({
        mode: "diagnostic",
        inputDetected: "EN",
        outputEffective: "RU",
      });

      expect(prompt).toContain("Technician input language: EN");
      expect(prompt).toContain("All dialogue MUST be in Russian (RU)");
    });
  });
});

describe("Payload v2: End-to-End Scenarios", () => {
  describe("Scenario 1: AUTO + Russian message", () => {
    it("should detect RU and output RU", async () => {
      const { detectInputLanguageV2, computeOutputPolicy } = await import("@/lib/lang");
      
      const message = "Клиент заявляет что водный насос не работает";
      const inputLang = detectInputLanguageV2(message);
      const outputPolicy = computeOutputPolicy("AUTO", inputLang.detected);

      expect(inputLang.detected).toBe("RU");
      expect(outputPolicy.effective).toBe("RU");
      expect(outputPolicy.strategy).toBe("auto");
    });
  });

  describe("Scenario 2: RU forced + English message", () => {
    it("should detect EN but output RU", async () => {
      const { detectInputLanguageV2, computeOutputPolicy } = await import("@/lib/lang");
      
      const message = "Water pump not working";
      const inputLang = detectInputLanguageV2(message);
      const outputPolicy = computeOutputPolicy("RU", inputLang.detected);

      expect(inputLang.detected).toBe("EN");
      expect(outputPolicy.effective).toBe("RU");
      expect(outputPolicy.strategy).toBe("forced");
    });
  });

  describe("Scenario 3: ES forced + Russian message", () => {
    it("should detect RU but output ES", async () => {
      const { detectInputLanguageV2, computeOutputPolicy } = await import("@/lib/lang");
      
      const message = "Насос не работает";
      const inputLang = detectInputLanguageV2(message);
      const outputPolicy = computeOutputPolicy("ES", inputLang.detected);

      expect(inputLang.detected).toBe("RU");
      expect(outputPolicy.effective).toBe("ES");
      expect(outputPolicy.strategy).toBe("forced");
    });
  });

  describe("Scenario 4: Final report translation language", () => {
    it("should translate to detected input language, not forced output", async () => {
      const { detectInputLanguageV2, computeOutputPolicy, buildLanguageDirectiveV2 } = await import("@/lib/lang");
      const { buildLanguageDirectiveV2: composerDirective } = await import("@/lib/prompt-composer");
      
      // User writes in Russian, forces EN output
      const message = "Насос проверен и не работает";
      const inputLang = detectInputLanguageV2(message);
      const outputPolicy = computeOutputPolicy("EN", inputLang.detected);

      expect(inputLang.detected).toBe("RU");
      expect(outputPolicy.effective).toBe("EN");

      // Final report should translate to Russian (what user reads)
      const directive = composerDirective({
        inputDetected: inputLang.detected,
        outputEffective: outputPolicy.effective,
        mode: "final_report",
      });

      expect(directive).toContain("translate the full output into Russian (RU)");
    });
  });
});

describe("Payload v2: Fallback Language", () => {
  it("should use outputEffective for fallback, not inputDetected", async () => {
    const { detectInputLanguageV2, computeOutputPolicy } = await import("@/lib/lang");
    const { getSafeFallback } = await import("@/lib/mode-validators");
    
    // User writes in English, forces Russian output
    const message = "Water pump issue";
    const inputLang = detectInputLanguageV2(message);
    const outputPolicy = computeOutputPolicy("RU", inputLang.detected);

    expect(inputLang.detected).toBe("EN");
    expect(outputPolicy.effective).toBe("RU");

    // Fallback should be in Russian (the forced output language)
    const fallback = getSafeFallback("diagnostic", outputPolicy.effective);
    expect(fallback).toBe("Можете предоставить больше информации о проблеме?");
  });

  it("should use detected language for AUTO mode fallback", async () => {
    const { detectInputLanguageV2, computeOutputPolicy } = await import("@/lib/lang");
    const { getSafeFallback } = await import("@/lib/mode-validators");
    
    // User writes in Russian, AUTO mode
    const message = "Насос не работает";
    const inputLang = detectInputLanguageV2(message);
    const outputPolicy = computeOutputPolicy("AUTO", inputLang.detected);

    expect(inputLang.detected).toBe("RU");
    expect(outputPolicy.effective).toBe("RU");

    // Fallback should be in Russian
    const fallback = getSafeFallback("diagnostic", outputPolicy.effective);
    expect(fallback).toBe("Можете предоставить больше информации о проблеме?");
  });
});
