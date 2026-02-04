import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for input language lock functionality
 * 
 * Ensures:
 * - Auto-detection works for Russian/Spanish/English
 * - Explicit selection overrides case language
 * - Language is locked per case in AUTO mode
 * - Composer includes hard language directive
 */

describe("Input Language Lock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("Language Detection (AUTO mode)", () => {
    it("should detect Russian from Cyrillic text", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "Клиент заявляет что водный насос не работает",
        "AUTO"
      );

      expect(result.language).toBe("RU");
      expect(result.languageSource).toBe("AUTO");
    });

    it("should detect Spanish from Spanish markers", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "¿Cómo funciona la bomba de agua?",
        "AUTO"
      );

      expect(result.language).toBe("ES");
    });

    it("should default to English for non-Cyrillic/non-Spanish text", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "The water pump is not working",
        "AUTO"
      );

      expect(result.language).toBe("EN");
    });
  });

  describe("Explicit Language Override", () => {
    it("should use explicit RU when selected", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "The water pump is not working", // English text
        "RU" // But user selected Russian
      );

      expect(result.language).toBe("RU");
      expect(result.languageSource).toBe("MANUAL");
    });

    it("should use explicit ES when selected", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "Водяной насос не работает", // Russian text
        "ES" // But user selected Spanish
      );

      expect(result.language).toBe("ES");
      expect(result.languageSource).toBe("MANUAL");
    });

    it("should use explicit EN when selected", async () => {
      const { storage } = await import("@/lib/storage");
      
      const result = storage.inferLanguageForMessage(
        "Насос не работает", // Russian text
        "EN" // But user selected English
      );

      expect(result.language).toBe("EN");
      expect(result.languageSource).toBe("MANUAL");
    });
  });

  describe("Language Directive in Composer", () => {
    it("should include MANDATORY directive for diagnostic mode", async () => {
      const { composePrompt, buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "RU", mode: "diagnostic" });
      
      expect(directive).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(directive).toContain("RU (Russian)");
      expect(directive).toContain("All dialogue MUST be in Russian");
      expect(directive).toContain("Do not respond in any other language");
    });

    it("should include translation directive for final_report mode", async () => {
      const { buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "RU", mode: "final_report" });
      
      expect(directive).toContain("Final output MUST be English first");
      expect(directive).toContain("--- TRANSLATION ---");
      expect(directive).toContain("Russian (RU)");
      expect(directive).toContain("translation must be complete and literal");
    });

    it("should include directive in composed prompt", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");
      
      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "RU",
      });

      expect(prompt).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(prompt).toContain("All dialogue MUST be in Russian");
    });

    it("should NOT include other languages in RU diagnostic directive", async () => {
      const { buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "RU", mode: "diagnostic" });
      
      // Should not mention Spanish
      expect(directive.toLowerCase()).not.toContain("spanish");
      expect(directive.toLowerCase()).not.toContain("español");
    });
  });

  describe("Language Lock Logic", () => {
    it("should preserve case language in AUTO mode", () => {
      // Simulate the language lock logic from chat API
      const languageMode = "AUTO";
      const caseInputLanguage = "RU"; // Case already has RU
      const detectedLanguage = "ES"; // New message looks Spanish
      
      // In AUTO mode, use case's locked language if it exists
      const effectiveLanguage = languageMode !== "AUTO" 
        ? languageMode 
        : (caseInputLanguage || detectedLanguage);
      
      expect(effectiveLanguage).toBe("RU"); // Should use locked RU, not detected ES
    });

    it("should override case language when explicit selection", () => {
      const languageMode = "EN"; // User selected English
      const caseInputLanguage = "RU"; // Case was Russian
      
      // Explicit selection always overrides
      const effectiveLanguage = languageMode !== "AUTO" 
        ? languageMode 
        : caseInputLanguage;
      
      expect(effectiveLanguage).toBe("EN"); // Should override to EN
    });

    it("should use detected language for new case in AUTO mode", () => {
      const languageMode = "AUTO";
      const caseInputLanguage = undefined; // New case, no language yet
      const detectedLanguage = "RU";
      
      const effectiveLanguage = languageMode !== "AUTO" 
        ? languageMode 
        : (caseInputLanguage || detectedLanguage);
      
      expect(effectiveLanguage).toBe("RU"); // Should use detected
    });
  });

  describe("Final Report Translation", () => {
    it("should specify RU translation for RU input language", async () => {
      const { buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "RU", mode: "final_report" });
      
      expect(directive).toContain("translate the full output into Russian (RU)");
    });

    it("should specify ES translation for ES input language", async () => {
      const { buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "ES", mode: "final_report" });
      
      expect(directive).toContain("translate the full output into Spanish (ES)");
    });

    it("should specify EN translation for EN input language", async () => {
      const { buildLanguageDirective } = await import("@/lib/prompt-composer");
      
      const directive = buildLanguageDirective({ inputLanguage: "EN", mode: "final_report" });
      
      // For English, still needs translation block (but will be same language)
      expect(directive).toContain("translate the full output into English (EN)");
    });
  });
});

describe("Language Detection Edge Cases", () => {
  it("should detect Russian with mixed characters", async () => {
    const { detectLanguage } = await import("@/lib/lang");
    
    // Message with both Cyrillic and Latin
    const result = detectLanguage("Pump не работает, check voltage");
    
    expect(result.language).toBe("RU"); // Cyrillic presence should trigger RU
  });

  it("should detect Spanish inverted question mark", async () => {
    const { detectLanguage } = await import("@/lib/lang");
    
    const result = detectLanguage("¿Funciona?");
    
    expect(result.language).toBe("ES");
  });

  it("should detect Spanish ñ character", async () => {
    const { detectLanguage } = await import("@/lib/lang");
    
    const result = detectLanguage("El niño está bien");
    
    expect(result.language).toBe("ES");
  });
});
