import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Tests for RV Service Desk Prompt Composer
 * Ensures:
 * - Prompt files exist and are valid
 * - Mode transitions work correctly
 * - Memory window is applied
 */

describe("Prompt Files", () => {
  const promptsDir = join(process.cwd(), "prompts");

  it("should have SYSTEM_PROMPT_BASE.txt", () => {
    const path = join(promptsDir, "system", "SYSTEM_PROMPT_BASE.txt");
    expect(existsSync(path)).toBe(true);
    
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("RV Service Desk");
    expect(content).toContain("NOT a chatbot");
    expect(content).toContain("LANGUAGE RULES");
    expect(content).toContain("WORDING SAFETY");
    expect(content).toContain("denial-triggering words");
  });

  it("should have MODE_PROMPT_DIAGNOSTIC.txt", () => {
    const path = join(promptsDir, "modes", "MODE_PROMPT_DIAGNOSTIC.txt");
    expect(existsSync(path)).toBe(true);
    
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("DIAGNOSTIC MODE");
    expect(content).toContain("COMPLEX SYSTEMS");
    expect(content).toContain("PROCEDURE IS LAW");
    expect(content).toContain("POST-REPAIR RULE");
    expect(content).toContain("MECHANICAL SYSTEM RULE");
    expect(content).toContain("CONSUMER APPLIANCE RULE");
  });

  it("should have MODE_PROMPT_AUTHORIZATION.txt", () => {
    const path = join(promptsDir, "modes", "MODE_PROMPT_AUTHORIZATION.txt");
    expect(existsSync(path)).toBe(true);
    
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("AUTHORIZATION MODE");
    expect(content).toContain("authorization-ready text");
    expect(content).toContain("conservative, warranty-safe language");
  });

  it("should have MODE_PROMPT_FINAL_REPORT.txt", () => {
    const path = join(promptsDir, "modes", "MODE_PROMPT_FINAL_REPORT.txt");
    expect(existsSync(path)).toBe(true);
    
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("FINAL REPORT MODE");
    expect(content).toContain("Shop-Style");
    expect(content).toContain("OUTPUT FORMAT");
    expect(content).toContain("Complaint:");
    expect(content).toContain("Estimated Labor:");
    expect(content).toContain("--- TRANSLATION ---");
  });
});

describe("Prompt Composer", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("composePrompt", () => {
    it("should compose diagnostic mode prompt", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");
      
      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "RU",
      });

      expect(prompt).toContain("RV Service Desk");
      expect(prompt).toContain("DIAGNOSTIC MODE");
      expect(prompt).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(prompt).toContain("RU (Russian)");
    });

    it("should compose authorization mode prompt", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");
      
      const prompt = composePrompt({
        mode: "authorization",
        dialogueLanguage: "EN",
      });

      expect(prompt).toContain("RV Service Desk");
      expect(prompt).toContain("AUTHORIZATION MODE");
      expect(prompt).toContain("LANGUAGE DIRECTIVE (MANDATORY)");
      expect(prompt).toContain("EN (English)");
    });

    it("should compose final_report mode prompt", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");
      
      const prompt = composePrompt({
        mode: "final_report",
        dialogueLanguage: "ES",
      });

      expect(prompt).toContain("RV Service Desk");
      expect(prompt).toContain("FINAL REPORT MODE");
      expect(prompt).toContain("translate the full output into Spanish (ES)");
    });

    it("should include additional constraints when provided", async () => {
      const { composePrompt } = await import("@/lib/prompt-composer");
      
      const prompt = composePrompt({
        mode: "diagnostic",
        dialogueLanguage: "EN",
        additionalConstraints: "Focus on water pump diagnosis.",
      });

      expect(prompt).toContain("Focus on water pump diagnosis.");
    });
  });

  describe("detectModeCommand", () => {
    it("should detect START FINAL REPORT command", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");
      
      expect(detectModeCommand("START FINAL REPORT")).toBe("final_report");
      expect(detectModeCommand("Please START FINAL REPORT now")).toBe("final_report");
      expect(detectModeCommand("start final report")).toBe("final_report");
    });

    it("should detect START AUTHORIZATION REQUEST command", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");
      
      expect(detectModeCommand("START AUTHORIZATION REQUEST")).toBe("authorization");
      expect(detectModeCommand("I need to START AUTHORIZATION REQUEST")).toBe("authorization");
    });

    it("should return null for no command", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");
      
      expect(detectModeCommand("The water pump is not working")).toBeNull();
      expect(detectModeCommand("What should I check?")).toBeNull();
    });

    it("should prioritize FINAL REPORT over AUTHORIZATION", async () => {
      const { detectModeCommand } = await import("@/lib/prompt-composer");
      
      // If both are present, final_report takes priority
      expect(detectModeCommand("START FINAL REPORT and START AUTHORIZATION REQUEST")).toBe("final_report");
    });
  });

  describe("buildMessagesWithMemory", () => {
    it("should build messages with memory window", async () => {
      const { buildMessagesWithMemory } = await import("@/lib/prompt-composer");
      
      const history = [
        { role: "user" as const, content: "Message 1" },
        { role: "assistant" as const, content: "Response 1" },
        { role: "user" as const, content: "Message 2" },
        { role: "assistant" as const, content: "Response 2" },
      ];

      const messages = buildMessagesWithMemory({
        systemPrompt: "System prompt",
        history,
        userMessage: "New message",
        memoryWindow: 4,
      });

      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("System prompt");
      expect(messages.length).toBe(6); // system + 4 history + 1 new user
      expect(messages[messages.length - 1].content).toBe("New message");
    });

    it("should truncate history to memory window", async () => {
      const { buildMessagesWithMemory } = await import("@/lib/prompt-composer");
      
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Message ${i}`,
      }));

      const messages = buildMessagesWithMemory({
        systemPrompt: "System",
        history,
        userMessage: "New",
        memoryWindow: 6,
      });

      // system (1) + last 6 from history + new user (1) = 8
      expect(messages.length).toBe(8);
      // Last history message should be "Message 19"
      expect(messages[messages.length - 2].content).toBe("Message 19");
    });
  });

  describe("Constants", () => {
    it("should export PROHIBITED_WORDS", async () => {
      const { PROHIBITED_WORDS } = await import("@/lib/prompt-composer");
      
      expect(PROHIBITED_WORDS).toContain("broken");
      expect(PROHIBITED_WORDS).toContain("failed");
      expect(PROHIBITED_WORDS).toContain("defective");
      expect(PROHIBITED_WORDS).toContain("damaged");
      expect(PROHIBITED_WORDS).toContain("worn");
      expect(PROHIBITED_WORDS).toContain("leaking");
    });

    it("should export DEFAULT_MEMORY_WINDOW", async () => {
      const { DEFAULT_MEMORY_WINDOW } = await import("@/lib/prompt-composer");
      
      expect(DEFAULT_MEMORY_WINDOW).toBe(12);
    });
  });
});
