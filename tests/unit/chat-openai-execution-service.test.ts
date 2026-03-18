import { beforeEach, describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  callOpenAI: vi.fn(),
}));

vi.mock("@/lib/chat/openai-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/openai-client")>(
    "@/lib/chat/openai-client",
  );

  return {
    ...actual,
    callOpenAI: openAiMocks.callOpenAI,
  };
});

import {
  executeLaborOverrideCompletion,
  executePrimaryChatCompletion,
} from "@/lib/chat/openai-execution-service";

const englishOnlyPolicy = {
  mode: "AUTO" as const,
  primaryOutput: "EN" as const,
  includeTranslation: false,
};

describe("OpenAI Execution Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries invalid diagnostic output and falls back to the authoritative step", async () => {
    const emitted: string[] = [];
    const invalidDiagnosticResponse = `Complaint: Test\nDiagnostic Procedure: Test\nVerified Condition: Test\nRecommended Corrective Action: Test\nEstimated Labor: 1 hr\nRequired Parts: none`;

    openAiMocks.callOpenAI
      .mockResolvedValueOnce({
        response: invalidDiagnosticResponse,
        durationMs: 1,
        firstTokenMs: 1,
      })
      .mockResolvedValueOnce({
        response: invalidDiagnosticResponse,
        durationMs: 1,
        firstTokenMs: 1,
      });

    const result = await executePrimaryChatCompletion({
      apiKey: "sk-test",
      caseId: "case_1",
      mode: "diagnostic",
      systemPrompt: "system",
      history: [],
      message: "water pump not working",
      signal: new AbortController().signal,
      emitToken: (token) => emitted.push(token),
      isAborted: () => false,
      trackedInputLanguage: "EN",
      outputLanguage: "EN",
      langPolicy: englishOnlyPolicy,
      activeStepMetadata: {
        id: "wp_2",
        question: "What voltage do you measure at the water pump input?",
        procedureName: "Water Pump",
        progress: { completed: 1, total: 5 },
      },
      activeStepId: "wp_2",
      model: "gpt-5-mini-2025-08-07",
      requestStartedAt: Date.now(),
    });

    expect(openAiMocks.callOpenAI).toHaveBeenCalledTimes(2);
    expect(emitted.some((token) => token.includes("Repairing output"))).toBe(true);
    expect(result.emittedValidationFallback).toBe(true);
    expect(result.response).toContain("Step wp_2");
  });

  it("returns a valid labor override response without introducing flow logic", async () => {
    const validFinalReport = `Complaint: Test\nDiagnostic Procedure: Verified power path.\nVerified Condition: Open circuit found.\nRecommended Corrective Action: Replace failed component.\nEstimated Labor:\nAccess - 1.0 hr\nRepair - 1.5 hr\nTotal labor: 2.5 hr\nRequired Parts: None`;

    openAiMocks.callOpenAI
      .mockResolvedValueOnce({
        response: validFinalReport,
        durationMs: 1,
        firstTokenMs: 1,
      })
      .mockResolvedValueOnce({
        response: validFinalReport,
        durationMs: 1,
        firstTokenMs: 1,
      });

    const result = await executeLaborOverrideCompletion({
      apiKey: "sk-test",
      caseId: "case_1",
      factLockConstraint: "FACT LOCK",
      trackedInputLanguage: "EN",
      outputLanguage: "EN",
      langPolicy: englishOnlyPolicy,
      history: [{ role: "assistant", content: "Complaint: existing" }],
      requestedLaborHours: 2.5,
      requestedLaborHoursText: "2.5",
      signal: new AbortController().signal,
      emitToken: vi.fn(),
      isAborted: () => false,
      requestStartedAt: Date.now(),
    });

    expect(openAiMocks.callOpenAI).toHaveBeenCalledTimes(2);
    expect(result.response).toContain("Total labor: 2.5 hr");
  });
});