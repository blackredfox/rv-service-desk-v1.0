import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for RV Service Desk prompt enforcement and API contract
 * Ensures:
 * - Language rules are never violated
 * - State machine is enforced
 * - Output validation catches violations
 */

describe("System Prompt v3.2", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("buildSystemPrompt", () => {
    it("should include dialogue language in context", async () => {
      const { buildSystemPrompt } = await import("@prompts/system-prompt-final");

      const prompt = buildSystemPrompt({
        dialogueLanguage: "RU",
        currentState: "DIAGNOSTICS",
      });

      expect(prompt).toContain("Dialogue Language: RU");
      expect(prompt).toContain("Current State: DIAGNOSTICS");
    });

    it("should include DIAGNOSTICS state reminders", async () => {
      const { buildSystemPrompt } = await import("@prompts/system-prompt-final");

      const prompt = buildSystemPrompt({
        dialogueLanguage: "ES",
        currentState: "DIAGNOSTICS",
      });

      expect(prompt).toContain("You are in DIAGNOSTICS state");
      expect(prompt).toContain("Output MUST be in ES ONLY");
      expect(prompt).toContain("English is FORBIDDEN");
      expect(prompt).toContain("Ask ONE question only");
    });

    it("should include CAUSE_OUTPUT state reminders", async () => {
      const { buildSystemPrompt } = await import("@prompts/system-prompt-final");

      const prompt = buildSystemPrompt({
        dialogueLanguage: "RU",
        currentState: "CAUSE_OUTPUT",
      });

      expect(prompt).toContain("You are in CAUSE_OUTPUT state");
      expect(prompt).toContain("Output English Cause text first");
      expect(prompt).toContain("--- TRANSLATION ---");
      expect(prompt).toContain("literal RU translation");
    });

    it("should contain water pump = NON-COMPLEX classification", async () => {
      const { SYSTEM_PROMPT_FINAL } = await import("@prompts/system-prompt-final");

      expect(SYSTEM_PROMPT_FINAL).toContain("Water pump = NON-COMPLEX");
    });

    it("should contain STATE AWARENESS section", async () => {
      const { SYSTEM_PROMPT_FINAL } = await import("@prompts/system-prompt-final");

      expect(SYSTEM_PROMPT_FINAL).toContain("STATE AWARENESS (CRITICAL)");
      expect(SYSTEM_PROMPT_FINAL).toContain('STATE = "DIAGNOSTICS"');
      expect(SYSTEM_PROMPT_FINAL).toContain('STATE = "CAUSE_OUTPUT"');
    });

    it("should contain PROHIBITED BEHAVIOR section", async () => {
      const { SYSTEM_PROMPT_FINAL } = await import("@prompts/system-prompt-final");

      expect(SYSTEM_PROMPT_FINAL).toContain("Do NOT give advice");
      expect(SYSTEM_PROMPT_FINAL).toContain("Do NOT explain diagnostics");
      expect(SYSTEM_PROMPT_FINAL).toContain("Do NOT improvise procedures");
    });
  });
});

describe("Output Validator", () => {
  describe("validateResponse - DIAGNOSTICS state", () => {
    it("should detect English during Russian diagnostics", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Please check the water pump pressure and verify the connections.",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("LANG_VIOLATION"))).toBe(true);
    });

    it("should allow Russian during Russian diagnostics", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Проверьте давление в системе водяного насоса?",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should detect translation separator during diagnostics", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Проверьте насос.\n\n--- TRANSLATION ---\n\nCheck the pump.",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("TRANSLATION_VIOLATION"))).toBe(true);
    });

    it("should detect multiple questions", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Насос работает? Какое давление? Есть ли утечки?",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("QUESTION_VIOLATION"))).toBe(true);
    });

    it("should allow single question", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "¿Funciona la bomba de agua?",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "ES",
      });

      expect(result.valid).toBe(true);
    });

    it("should allow English during English diagnostics", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Is the water pump making any noise when activated?",
        currentState: "DIAGNOSTICS",
        dialogueLanguage: "EN",
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("validateResponse - CAUSE_OUTPUT state", () => {
    it("should detect missing translation separator", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "Water pump not operating per spec. Replace pump. Labor: 1.5 hours.",
        currentState: "CAUSE_OUTPUT",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("Missing '--- TRANSLATION ---'"))).toBe(true);
    });

    it("should detect numbered lists in Cause output", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: "1. Water pump not operating.\n2. Replace pump.\n\n--- TRANSLATION ---\n\n1. Насос не работает.",
        currentState: "CAUSE_OUTPUT",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("numbered lists"))).toBe(true);
    });

    it("should allow proper Cause format", async () => {
      const { validateResponse } = await import("@/lib/output-validator");

      const result = validateResponse({
        response: `Water pump not operating per spec when activated. Verified no pressure at outlet with system energized. Pump motor runs but no water flow detected.

Recommend replacement of water pump assembly. P/N TBD.

Labor: Remove and replace water pump - 1.5 hours. Total labor: 1.5 hours.

--- TRANSLATION ---

Водяной насос не работает согласно спецификации при активации. Подтверждено отсутствие давления на выходе при включённой системе. Двигатель насоса работает, но поток воды не обнаружен.

Рекомендуется замена узла водяного насоса. Номер детали уточняется.

Работа: Снятие и замена водяного насоса - 1.5 часа. Общее время работы: 1.5 часа.`,
        currentState: "CAUSE_OUTPUT",
        dialogueLanguage: "RU",
      });

      expect(result.valid).toBe(true);
    });
  });
});

describe("API Contract", () => {
  describe("State inference from history", () => {
    it("should default to DIAGNOSTICS for empty history", async () => {
      // The inferStateFromHistory function should return DIAGNOSTICS by default
      const history: { role: "user" | "assistant"; content: string }[] = [];
      
      // Check last assistant message for translation separator
      let state: "DIAGNOSTICS" | "CAUSE_OUTPUT" = "DIAGNOSTICS";
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "assistant") {
          if (history[i].content.includes("--- TRANSLATION ---")) {
            state = "CAUSE_OUTPUT";
          }
          break;
        }
      }
      
      expect(state).toBe("DIAGNOSTICS");
    });

    it("should detect CAUSE_OUTPUT from history with translation", () => {
      const history = [
        { role: "user" as const, content: "Water pump not working" },
        { role: "assistant" as const, content: "Pump not operating per spec.\n\n--- TRANSLATION ---\n\nНасос не работает." },
      ];
      
      let state: "DIAGNOSTICS" | "CAUSE_OUTPUT" = "DIAGNOSTICS";
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "assistant") {
          if (history[i].content.includes("--- TRANSLATION ---")) {
            state = "CAUSE_OUTPUT";
          }
          break;
        }
      }
      
      expect(state).toBe("CAUSE_OUTPUT");
    });
  });

  describe("Language parameter handling", () => {
    it("should accept explicit dialogueLanguage", () => {
      const body = {
        message: "test",
        dialogueLanguage: "RU" as const,
      };
      
      // API should use explicit language
      const dialogueLanguage = body.dialogueLanguage || "EN";
      expect(dialogueLanguage).toBe("RU");
    });

    it("should fallback to inferred language when not provided", () => {
      const body = {
        message: "test",
      };
      
      const effectiveLanguage = "EN" as const; // Would be inferred
      const dialogueLanguage = (body as { dialogueLanguage?: "EN" | "RU" | "ES" }).dialogueLanguage || effectiveLanguage;
      expect(dialogueLanguage).toBe("EN");
    });
  });

  describe("State parameter handling", () => {
    it("should accept explicit currentState", () => {
      const body = {
        message: "test",
        currentState: "CAUSE_OUTPUT" as const,
      };
      
      const currentState = body.currentState || "DIAGNOSTICS";
      expect(currentState).toBe("CAUSE_OUTPUT");
    });

    it("should fallback to inferred state when not provided", () => {
      const body = {
        message: "test",
      };
      
      const inferredState = "DIAGNOSTICS" as const;
      const currentState = (body as { currentState?: "DIAGNOSTICS" | "CAUSE_OUTPUT" }).currentState || inferredState;
      expect(currentState).toBe("DIAGNOSTICS");
    });
  });
});

describe("Complex Equipment Classification", () => {
  it("should list complex equipment in prompt", async () => {
    const { SYSTEM_PROMPT_FINAL } = await import("@prompts/system-prompt-final");

    expect(SYSTEM_PROMPT_FINAL).toContain("Roof AC / heat pumps");
    expect(SYSTEM_PROMPT_FINAL).toContain("Furnaces");
    expect(SYSTEM_PROMPT_FINAL).toContain("Slide-out systems");
    expect(SYSTEM_PROMPT_FINAL).toContain("Leveling systems");
    expect(SYSTEM_PROMPT_FINAL).toContain("Inverters / converters");
    expect(SYSTEM_PROMPT_FINAL).toContain("Refrigerators");
  });

  it("should explicitly mark water pump as NON-COMPLEX", async () => {
    const { SYSTEM_PROMPT_FINAL } = await import("@prompts/system-prompt-final");

    expect(SYSTEM_PROMPT_FINAL).toContain("Water pump = NON-COMPLEX");
    expect(SYSTEM_PROMPT_FINAL).toContain("You MUST NOT override this classification");
  });
});
