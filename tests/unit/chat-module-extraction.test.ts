import { describe, it, expect } from "vitest";
import {
  sseEncode,
  SseEvents,
  buildOpenAiMessages,
  extractOpenAiChunkContent,
  validateAttachments,
  filterValidAttachments,
  buildVisionInstruction,
  parseRequestedLaborHours,
  detectLaborOverrideIntent,
  looksLikeFinalReport,
  computeLaborOverrideRequest,
  normalizeLaborHours,
  formatLaborHours,
  hasCanonicalTotalLaborLine,
  enforceLanguagePolicy,
  extractPrimaryReportBlock,
  buildFinalReportFallback,
  applyDiagnosticModeValidationGuard,
  DIAGNOSTIC_MODE_GUARD_VIOLATION,
  buildDiagnosticDriftCorrectionInstruction,
  buildDiagnosticDriftFallback,
  buildTranslationInstruction,
  buildFinalReportRequest,
  buildTransitionConstraints,
  logTiming,
  logFlow,
} from "@/lib/chat";

describe("Chat Module Extractions", () => {
  describe("SSE Encoding", () => {
    it("should encode data as SSE format", () => {
      const result = sseEncode({ type: "token", token: "hello" });
      expect(result).toBe('data: {"type":"token","token":"hello"}\n\n');
    });

    it("should create case event", () => {
      const result = SseEvents.case("case-123");
      expect(result).toContain('"type":"case"');
      expect(result).toContain('"caseId":"case-123"');
    });

    it("should create done event", () => {
      const result = SseEvents.done();
      expect(result).toContain('"type":"done"');
    });
  });

  describe("OpenAI Client Helpers", () => {
    it("should build messages with system and history", () => {
      const messages = buildOpenAiMessages({
        system: "You are a helpful assistant",
        history: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        userMessage: "How are you?",
      });

      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe("system");
      expect(messages[3].role).toBe("user");
      expect(messages[3].content).toBe("How are you?");
    });

    it("should build messages with image attachments", () => {
      const messages = buildOpenAiMessages({
        system: "System prompt",
        history: [],
        userMessage: "Check this image",
        attachments: [{ type: "image", dataUrl: "data:image/png;base64,abc123" }],
      });

      expect(messages).toHaveLength(2);
      expect(Array.isArray(messages[1].content)).toBe(true);
      const content = messages[1].content as Array<{ type: string }>;
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("image_url");
    });

    it("should extract chunk content from OpenAI response", () => {
      const payload = {
        choices: [{ delta: { content: "Hello" } }],
      };
      expect(extractOpenAiChunkContent(payload)).toBe("Hello");
    });

    it("should handle empty/missing content", () => {
      expect(extractOpenAiChunkContent({})).toBe("");
      expect(extractOpenAiChunkContent({ choices: [] })).toBe("");
    });
  });

  describe("Attachment Validation", () => {
    it("should accept empty attachments", () => {
      expect(validateAttachments(undefined).valid).toBe(true);
      expect(validateAttachments([]).valid).toBe(true);
    });

    it("should reject too many attachments", () => {
      const tooMany = Array(11).fill({ type: "image", dataUrl: "data:image/png;base64,a" });
      const result = validateAttachments(tooMany);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum 10");
    });

    it("should filter valid attachments", () => {
      const mixed = [
        { type: "image", dataUrl: "data:image/png;base64,abc" },
        { type: "image", dataUrl: "invalid" },
        { type: "file" as "image", dataUrl: "data:image/png;base64,def" },
      ];
      const filtered = filterValidAttachments(mixed);
      expect(filtered).toHaveLength(1);
    });

    it("should build vision instruction", () => {
      expect(buildVisionInstruction(0)).toBe("");
      expect(buildVisionInstruction(1)).toContain("VISION INPUT: 1 image attached");
      expect(buildVisionInstruction(3)).toContain("VISION INPUT: 3 images attached");
    });
  });

  describe("Labor Override", () => {
    it("should parse labor hours from message", () => {
      expect(parseRequestedLaborHours("set to 2.5 hours")).toBe(2.5);
      expect(parseRequestedLaborHours("make it 3 hr")).toBe(3);
      expect(parseRequestedLaborHours("no numbers here")).toBeNull();
      expect(parseRequestedLaborHours("set to 0.05 hours")).toBeNull(); // too small
      expect(parseRequestedLaborHours("set to 25 hours")).toBeNull(); // too large
    });

    it("should detect labor override intent", () => {
      expect(detectLaborOverrideIntent("recalculate labor to 2.5 hours")).toBe(true);
      expect(detectLaborOverrideIntent("set total to 3 hr")).toBe(true);
      expect(detectLaborOverrideIntent("what is the weather?")).toBe(false);
      expect(detectLaborOverrideIntent("2.5")).toBe(false); // no action word
    });

    it("should normalize and format labor hours", () => {
      expect(normalizeLaborHours(2.54)).toBe(2.5);
      expect(normalizeLaborHours(2.55)).toBe(2.6);
      expect(formatLaborHours(2.5)).toBe("2.5");
    });

    it("should check canonical total labor line", () => {
      expect(hasCanonicalTotalLaborLine("Total labor: 2.5 hr", "2.5")).toBe(true);
      expect(hasCanonicalTotalLaborLine("Total labor: 3.0 hr", "2.5")).toBe(false);
    });

    it("should compute labor override request", () => {
      const history = [{ role: "assistant", content: "Complaint: test\nDiagnostic Procedure: test\nVerified Condition: test\nRecommended Corrective Action: test\nEstimated Labor: 1 hr\nRequired Parts: none" }];
      
      const result = computeLaborOverrideRequest("final_report", history, "recalculate to 3 hours");
      expect(result.isLaborOverrideRequest).toBe(true);
      expect(result.requestedLaborHours).toBe(3);

      const noOverride = computeLaborOverrideRequest("diagnostic", history, "hello");
      expect(noOverride.isLaborOverrideRequest).toBe(false);
    });

    it("should detect final report format", () => {
      const report = `Complaint: Test
Diagnostic Procedure: Test
Verified Condition: Test
Recommended Corrective Action: Test
Estimated Labor: 1 hr
Required Parts: None`;
      
      expect(looksLikeFinalReport(report)).toBe(true);
      expect(looksLikeFinalReport("Just a regular message")).toBe(false);
    });
  });

  describe("Output Policy", () => {
    it("should enforce language policy by stripping translation", () => {
      const textWithTranslation = "English content\n\n--- TRANSLATION ---\n\nRussian content";
      const policyNoTranslation = { includeTranslation: false };
      const policyWithTranslation = { includeTranslation: true };

      expect(enforceLanguagePolicy(textWithTranslation, policyNoTranslation)).toBe("English content");
      expect(enforceLanguagePolicy(textWithTranslation, policyWithTranslation)).toBe(textWithTranslation);
    });

    it("should extract primary report block", () => {
      const text = "Primary\n\n--- TRANSLATION ---\n\nSecondary";
      expect(extractPrimaryReportBlock(text)).toBe("Primary");
      expect(extractPrimaryReportBlock("No separator")).toBe("No separator");
    });

    it("should build final report fallback", () => {
      const fallback = buildFinalReportFallback({
        policy: { includeTranslation: false },
        laborHours: 2.5,
      });

      expect(fallback).toContain("Complaint:");
      expect(fallback).toContain("Total labor: 2.5 hr");
      expect(fallback).not.toContain("--- TRANSLATION ---");
    });

    it("should build final report fallback with complaint context", () => {
      const fallback = buildFinalReportFallback({
        policy: { includeTranslation: false },
        laborHours: 1.0,
        complaint: "водонагреватель не работает",
        finding: "LP gauge shows zero pressure",
      });

      expect(fallback).toContain("Complaint: водонагреватель не работает");
      expect(fallback).toContain("Verified Condition: LP gauge shows zero pressure");
    });

    it("should build final report fallback with translation", () => {
      const fallback = buildFinalReportFallback({
        policy: { includeTranslation: true },
        translationLanguage: "RU",
        laborHours: 1.5,
      });

      expect(fallback).toContain("--- TRANSLATION ---");
      expect(fallback).toContain("Жалоба:");
    });

    it("should apply diagnostic mode guard", () => {
      const validResult = { valid: true, violations: [] };
      const diagnosticResponse = "What voltage do you see?";
      
      // Should pass for non-final-report content
      const result1 = applyDiagnosticModeValidationGuard(validResult, "diagnostic", diagnosticResponse);
      expect(result1.valid).toBe(true);

      // Should fail for final-report-like content in diagnostic mode
      const finalReportContent = `Complaint: test
Diagnostic Procedure: test
Verified Condition: test
Recommended Corrective Action: test
Estimated Labor: 1 hr
Required Parts: none`;
      
      const result2 = applyDiagnosticModeValidationGuard(validResult, "diagnostic", finalReportContent);
      expect(result2.valid).toBe(false);
      expect(result2.violations).toContain(DIAGNOSTIC_MODE_GUARD_VIOLATION);

      // Should pass for final_report mode
      const result3 = applyDiagnosticModeValidationGuard(validResult, "final_report", finalReportContent);
      expect(result3.valid).toBe(true);
    });

    it("should build diagnostic drift correction instruction", () => {
      const instruction = buildDiagnosticDriftCorrectionInstruction("wp_2");
      expect(instruction).toContain("DIAGNOSTIC mode");
      expect(instruction).toContain("wp_2");
    });

    it("should build diagnostic drift fallback", () => {
      expect(buildDiagnosticDriftFallback()).toContain("Guided Diagnostics");
      expect(buildDiagnosticDriftFallback("wp_3")).toContain("(wp_3)");
    });
  });

  describe("Final Report Service", () => {
    it("should build translation instruction", () => {
      expect(buildTranslationInstruction(false)).toBe("");
      expect(buildTranslationInstruction(true, "RU")).toContain("Russian");
      expect(buildTranslationInstruction(true, "ES")).toContain("Spanish");
    });

    it("should build final report request", () => {
      const request = buildFinalReportRequest(false);
      expect(request).toContain("FINAL SHOP REPORT");
      expect(request).toContain("Complaint:");
      expect(request).not.toContain("--- TRANSLATION ---");
    });

    it("should build transition constraints", () => {
      const constraints = buildTransitionConstraints("FACT LOCK: test");
      expect(constraints).toContain("FINAL REPORT DIRECTIVE");
      expect(constraints).toContain("FACT LOCK: test");
    });
  });

  describe("Logging", () => {
    it("should log timing without throwing", () => {
      expect(() => logTiming("test", { value: 123 })).not.toThrow();
    });

    it("should log flow without throwing", () => {
      expect(() => logFlow("test", { step: "init" })).not.toThrow();
    });
  });
});
