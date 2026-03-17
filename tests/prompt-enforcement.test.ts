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

      expect(prompt).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(prompt).toContain("DIAGNOSTIC MODE");
    });

    it("should include diagnostic mode content", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");

      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "ES",
      });

      expect(prompt).toContain("DIAGNOSTIC MODE");
      expect(prompt).toContain("PROCEDURE IS LAW");
      expect(prompt).toContain("All dialogue MUST be in Spanish");
    });

    it("should include final_report mode content", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");

      const prompt = composePrompt({
        mode: "final_report",
        dialogueLanguage: "RU",
      });

      expect(prompt).toContain("FINAL REPORT MODE");
      expect(prompt).toContain("--- TRANSLATION ---");
      expect(prompt).toContain("Estimated Labor");
      expect(prompt).toContain("Complaint:");
      expect(prompt).toContain("translate the full output into Russian");
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
      expect(MODE_DIAGNOSTIC).toContain("COMPLEX SYSTEMS");
      expect(MODE_DIAGNOSTIC).toContain("Roof AC / heat pumps");
      expect(MODE_DIAGNOSTIC).toContain("Furnaces");
      expect(MODE_DIAGNOSTIC).toContain("Slide-out systems");
      expect(MODE_DIAGNOSTIC).toContain("Leveling systems");
      expect(MODE_DIAGNOSTIC).toContain("Inverters / converters");
      expect(MODE_DIAGNOSTIC).toContain("Refrigerators");
    });

    it("should enforce step-by-step procedure rule", () => {
      expect(MODE_DIAGNOSTIC).toContain("EXACT question from the active procedure");
    });

    it("should prohibit unauthorized actions in diagnostic mode", () => {
      expect(MODE_DIAGNOSTIC).toContain("Do NOT generate the report yourself");
      expect(MODE_DIAGNOSTIC).toContain("Do NOT invent diagnostic steps");
      expect(MODE_DIAGNOSTIC).toContain("Do NOT skip ahead");
    });

    it("should contain POST-REPAIR RULE", () => {
      expect(MODE_DIAGNOSTIC).toContain("POST-REPAIR RULE");
      expect(MODE_DIAGNOSTIC).toContain("Return to Guided Diagnostics");
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

    it("should enforce RV terminology and battery-type question", () => {
      expect(MODE_DIAGNOSTIC).toContain("converter/charger");
      expect(MODE_DIAGNOSTIC).toContain("battery type/bank");
      expect(MODE_DIAGNOSTIC).toContain("lead-acid vs lithium");
    });

    it("should limit non-complex unit teardown", () => {
      expect(MODE_DIAGNOSTIC).toContain("NON-COMPLEX UNIT REPAIR LIMITS");
      expect(MODE_DIAGNOSTIC).toContain("unit-level replacement");
    });
  });

  describe("MODE_PROMPT_FINAL_REPORT.txt content", () => {
    it("should require translation separator", () => {
      expect(MODE_FINAL_REPORT).toContain("--- TRANSLATION ---");
    });

    it("should specify required section headers", () => {
      expect(MODE_FINAL_REPORT).toContain("OUTPUT FORMAT");
      expect(MODE_FINAL_REPORT).toContain("Complaint:");
      expect(MODE_FINAL_REPORT).toContain("Diagnostic Procedure:");
      expect(MODE_FINAL_REPORT).toContain("Verified Condition:");
      expect(MODE_FINAL_REPORT).toContain("Recommended Corrective Action:");
      expect(MODE_FINAL_REPORT).toContain("Estimated Labor:");
      expect(MODE_FINAL_REPORT).toContain("Required Parts:");
    });

    it("should require labor breakdown", () => {
      expect(MODE_FINAL_REPORT).toContain("ESTIMATED LABOR RULES");
      expect(MODE_FINAL_REPORT).toContain("Total labor");
    });

    it("should enforce plain format", () => {
      expect(MODE_FINAL_REPORT).toContain("no numbering");
      expect(MODE_FINAL_REPORT).toContain("no tables");
    });
  });
});

describe("Runtime Output Validators (mode-validators.ts)", () => {
  describe("validateDiagnosticOutput", () => {
    it("should detect final-report drift during diagnostics", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "Complaint: Water pump not operating.\nVerified Condition: No pressure.\nRecommended Corrective Action: Replace pump."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_DRIFT"))).toBe(true);
    });

    it("should detect isolation-complete language", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "The isolation is complete. All conditions are met. Ready to transition to final report?"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
    });

    it("should detect translation separator in diagnostic mode", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "Проверьте насос.\n\n--- TRANSLATION ---\n\nCheck the pump."
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_DRIFT"))).toBe(true);
    });

    it("should detect too many questions (>2)", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "Насос работает? Какое давление? Есть ли утечки?"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("DIAGNOSTIC_QUESTION"))).toBe(true);
    });

    it("should allow valid single-question diagnostic output", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "¿Funciona la bomba de agua?"
      );

      expect(result.valid).toBe(true);
    });

    it("should allow valid English diagnostic output", async () => {
      const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

      const result = validateDiagnosticOutput(
        "Is the water pump making any noise when activated?"
      );

      expect(result.valid).toBe(true);
    });
  });

  describe("validateLanguageConsistency", () => {
    it("should detect English output during Russian session", async () => {
      const { validateLanguageConsistency } = await import("@/lib/mode-validators");

      const result = validateLanguageConsistency(
        "Please check the water pump pressure and verify the connections are secure.",
        "RU"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("LANGUAGE_MISMATCH"))).toBe(true);
    });

    it("should allow Russian output during Russian session", async () => {
      const { validateLanguageConsistency } = await import("@/lib/mode-validators");

      const result = validateLanguageConsistency(
        "Проверьте давление в системе водяного насоса?",
        "RU"
      );

      expect(result.valid).toBe(true);
    });

    it("should detect Cyrillic in English session", async () => {
      const { validateLanguageConsistency } = await import("@/lib/mode-validators");

      const result = validateLanguageConsistency(
        "Проверьте насос и давление.",
        "EN"
      );

      expect(result.valid).toBe(false);
    });
  });

  describe("validateFinalReportOutput", () => {
    it("should detect missing translation separator when required", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "Water pump not operating per spec. Replace pump. Labor: 1.5 hours.",
        true,
        "RU"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("Missing '--- TRANSLATION ---'"))).toBe(true);
    });

    it("should detect numbered lists in final report", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        "1. Water pump not operating.\n2. Replace pump.\n\n--- TRANSLATION ---\n\n1. Насос не работает.",
        true,
        "RU"
      );

      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("numbered lists"))).toBe(true);
    });

    it("should allow proper final report format", async () => {
      const { validateFinalReportOutput } = await import("@/lib/mode-validators");

      const result = validateFinalReportOutput(
        `Complaint: Water pump not operating per spec when activated.
Diagnostic Procedure: Verified no pressure at outlet with system energized.
Verified Condition: Pump motor runs but no water flow detected.
Recommended Corrective Action: Replace water pump assembly.
Estimated Labor: Remove and replace water pump - 1.5 hours. Total labor: 1.5 hours.
Required Parts: Water pump assembly P/N TBD.

--- TRANSLATION ---

Жалоба: Водяной насос не работает согласно спецификации при активации.
Процедура диагностики: Подтверждено отсутствие давления на выходе.
Подтверждённое состояние: Двигатель насоса работает, но поток воды не обнаружен.
Рекомендуемое корректирующее действие: Замена узла водяного насоса.
Расчётное время работы: Снятие и замена водяного насоса - 1.5 часа. Общее время: 1.5 часа.
Необходимые запчасти: Узел водяного насоса.`,
        true,
        "RU"
      );

      expect(result.valid).toBe(true);
    });
  });

  describe("validateOutput dispatcher", () => {
    it("should route diagnostic mode to validateDiagnosticOutput", async () => {
      const { validateOutput } = await import("@/lib/mode-validators");

      const result = validateOutput("Is the pump working?", "diagnostic");
      expect(result.valid).toBe(true);
    });

    it("should reject empty output", async () => {
      const { validateOutput } = await import("@/lib/mode-validators");

      const result = validateOutput("", "diagnostic");
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("EMPTY_OUTPUT"))).toBe(true);
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
    expect(MODE_DIAGNOSTIC).toContain("Furnaces");
    expect(MODE_DIAGNOSTIC).toContain("Slide-out systems");
    expect(MODE_DIAGNOSTIC).toContain("Leveling systems");
    expect(MODE_DIAGNOSTIC).toContain("Inverters / converters");
    expect(MODE_DIAGNOSTIC).toContain("Refrigerators");
  });

  it("should list water pump as NON-complex equipment", () => {
    // Water pump is explicitly listed as non-complex
    expect(MODE_DIAGNOSTIC).toContain("NON-COMPLEX SYSTEMS");
    expect(MODE_DIAGNOSTIC).toContain("Water pumps");
  });
});
