import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
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
  processResponseForBranch: vi.fn(() => ({ branchEntered: null, lockedOut: [] })),
  getBranchState: vi.fn(() => ({ activeBranchId: null, decisionPath: [], lockedOutBranches: [] })),
  exitBranch: vi.fn(),
}));

vi.mock("@/lib/context-engine", () => ({
  processMessage: vi.fn(() => ({
    context: {
      caseId: "case_789",
      submode: "main",
      activeStepId: "wp_4",
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
  })),
  recordAgentAction: vi.fn(),
  getOrCreateContext: vi.fn(() => ({ caseId: "case_789" })),
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

describe("final_report labor override intent false positive guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    mockGetCurrentUser.mockResolvedValue({ id: "user_123" });
    mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_789",
      title: "Water Pump Final Report",
      userId: "user_123",
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "final_report",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_2" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_789" });
  });

  // labor override intent should not fire for generic "make" + number phrasing
  it("does not trigger LABOR OVERRIDE for non-labor make+number message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Complaint: test\nDiagnostic Procedure: test\nVerified Condition: test\nRecommended Corrective Action: test\nEstimated Labor: test - 1.0 hr. Total labor: 1.0 hr.\nRequired Parts: test" } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_789",
        message: "make step 2 clearer",
      }),
    });

    await POST(req);

    const openAiCall = mockFetch.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(openAiCall.body as string);
    expect(payload.messages[0].content).not.toContain("LABOR OVERRIDE (MANDATORY)");
  });
});
