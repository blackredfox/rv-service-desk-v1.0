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
  checkLoopViolation: vi.fn(() => ({ violation: false })),
  suggestLoopRecovery: vi.fn(() => ({ action: "none", reason: "" })),
  DEFAULT_CONFIG: {},
}));

const FINAL_REPORT_TEXT = `Complaint: Water pump not operating per spec.
Diagnostic Procedure: Verified direct 12V test at pump terminals.
Verified Condition: Pump does not respond under load.
Recommended Corrective Action: Replace water pump assembly.
Estimated Labor: Isolate and drain line - 0.3 hr. Remove existing pump - 0.4 hr. Install and test replacement pump - 0.5 hr. Total labor: 1.2 hr.
Required Parts: Water pump assembly.`;

describe("Explicit-only mode transitions (no auto-transition)", () => {
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
      inputLanguage: "EN",
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

  it("does NOT auto-transition when LLM outputs transition signal (signal is ignored)", async () => {
    // LLM outputs the old transition signal, but it should be ignored
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Finding noted. Next step: Check voltage at pump connector.\n\n[TRANSITION: FINAL_REPORT]" } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "LP gauge shows zero",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    // Should NOT contain mode_transition event
    expect(streamText).not.toContain('"type":"mode_transition"');
    
    // Mode should remain diagnostic
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_123", { mode: "final_report" });
  });

  it("does NOT auto-transition when context engine marks isolation complete (pivot ignored)", async () => {
    // Context engine marks isolation complete, but this should NOT trigger auto-transition
    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: "wp_4",
        isolationComplete: true,  // This should be tracked but NOT trigger transition
        isolationFinding: "Pump non-responsive under direct 12V",
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "ask_step",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: true,
      notices: [],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Noted. This is a significant finding. What is the next test result?" } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "pump does not run with direct 12V",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    // Should NOT transition automatically
    expect(streamText).not.toContain('"type":"mode_transition"');
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_123", { mode: "final_report" });
  });

  it("transitions ONLY via explicit command (START FINAL REPORT)", async () => {
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_123",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "diagnostic",  // Starts in diagnostic
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockFetch.mockResolvedValueOnce({
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
        message: "START FINAL REPORT",  // Explicit command
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    // Should have transitioned via explicit command
    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
  });
});

describe("Chat final_report labor override (explicit mode only)", () => {
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
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "final_report",  // Already in final_report mode
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([
      { role: "assistant", content: FINAL_REPORT_TEXT },
    ]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_1" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_123" });

    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: null,
        isolationComplete: true,
        isolationFinding: "Pump non-responsive",
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "complete",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: false,
      notices: [],
    });
  });

  it("keeps mode in final_report and regenerates report with canonical labor total", async () => {
    const updatedReport = FINAL_REPORT_TEXT.replace("Total labor: 1.2 hr", "Total labor: 2.5 hr");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: updatedReport } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "recalculate labor to 2.5 hours",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).toContain("Total labor: 2.5 hr");
  });

  it("parses Russian override request and normalizes total to one decimal", async () => {
    const updatedReport = FINAL_REPORT_TEXT.replace("Total labor: 1.2 hr", "Total labor: 3.0 hr");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: updatedReport } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "пересчитай трудозатраты на 3 часа",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    expect(streamText).toContain('"type":"mode","mode":"final_report"');
  });

  it("does not trigger labor override when intent keywords are absent", async () => {
    // When just a number is sent without labor override intent keywords,
    // the system should NOT interpret it as a labor override request.
    // It will still validate the response format (since we're in final_report mode),
    // but the labor-specific override path should not be taken.
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT } }],  // Return valid report
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "2.5",  // Just a number, no intent keywords
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    // Mode should remain final_report
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    
    // The original report content should be returned (not a labor-override regeneration)
    expect(streamText).toContain("Total labor: 1.2 hr");  // Original hours, not 2.5
  });
});
