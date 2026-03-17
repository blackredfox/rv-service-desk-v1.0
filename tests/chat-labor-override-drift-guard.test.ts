import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();

const mockStorage = {
  getCase: vi.fn(),
  ensureCase: vi.fn(),
  listMessagesForContext: vi.fn(),
  appendMessage: vi.fn(),
  updateCase: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("@/lib/storage", () => ({
  storage: mockStorage,
}));

vi.mock("@/lib/diagnostic-registry", () => ({
  initializeCase: vi.fn(() => ({
    system: "water_pump",
    procedure: null,
    preCompletedSteps: [],
  })),
  buildRegistryContext: vi.fn(() => ""),
  getActiveStepQuestion: vi.fn(() => null),
  getActiveStepMetadata: vi.fn(() => null),
  forceStepComplete: vi.fn(),
  isProcedureFullyComplete: vi.fn(() => false),
  markStepCompleted: vi.fn(),
  markStepUnable: vi.fn(),
  getNextStepId: vi.fn(() => null),
}));

vi.mock("@/lib/context-engine", () => ({
  processMessage: (...args: unknown[]) => mockProcessContextMessage(...args),
  recordAgentAction: vi.fn(),
  getOrCreateContext: vi.fn(() => ({ caseId: "case_321" })),
  isInReplanState: vi.fn(() => false),
  clearReplanState: vi.fn((ctx) => ctx),
  generateAntiLoopDirectives: vi.fn(() => []),
  buildReplanNotice: vi.fn(() => ""),
  isInClarificationSubflow: vi.fn(() => false),
  buildReturnToMainInstruction: vi.fn(() => ""),
  popTopic: vi.fn((ctx) => ctx),
  updateContext: vi.fn(),
  isFallbackResponse: vi.fn(() => false),
  markStepCompleted: vi.fn(),
  checkLoopViolation: vi.fn(() => ({ violation: false })),
  suggestLoopRecovery: vi.fn(() => ({ action: "none", reason: "" })),
  DEFAULT_CONFIG: {},
}));

const FINAL_REPORT_TEXT = `Complaint: Water pump not operating.
Diagnostic Procedure: Direct voltage test completed.
Verified Condition: Pump remains non-responsive under direct 12V.
Recommended Corrective Action: Replace water pump assembly.
Estimated Labor: Isolation and access - 0.4 hr. Remove and replace pump - 0.6 hr. Total labor: 1.0 hr.
Required Parts: Water pump assembly.`;

describe("Labor override detection + diagnostic drift guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    mockGetCurrentUser.mockResolvedValue({ id: "user_123" });
    mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_321",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_1" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_321" });

    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_321",
        submode: "main",
        activeStepId: "wp_7",
        isolationComplete: false,
        isolationFinding: null,
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "ask_step",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: false,
      notices: [],
    });
  });

  it("detects RU labor override intent variants (including typo)", async () => {
    const { __test__ } = await import("@/app/api/chat/route");

    expect(__test__.detectLaborOverrideIntent("Измени на 4.5 hr")).toBe(true);
    expect(__test__.detectLaborOverrideIntent("сделай 4,5 ч")).toBe(true);
    expect(__test__.detectLaborOverrideIntent("зделай 2 часа")).toBe(true);
  });

  it("detects ES labor override intent variants", async () => {
    const { __test__ } = await import("@/app/api/chat/route");

    expect(__test__.detectLaborOverrideIntent("cambia a 2.0 horas")).toBe(true);
    expect(__test__.detectLaborOverrideIntent("ajusta a 1,5 hr")).toBe(true);
  });

  it("allows labor override when mode is diagnostic but final report exists in history", async () => {
    mockStorage.listMessagesForContext.mockResolvedValue([
      { role: "assistant", content: FINAL_REPORT_TEXT },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT.replace("1.0 hr", "2.0 hr") } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_321",
        message: "change to 2.0 hr",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(streamText).not.toContain('"type":"mode_transition"');

    const firstCall = mockFetch.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(firstCall.body as string);
    expect(payload.model).toBe("gpt-5.2-2025-12-11");
    expect(payload.messages[0].content).toContain("LABOR OVERRIDE (MANDATORY)");
    expect(payload.messages.at(-1).content).toContain("Regenerate the FINAL SHOP REPORT now");

    expect(
      mockStorage.updateCase.mock.calls.some(([, update]) => update?.mode === "final_report")
    ).toBe(false);
  });

  it("rejects final-report drift in diagnostic mode and returns a guided diagnostic question", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: FINAL_REPORT_TEXT } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Guided Diagnostics (wp_7): What voltage do you measure at the pump connector under load?" } }],
        }),
      });

    const { POST, __test__ } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_321",
        message: "direct test complete",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const retryCall = mockFetch.mock.calls[1][1] as RequestInit;
    const retryPayload = JSON.parse(retryCall.body as string);
    expect(retryPayload.messages.at(-1).content).toContain("Diagnostic drift correction (MANDATORY)");
    expect(retryPayload.messages.at(-1).content).toContain("wp_7");

    const assistantMessages = mockStorage.appendMessage.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.role === "assistant")
      .map((payload) => payload.content as string);

    const latestAssistant = assistantMessages.at(-1) ?? "";
    expect(latestAssistant).toContain("?");
    expect(__test__.looksLikeFinalReport(latestAssistant)).toBe(false);
    expect(streamText).toContain("[System] Repairing output...");
  });
});
