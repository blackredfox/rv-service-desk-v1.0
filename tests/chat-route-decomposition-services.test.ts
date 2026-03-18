import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  getCase: vi.fn(),
  ensureCase: vi.fn(),
  listMessagesForContext: vi.fn(),
  appendMessage: vi.fn(),
}));

const contextEngineMocks = vi.hoisted(() => ({
  recordAgentAction: vi.fn(),
  clearReplanState: vi.fn((context) => ({ ...context, replanReason: null })),
  isFallbackResponse: vi.fn((text: string) => text.includes("Guided Diagnostics")),
  isInClarificationSubflow: vi.fn((context) => context.submode !== "main"),
  isInReplanState: vi.fn((context) => Boolean(context.replanReason)),
  popTopic: vi.fn((context) => ({ ...context, submode: "main" })),
  updateContext: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  storage: storageMocks,
}));

vi.mock("@/lib/context-engine", () => ({
  DEFAULT_CONFIG: { maxTurns: 5 },
  recordAgentAction: contextEngineMocks.recordAgentAction,
  clearReplanState: contextEngineMocks.clearReplanState,
  isFallbackResponse: contextEngineMocks.isFallbackResponse,
  isInClarificationSubflow: contextEngineMocks.isInClarificationSubflow,
  isInReplanState: contextEngineMocks.isInReplanState,
  popTopic: contextEngineMocks.popTopic,
  updateContext: contextEngineMocks.updateContext,
}));

import {
  ensureChatCase,
  parseChatRequest,
  prepareAttachmentBundle,
  resolveLanguageContext,
} from "@/lib/chat/chat-request-preparer";
import {
  getModelForMode,
  resolveExplicitModeChange,
  resolveStoredCaseMode,
} from "@/lib/chat/chat-mode-resolver";
import {
  buildAdditionalConstraints,
  buildChatSystemPrompt,
} from "@/lib/chat/prompt-context-builder";
import {
  buildLaborOverridePlan,
} from "@/lib/chat/final-report-flow-service";
import {
  buildLaborOverrideRetryInstruction,
  buildPrimaryCorrectionInstruction,
  buildPrimaryFallbackResponse,
  validateLaborOverrideResponse,
  validatePrimaryResponse,
} from "@/lib/chat/response-validation-service";
import {
  appendAssistantChatMessage,
  appendUserChatMessage,
  finalizeDiagnosticPersistence,
  loadChatHistory,
} from "@/lib/chat/chat-persistence-service";

describe("Chat Route Decomposition Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getCase.mockResolvedValue({ case: null, messages: [] });
    storageMocks.ensureCase.mockResolvedValue({
      id: "case_123",
      mode: "diagnostic",
      inputLanguage: "EN",
    });
    storageMocks.listMessagesForContext.mockResolvedValue([]);
    storageMocks.appendMessage.mockResolvedValue({ id: "msg_1" });
  });

  it("parses request bodies and trims the message", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "  hello  " }),
    });

    const result = await parseChatRequest(req);

    expect(result.message).toBe("hello");
    expect(result.body?.message).toBe("  hello  ");
  });

  it("validates attachment bundles without hidden flow logic", () => {
    const valid = prepareAttachmentBundle({
      message: "photo",
      attachments: [{ type: "image", dataUrl: "data:image/png;base64,abc123" }],
    });

    expect(valid.valid).toBe(true);
    if (valid.valid) {
      expect(valid.value.attachmentCount).toBe(1);
    }

    const invalid = prepareAttachmentBundle({
      message: "photo",
      attachments: Array(11).fill({ type: "image", dataUrl: "data:image/png;base64,a" }),
    });

    expect(invalid.valid).toBe(false);
  });

  it("keeps prior language on short acknowledgements", async () => {
    storageMocks.getCase.mockResolvedValue({
      case: { inputLanguage: "RU" },
      messages: [],
    });

    const result = await resolveLanguageContext({
      body: { caseId: "case_1", message: "ok" },
      message: "ok",
      userId: "user_1",
    });

    expect(result.trackedInputLanguage).toBe("RU");
    expect(result.outputPolicy.effective).toBe("RU");
  });

  it("auto-switches tracked language only on strong non-ack evidence", async () => {
    storageMocks.getCase.mockResolvedValue({
      case: { inputLanguage: "EN" },
      messages: [],
    });

    const result = await resolveLanguageContext({
      body: { caseId: "case_1", message: "LA BOMBA DE AGUA NO FUNCIONA" },
      message: "LA BOMBA DE AGUA NO FUNCIONA",
      userId: "user_1",
    });

    expect(result.trackedInputLanguage).toBe("ES");
    expect(result.outputPolicy.effective).toBe("ES");
  });

  it("ensures the case with explicit language source resolution", async () => {
    await ensureChatCase({
      body: { caseId: "case_1", message: "hello" },
      message: "hello",
      trackedInputLanguage: "EN",
      outputPolicy: { mode: "AUTO", effective: "EN", strategy: "auto" },
      userId: "user_1",
    });

    expect(storageMocks.ensureCase).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "case_1",
        inputLanguage: "EN",
        languageSource: "AUTO",
        userId: "user_1",
      }),
    );
  });

  it("resolves stored mode normalization without semantic inference", () => {
    expect(resolveStoredCaseMode("labor_confirmation")).toBe("final_report");
    expect(resolveStoredCaseMode("diagnostic")).toBe("diagnostic");
    expect(getModelForMode("authorization")).toContain("gpt-5.2");
  });

  it("changes modes only on explicit commands", () => {
    expect(resolveExplicitModeChange("diagnostic", "I think we're done, make the report")).toEqual({
      currentMode: "diagnostic",
      nextMode: "diagnostic",
      changed: false,
    });

    expect(resolveExplicitModeChange("diagnostic", "START FINAL REPORT")).toEqual({
      currentMode: "diagnostic",
      nextMode: "final_report",
      changed: true,
    });
  });

  it("builds bounded prompt constraints and preserves vision instruction", () => {
    expect(buildAdditionalConstraints(["A", "", "B"]))?.toBe("A\n\nB");

    const prompt = buildChatSystemPrompt({
      mode: "diagnostic",
      trackedInputLanguage: "EN",
      outputPolicy: { mode: "AUTO", effective: "EN", strategy: "auto" },
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      contextEngineDirectives: "ENGINE",
      procedureContext: "PROCEDURE",
      factLockConstraint: "",
      attachmentCount: 1,
    });

    expect(prompt.systemPrompt).toContain("VISION INPUT: 1 image attached.");
    expect(prompt.additionalConstraints).toContain("ENGINE");
    expect(prompt.additionalConstraints).toContain("PROCEDURE");
  });

  it("validates primary responses and builds authoritative correction/fallback text", () => {
    const validation = validatePrimaryResponse({
      response: `Complaint: Test\nDiagnostic Procedure: Test\nVerified Condition: Test\nRecommended Corrective Action: Test\nEstimated Labor: 1 hr\nRequired Parts: none`,
      mode: "diagnostic",
      trackedInputLanguage: "EN",
      includeTranslation: false,
      activeStepMetadata: {
        id: "wp_2",
        question: "What voltage do you measure at the water pump input?",
        procedureName: "Water Pump",
        progress: { completed: 1, total: 5 },
      },
    });

    expect(validation.valid).toBe(false);

    const correction = buildPrimaryCorrectionInstruction({
      validation,
      activeStepMetadata: {
        id: "wp_2",
        question: "What voltage do you measure at the water pump input?",
        procedureName: "Water Pump",
        progress: { completed: 1, total: 5 },
      },
      activeStepId: "wp_2",
    });

    expect(correction).toContain("What voltage do you measure at the water pump input?");

    const fallback = buildPrimaryFallbackResponse({
      validation: {
        valid: false,
        violations: ["STEP_COMPLIANCE: wrong step rendered"],
      },
      mode: "diagnostic",
      outputLanguage: "EN",
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      activeStepMetadata: {
        id: "wp_2",
        question: "What voltage do you measure at the water pump input?",
        procedureName: "Water Pump",
        progress: { completed: 1, total: 5 },
      },
      activeStepId: "wp_9",
    });

    expect(fallback).toContain("Step wp_2");
    expect(fallback).toContain("What voltage do you measure at the water pump input?");
    expect(fallback).not.toContain("Step wp_9");
  });

  it("validates labor override outputs and builds retry instructions", () => {
    const validation = validateLaborOverrideResponse({
      response: `Complaint: Test\nDiagnostic Procedure: Test\nVerified Condition: Test\nRecommended Corrective Action: Test\nEstimated Labor:\nAccess - 1.0 hr\nRepair - 1.0 hr\nTotal labor: 2.0 hr\nRequired Parts: None`,
      requestedLaborHours: 2.5,
      requestedLaborHoursText: "2.5",
      includeTranslation: false,
    });

    expect(validation.laborValidation.valid).toBe(false);

    const retry = buildLaborOverrideRetryInstruction({
      modeViolations: validation.modeValidation.violations,
      laborViolations: validation.laborValidation.violations,
      requestedLaborHoursText: "2.5",
    });

    expect(retry).toContain("2.5 hr");
    expect(retry).toContain("Keep all sections except Estimated Labor semantically unchanged.");
  });

  it("builds the labor override execution plan with explicit final-report transport", () => {
    const plan = buildLaborOverridePlan({
      requestedLaborHoursText: "3.0",
      factLockConstraint: "FACT LOCK",
      trackedInputLanguage: "EN",
      outputEffective: "EN",
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      history: [{ role: "assistant", content: "Complaint: existing" }],
    });

    expect(plan.overrideBody.model).toContain("gpt-5.2");
    expect(plan.overridePrompt).toContain("FACT LOCK");
    expect(JSON.stringify(plan.overrideBody.messages)).toContain("3.0 hr");
  });

  it("persists messages and diagnostic cleanup through the bounded service", async () => {
    await appendUserChatMessage({
      caseId: "case_1",
      message: "technician input",
      language: "EN",
      userId: "user_1",
    });

    await appendAssistantChatMessage({
      caseId: "case_1",
      content: "assistant output",
      language: "EN",
      userId: "user_1",
    });

    await loadChatHistory("case_1");

    finalizeDiagnosticPersistence({
      caseId: "case_1",
      mode: "diagnostic",
      engineResult: {
        context: { submode: "howto", activeStepId: "wp_2", replanReason: "new evidence" },
      } as never,
      responseText: "Guided Diagnostics: ask the active step",
    });

    expect(storageMocks.appendMessage).toHaveBeenCalledTimes(2);
    expect(storageMocks.listMessagesForContext).toHaveBeenCalledWith("case_1", 12);
    expect(contextEngineMocks.recordAgentAction).toHaveBeenCalled();
    expect(contextEngineMocks.clearReplanState).toHaveBeenCalled();
    expect(contextEngineMocks.popTopic).toHaveBeenCalled();
    expect(contextEngineMocks.updateContext).toHaveBeenCalledTimes(2);
  });
});