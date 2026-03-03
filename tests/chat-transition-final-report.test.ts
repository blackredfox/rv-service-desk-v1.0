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
}));

vi.mock("@/lib/context-engine", () => ({
  processMessage: (...args: unknown[]) => mockProcessContextMessage(...args),
  recordAgentAction: vi.fn(),
  getOrCreateContext: vi.fn(() => ({ caseId: "case_123" })),
  isInReplanState: vi.fn(() => false),
  clearReplanState: vi.fn((ctx) => ctx),
  generateAntiLoopDirectives: vi.fn(() => []),
  buildReplanNotice: vi.fn(() => ""),
  isInClarificationSubflow: vi.fn(() => false),
  buildReturnToMainInstruction: vi.fn(() => ""),
  buildClarificationContext: vi.fn(() => ""),
  popTopic: vi.fn((ctx) => ctx),
  updateContext: vi.fn(),
  isFallbackResponse: vi.fn(() => false),
  setActiveStep: vi.fn(),
  markStepCompleted: vi.fn(),
  DEFAULT_CONFIG: {},
}));

const FINAL_REPORT_TEXT = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified direct 12V test at pump terminals.
Verified Condition: Pump does not respond under load.
Recommended Corrective Action: Replace water pump assembly.
Estimated Labor: Isolate and drain line - 0.3 hr. Remove existing pump - 0.4 hr. Install and test replacement pump - 0.5 hr. Total labor: 1.2 hr.
Required Parts: Water pump assembly.`;

describe("Chat transition: diagnostic -> final_report", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    mockGetCurrentUser.mockResolvedValue({ id: "user_123" });
    mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_123",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: "RU",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_1" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_123" });

    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: "wp_3",
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

  it("transitions directly to final_report on transition signal and never writes labor_confirmation", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Isolation complete. [TRANSITION: FINAL_REPORT]" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: FINAL_REPORT_TEXT } }],
        }),
      });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "12V direct test: pump does not run",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(streamText).toContain('"type":"mode_transition","from":"diagnostic","to":"final_report"');
    expect(streamText).not.toContain('"type":"labor_status"');

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
    expect(
      mockStorage.updateCase.mock.calls.some(([, payload]) => payload?.mode === "labor_confirmation")
    ).toBe(false);

    const assistantMessages = mockStorage.appendMessage.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.role === "assistant")
      .map((payload) => payload.content as string);

    expect(assistantMessages.some((content) => content.includes("Complaint:"))).toBe(true);
    expect(assistantMessages.some((content) => content.includes("Estimated Labor:"))).toBe(true);
    expect(assistantMessages.some((content) => content.includes("Total labor:"))).toBe(true);
  });

  it("transitions directly to final_report when pivot is triggered by context engine", async () => {
    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: "wp_4",
        isolationComplete: true,
        isolationFinding: "Pump non-responsive under direct 12V",
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "transition",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: true,
      notices: [],
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Isolation complete based on direct 12V test." } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: FINAL_REPORT_TEXT } }],
        }),
      });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "direct test complete",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(streamText).toContain('"type":"mode_transition","from":"diagnostic","to":"final_report"');
    expect(
      mockStorage.updateCase.mock.calls.some(([, payload]) => payload?.mode === "labor_confirmation")
    ).toBe(false);
  });
});
