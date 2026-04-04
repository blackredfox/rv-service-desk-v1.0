import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tests for PR3: Human-Like Bounded Diagnostic Replies (EN / ES / RU)
 *
 * Verifies:
 * - A. Diagnostic replies feel less robotic
 * - B. No second authority introduced
 * - C. Multilingual behavior (EN/ES/RU)
 * - D. No report/authorization drift
 * - E. No verbosity regression
 *
 * Architecture constraint: These tests validate reply STYLE only.
 * Step selection, completion, and mode transitions remain with Context Engine.
 */

describe("Human-Like Bounded Diagnostic Replies", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("A. Less Robotic Diagnostic Reply Shape", () => {
    it("MODE_PROMPT_DIAGNOSTIC allows human-like acknowledgment + reasoning + question pattern", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: prompt should encourage natural reply structure
      expect(content).toContain("HUMAN-LIKE DIAGNOSTIC REPLIES");
      expect(content).toMatch(/grounded acknowledgment/i);
      expect(content).toMatch(/bounded reasoning/i);
      expect(content).toMatch(/next diagnostic question/i);
    });

    it("MODE_PROMPT_DIAGNOSTIC specifies this is a preferred pattern, not rigid template", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: soft guidance, not mandatory structure
      expect(content).toMatch(/preferred pattern/i);
      expect(content).toMatch(/not.*rigid.*template/i);
      expect(content).toMatch(/guidance.*not.*law/i);
    });

    it("MODE_PROMPT_DIAGNOSTIC maintains one-question-at-a-time behavior", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: must still enforce single question per reply
      expect(content).toMatch(/one question only/i);
      expect(content).toMatch(/do not ask multiple/i);
    });

    it("reply shaping helper validates bounded diagnostic replies", async () => {
      const { validateBoundedDiagnosticReply } = await import(
        "@/lib/chat/diagnostic-reply-shaping"
      );

      // Valid bounded reply
      const validReply = "Understood. That narrows the path. What voltage do you measure at the pump?";
      const validResult = validateBoundedDiagnosticReply(validReply);
      expect(validResult.valid).toBe(true);
      expect(validResult.violations).toHaveLength(0);

      // Multi-question drift (invalid)
      const multiQuestionReply = "Got it. What's the voltage? And the amperage? Also, is the fuse OK?";
      const multiResult = validateBoundedDiagnosticReply(multiQuestionReply);
      expect(multiResult.valid).toBe(false);
      expect(multiResult.violations.some((v) => v.includes("MULTI_QUESTION_DRIFT"))).toBe(true);
    });
  });

  describe("B. No Second Authority", () => {
    it("MODE_PROMPT_DIAGNOSTIC explicitly prohibits reply phrasing from controlling flow", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: human-like phrasing must not become hidden flow logic
      expect(content).toMatch(/no second authority/i);
      expect(content).toMatch(/must not.*decide.*step selection/i);
      expect(content).toMatch(/must not.*decide.*completion/i);
      expect(content).toMatch(/must not.*decide.*mode/i);
    });

    it("MODE_PROMPT_DIAGNOSTIC still defers to runtime context for step decisions", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: procedure and runtime remain authoritative
      expect(content).toContain("PROCEDURE IS LAW");
      expect(content).toContain("runtime context");
      expect(content).toContain("assistant does NOT decide");
    });

    it("MODE_PROMPT_DIAGNOSTIC preserves explicit-only mode transitions", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Contract: mode transitions remain explicit
      expect(content).toContain("MODE TRANSITION RULES (EXPLICIT ONLY)");
      expect(content).toContain("CANNOT automatically switch to final_report mode");
    });

    it("reply shaping module documents no-authority constraint", async () => {
      const shaping = await import("@/lib/chat/diagnostic-reply-shaping");

      // The module should exist and provide style helpers only
      expect(shaping.DIAGNOSTIC_ACKNOWLEDGMENTS).toBeDefined();
      expect(shaping.validateBoundedDiagnosticReply).toBeDefined();

      // Validation function should not make flow decisions
      const result = shaping.validateBoundedDiagnosticReply("Test reply?");
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("violations");
      // No step/mode properties — style validation only
      expect(result).not.toHaveProperty("nextStep");
      expect(result).not.toHaveProperty("modeTransition");
    });
  });

  describe("C. Multilingual Behavior (EN/ES/RU)", () => {
    it("MODE_PROMPT_DIAGNOSTIC provides natural phrasing examples for EN", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      expect(content).toContain('"Understood."');
      expect(content).toContain('"That helps."');
      expect(content).toContain("I'd check this next");
    });

    it("MODE_PROMPT_DIAGNOSTIC provides natural phrasing examples for RU", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      expect(content).toContain('"Понял."');
      expect(content).toContain('"Это уже помогает."');
      expect(content).toContain("Дальше я бы проверил");
    });

    it("MODE_PROMPT_DIAGNOSTIC provides natural phrasing examples for ES", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      expect(content).toContain('"Entendido."');
      expect(content).toContain('"Eso ya ayuda."');
      expect(content).toContain("Yo revisaría esto primero");
    });

    it("reply shaping helper provides acknowledgments for all three languages", async () => {
      const { DIAGNOSTIC_ACKNOWLEDGMENTS, hasLanguageAppropriateAcknowledgment } = await import(
        "@/lib/chat/diagnostic-reply-shaping"
      );

      // EN acknowledgments
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.EN).toContain("Understood.");
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.EN).toContain("That helps.");

      // RU acknowledgments
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.RU).toContain("Понял.");
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.RU).toContain("Это уже помогает.");

      // ES acknowledgments
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.ES).toContain("Entendido.");
      expect(DIAGNOSTIC_ACKNOWLEDGMENTS.ES).toContain("Eso ya ayuda.");

      // Helper function works for all languages
      expect(hasLanguageAppropriateAcknowledgment("Understood. Next check voltage.", "EN")).toBe(true);
      expect(hasLanguageAppropriateAcknowledgment("Понял. Проверь напряжение.", "RU")).toBe(true);
      expect(hasLanguageAppropriateAcknowledgment("Entendido. Verifica el voltaje.", "ES")).toBe(true);
    });

    it("MODE_PROMPT_DIAGNOSTIC response format examples cover all three languages", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Response format section should have EN/RU/ES examples
      expect(content).toMatch(/RESPONSE FORMAT/i);
      expect(content).toMatch(/- EN:.*narrows the path/i);
      expect(content).toMatch(/- RU:.*сужает круг/i);
      expect(content).toMatch(/- ES:.*acota el problema/i);
    });
  });

  describe("D. No Report/Authorization Drift", () => {
    it("human-like phrasing section does not mention report generation", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Extract the human-like replies section
      const humanLikeSection = content.match(
        /HUMAN-LIKE DIAGNOSTIC REPLIES[\s\S]*?(?=RV TERMINOLOGY)/
      )?.[0] || "";

      // Should not contain report/authorization triggers
      expect(humanLikeSection).not.toMatch(/final.*report/i);
      expect(humanLikeSection).not.toMatch(/authorization/i);
      expect(humanLikeSection).not.toMatch(/generate.*report/i);
    });

    it("MODE_PROMPT_DIAGNOSTIC maintains separate report suggestion rules", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      // Report suggestion rules should remain unchanged
      expect(content).toContain("REPORT SUGGESTION RULE");
      expect(content).toContain("Do NOT auto-switch modes");
      expect(content).toContain("START FINAL REPORT");
    });

    it("reply shaping helper does not include report-related functions", async () => {
      const shaping = await import("@/lib/chat/diagnostic-reply-shaping");

      // Module should only have style/acknowledgment helpers
      expect(shaping).not.toHaveProperty("triggerReport");
      expect(shaping).not.toHaveProperty("checkReportReadiness");
      expect(shaping).not.toHaveProperty("generateReport");
    });
  });

  describe("E. No Verbosity Regression", () => {
    it("MODE_PROMPT_DIAGNOSTIC explicitly prohibits chatty/verbose replies", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      expect(content).toMatch(/stay concise/i);
      expect(content).toMatch(/do not.*chatty/i);
      expect(content).toMatch(/do not.*verbose/i);
    });

    it("reply shaping helper detects verbosity drift", async () => {
      const { validateBoundedDiagnosticReply } = await import(
        "@/lib/chat/diagnostic-reply-shaping"
      );

      // Short reply should pass
      const shortReply = "Understood. That narrows it down. What's the voltage at the pump?";
      expect(validateBoundedDiagnosticReply(shortReply).valid).toBe(true);

      // Overly verbose reply should fail
      const verboseReply = Array(200).fill("word").join(" ") + "?";
      const verboseResult = validateBoundedDiagnosticReply(verboseReply);
      expect(verboseResult.valid).toBe(false);
      expect(verboseResult.violations.some((v) => v.includes("VERBOSITY_DRIFT"))).toBe(true);
    });

    it("MODE_PROMPT_DIAGNOSTIC keeps 'Professional and direct. No filler.' rule", () => {
      const content = readFileSync(
        join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
        "utf-8"
      );

      expect(content).toContain("Professional and direct");
      expect(content).toContain("No filler");
    });

    it("reply shaping helper detects speculative language", async () => {
      const { validateBoundedDiagnosticReply } = await import(
        "@/lib/chat/diagnostic-reply-shaping"
      );

      // Speculative reply should be flagged
      const speculativeReply = "I think it might be the relay. What voltage do you see?";
      const result = validateBoundedDiagnosticReply(speculativeReply);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("SPECULATIVE_LANGUAGE"))).toBe(true);
    });
  });
});

describe("Tone Adjustment - Extended for Human-Like Replies", () => {
  it("MODE_PROMPT_DIAGNOSTIC: human-like section complements existing tone rules", () => {
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8"
    );

    // Existing tone rules should still be present
    expect(content).toContain("COMMUNICATION STYLE IN THIS MODE");
    expect(content).toContain('Do NOT start responses with "Thank you"');
    expect(content).toContain("ONE short acknowledgment at most");

    // Human-like section should be additive, not replacing
    expect(content).toContain("HUMAN-LIKE DIAGNOSTIC REPLIES");
    expect(content).toContain("senior technician partner");
  });
});
