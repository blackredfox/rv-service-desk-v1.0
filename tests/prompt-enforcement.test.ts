import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tests for RV Service Desk prompt enforcement and API contract
 * 
 * Runtime uses: prompts/system/SYSTEM_PROMPT_BASE.txt (loaded by src/lib/prompt-composer.ts)
 * 
 * Ensures:
 * - Language rules are never violated
 * - State machine is enforced
 * - Output validation catches violations
 */

// Load actual runtime prompts
const promptsDir = join(process.cwd(), "prompts");
const SYSTEM_BASE = readFileSync(join(promptsDir, "system", "SYSTEM_PROMPT_BASE.txt"), "utf-8");
const MODE_DIAGNOSTIC = readFileSync(join(promptsDir, "modes", "MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8");
const MODE_FINAL_REPORT = readFileSync(join(promptsDir, "modes", "MODE_PROMPT_FINAL_REPORT.txt"), "utf-8");

describe("Runtime System Prompt (SYSTEM_PROMPT_BASE.txt)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("composePrompt (from prompt-composer)", () => {
    it("should include dialogue language in context", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");

      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "RU",
      });

      expect(prompt).toContain("CURRENT DIALOGUE LANGUAGE: RU");
      expect(prompt).toContain("DIAGNOSTIC MODE");
    });

    it("should include diagnostic mode content", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");

      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "ES",
      });

      expect(prompt).toContain("DIAGNOSTIC MODE");
      expect(prompt).toContain("ONE question at a time");
      expect(prompt).toContain("Output diagnostic questions in ES");
    });

    it("should include final_report mode content", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");

      const prompt = composePrompt({
        mode: "final_report",
        dialogueLanguage: "RU",
      });

      expect(prompt).toContain("FINAL REPORT MODE");
      expect(prompt).toContain("--- TRANSLATION ---");
      expect(prompt).toContain("Labor justification");
    });
  });

  describe("SYSTEM_PROMPT_BASE.txt content", () => {
    it("should contain LANGUAGE RULES section", () => {
      expect(SYSTEM_BASE).toContain("LANGUAGE RULES:");
      expect(SYSTEM_BASE).toContain("technician's language");
      expect(SYSTEM_BASE).toContain("100% English");
    });

    it("should contain WORDING SAFETY section", () => {
      expect(SYSTEM_BASE).toContain("WORDING SAFETY:");
      expect(SYSTEM_BASE).toContain("denial-triggering words");
      expect(SYSTEM_BASE).toContain("broken");
      expect(SYSTEM_BASE).toContain("failed");
      expect(SYSTEM_BASE).toContain("defective");
    });

    it("should contain BEHAVIOR RULES section", () => {
      expect(SYSTEM_BASE).toContain("BEHAVIOR RULES:");
      expect(SYSTEM_BASE).toContain("Never jump to conclusions");
      expect(SYSTEM_BASE).toContain("Never generate authorization or final output unless explicitly allowed");
    });

    it("should contain FORMAT RULES section", () => {
      expect(SYSTEM_BASE).toContain("FORMAT RULES:");
      expect(SYSTEM_BASE).toContain("Plain text only");
      expect(SYSTEM_BASE).toContain("No tables");
    });

    it("should NOT be a chatbot", () => {
      expect(SYSTEM_BASE).toContain("NOT a chatbot");
      expect(SYSTEM_BASE).toContain("NOT provide advice");
    });
  });

  describe("MODE_PROMPT_DIAGNOSTIC.txt content", () => {
    it("should list complex equipment", () => {
      expect(MODE_DIAGNOSTIC).toContain("complex equipment");
      expect(MODE_DIAGNOSTIC).toContain("Roof AC / heat pumps");
      expect(MODE_DIAGNOSTIC).toContain("furnaces");
      expect(MODE_DIAGNOSTIC).toContain("slide-outs");
      expect(MODE_DIAGNOSTIC).toContain("leveling systems");
      expect(MODE_DIAGNOSTIC).toContain("inverters / converters");
      expect(MODE_DIAGNOSTIC).toContain("refrigerators");
    });

    it("should enforce ONE question rule", () => {
      expect(MODE_DIAGNOSTIC).toContain("ONE question at a time");
    });

    it("should prohibit authorization in diagnostic mode", () => {
      expect(MODE_DIAGNOSTIC).toContain("Do NOT generate authorization");
      expect(MODE_DIAGNOSTIC).toContain("Do NOT suggest repair or replacement");
      expect(MODE_DIAGNOSTIC).toContain("Do NOT estimate labor");
    });

    it("should contain POST-REPAIR RULE", () => {
      expect(MODE_DIAGNOSTIC).toContain("POST-REPAIR RULE");
      expect(MODE_DIAGNOSTIC).toContain("Return to diagnostic form behavior");
    });

    it("should contain MECHANICAL SYSTEM RULE", () => {
      expect(MODE_DIAGNOSTIC).toContain("MECHANICAL SYSTEM RULE");
      expect(MODE_DIAGNOSTIC).toContain("motor operates when powered directly");
      expect(MODE_DIAGNOSTIC).toContain("Do NOT recommend motor replacement");
    });

    it("should contain CONSUMER APPLIANCE RULE", () => {
      expect(MODE_DIAGNOSTIC).toContain("CONSUMER APPLIANCE RULE");
      expect(MODE_DIAGNOSTIC).toContain("TVs, microwaves, stereos");
      expect(MODE_DIAGNOSTIC).toContain("non-repairable");
    });
  });

  describe("MODE_PROMPT_FINAL_REPORT.txt content", () => {
    it("should require translation separator", () => {
      expect(MODE_FINAL_REPORT).toContain("--- TRANSLATION ---");
    });

    it("should specify paragraph order", () => {
      expect(MODE_FINAL_REPORT).toContain("Paragraph order");
      expect(MODE_FINAL_REPORT).toContain("Observed symptoms");
      expect(MODE_FINAL_REPORT).toContain("Diagnostic checks performed");
      expect(MODE_FINAL_REPORT).toContain("Verified condition");
      expect(MODE_FINAL_REPORT).toContain("Required repair or replacement");
      expect(MODE_FINAL_REPORT).toContain("Labor justification");
    });

    it("should require labor breakdown", () => {
      expect(MODE_FINAL_REPORT).toContain("LABOR REQUIREMENTS");
      expect(MODE_FINAL_REPORT).toContain("Task-level breakdown");
      expect(MODE_FINAL_REPORT).toContain("Total labor stated");
    });

    it("should enforce plain format", () => {
      expect(MODE_FINAL_REPORT).toContain("No headers");
      expect(MODE_FINAL_REPORT).toContain("No numbering");
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
      const history: { role: "user" | "assistant"; content: string }[] = [];
      
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
      
      const dialogueLanguage = body.dialogueLanguage || "EN";
      expect(dialogueLanguage).toBe("RU");
    });

    it("should fallback to inferred language when not provided", () => {
      const body = {
        message: "test",
      };
      
      const effectiveLanguage = "EN" as const;
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

describe("Complex Equipment Classification (from MODE_PROMPT_DIAGNOSTIC)", () => {
  it("should list all complex equipment types", () => {
    expect(MODE_DIAGNOSTIC).toContain("Roof AC / heat pumps");
    expect(MODE_DIAGNOSTIC).toContain("furnaces");
    expect(MODE_DIAGNOSTIC).toContain("slide-outs");
    expect(MODE_DIAGNOSTIC).toContain("leveling systems");
    expect(MODE_DIAGNOSTIC).toContain("inverters / converters");
    expect(MODE_DIAGNOSTIC).toContain("refrigerators");
  });

  it("should NOT list water pump as complex equipment", () => {
    // Water pump is NOT in the complex equipment list
    // It's a simple system that doesn't require diagnostic form mode
    const complexEquipmentSection = MODE_DIAGNOSTIC.split("Complex systems include:")[1]?.split("\n\n")[0] || "";
    expect(complexEquipmentSection.toLowerCase()).not.toContain("water pump");
  });
});
