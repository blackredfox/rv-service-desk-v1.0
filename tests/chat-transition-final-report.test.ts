import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();
const mockGetOrCreateContext = vi.fn();

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
  processMessage: (...args: unknown[]) => mockProcessContextMessage(...args),
  recordAgentAction: vi.fn(),
  getOrCreateContext: (...args: unknown[]) => mockGetOrCreateContext(...args),
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

const FINAL_REPORT_TEXT_RU = `${FINAL_REPORT_TEXT}

--- TRANSLATION ---

Жалоба: водяной насос не работает по спецификации. Диагностическая проверка выполнена и итоговое состояние подтверждено.`;

const FINAL_REPORT_TEXT_ES = `${FINAL_REPORT_TEXT}

--- TRANSLATION ---

Queja: la bomba de agua no funciona según especificación. La verificación diagnóstica fue completada y la condición final quedó confirmada.`;

describe("Explicit-only mode transitions (no auto-transition)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
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
    mockGetOrCreateContext.mockReturnValue({
      caseId: "case_123",
      activeStepId: "wp_3",
      isolationComplete: false,
      terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
    });

    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: "wp_3",
        isolationComplete: false,
        isolationFinding: null,
        terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
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
        terminalState: { phase: "terminal", faultIdentified: { text: "Pump non-responsive", detectedAt: new Date().toISOString() }, correctiveAction: null, restorationConfirmed: null },
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

  it("transitions via explicit report commands (START FINAL REPORT example)", async () => {
    mockGetOrCreateContext.mockReturnValue({
      caseId: "case_123",
      activeStepId: null,
      isolationComplete: true,
      terminalState: {
        phase: "terminal",
        faultIdentified: { text: "Pump fault fixed", detectedAt: new Date().toISOString() },
        correctiveAction: { text: "Pump repaired", detectedAt: new Date().toISOString() },
        restorationConfirmed: { text: "Pump works now", detectedAt: new Date().toISOString() },
      },
    });

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

  it.each([
    ["EN", "write report"],
    ["RU", "сделай отчет"],
    ["ES", "genera el reporte"],
  ])("allows approved natural report intent when case is report-ready (%s)", async (language, message) => {
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_123",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: language,
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockProcessContextMessage.mockReturnValueOnce({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: null,
        isolationComplete: true,
        isolationFinding: "Repair completion confirmed",
        terminalState: {
          phase: "terminal",
          faultIdentified: { text: "Pump fault fixed", detectedAt: new Date().toISOString() },
          correctiveAction: { text: "Pump repaired", detectedAt: new Date().toISOString() },
          restorationConfirmed: { text: "Pump works now", detectedAt: new Date().toISOString() },
        },
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "offer_completion",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: true,
      notices: [],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: language === "RU" ? FINAL_REPORT_TEXT_RU : FINAL_REPORT_TEXT } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message }),
    }));

    await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
  });

  it("blocks report request when diagnostics are not ready (no questionnaire fallback)", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message: "write report" }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_123", { mode: "final_report" });
    // PR1 (agent-freedom): LLM called under the report-not-ready directive;
    // server-owned readiness gate still blocks the questionnaire-first
    // fallback and holds the mode in diagnostic.
    expect(mockFetch).toHaveBeenCalled();
    // Diagnostics-not-ready fallback text must appear (EN).
    expect(streamText).toContain("Diagnostics are not yet complete");
  });

  it("does NOT use the report path mid-flow when history + current repair summary are only wording-inferred (runtime readiness not satisfied)", async () => {
    // Doctrine update (runtime customer-fidelity regression fix):
    // A mid-flow report request combined with complaint/findings/repair
    // wording in history and the current message MUST NOT unlock the
    // final_report path unless the Context Engine has confirmed readiness
    // (isolationComplete / terminal). Prior behavior used the
    // repairSummaryIntent heuristic to transition mode based on wording
    // alone — that is a hidden second flow authority and is now rejected.
    // See CUSTOMER_BEHAVIOR_SPEC §5–§6 and ROADMAP §7.1 / §7.4.
    mockStorage.listMessagesForContext.mockResolvedValueOnce([
      { role: "user", content: "Complaint: Water pump not operating per spec." },
      { role: "user", content: "Findings: direct 12V was present and the fuse was blown." },
    ]);

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_123",
        message: "Repair: replaced the fuse and pump works now. write report",
      }),
    }));

    const streamText = await response.text();

    // No wording-inferred mode transition to final_report.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_123", { mode: "final_report" });
    // PR1 (agent-freedom): bounded LLM call under report-not-ready directive.
    expect(mockFetch).toHaveBeenCalled();
    // Case remains in diagnostic mode for the SSE envelope.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Deterministic diagnostics-not-ready deferral (EN session) via fallback.
    expect(streamText).toContain("Diagnostics are not yet complete");
  });
});

describe("Post-report natural edit loop", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
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
    mockStorage.listMessagesForContext.mockResolvedValue([
      { role: "assistant", content: FINAL_REPORT_TEXT },
    ]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_1" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_123" });
    mockGetOrCreateContext.mockReturnValue({
      caseId: "case_123",
      activeStepId: null,
      isolationComplete: false,
      terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
    });
    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_123",
        submode: "main",
        activeStepId: "wp_3",
        isolationComplete: false,
        isolationFinding: null,
        terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
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

  it("treats a labor-change request as a report edit when a report already exists", async () => {
    const updatedReport = FINAL_REPORT_TEXT.replace("Total labor: 1.2 hr", "Total labor: 0.5 hr");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: updatedReport } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message: "change total labor to 0.5 hr" }),
    }));

    const streamText = await response.text();

    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).toContain("Total labor: 0.5 hr");
    expect(streamText).not.toContain("START FINAL REPORT");
  });

  it("treats add/remove instructions as report edits instead of returning to completion prompts", async () => {
    const updatedReport = FINAL_REPORT_TEXT.replace(
      "Required Parts: Water pump assembly.",
      "Required Parts: Water pump assembly and fuse.",
    );
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: updatedReport } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message: "add that I replaced the fuse" }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).not.toContain("START FINAL REPORT");
  });

  it("handles RU natural edit requests after a report already exists", async () => {
    mockStorage.ensureCase.mockResolvedValueOnce({
      id: "case_123",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: "RU",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValueOnce([
      { role: "assistant", content: FINAL_REPORT_TEXT_RU },
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT_RU } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message: "убери это" }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).not.toContain("START FINAL REPORT");
  });

  it("handles ES natural edit requests after a report already exists", async () => {
    mockStorage.ensureCase.mockResolvedValueOnce({
      id: "case_123",
      title: "Water Pump Case",
      userId: "user_123",
      inputLanguage: "ES",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValueOnce([
      { role: "assistant", content: FINAL_REPORT_TEXT },
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_123", message: "quita eso" }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_123", { mode: "final_report" });
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).not.toContain("START FINAL REPORT");
  });
});

describe("Chat final_report labor override (explicit mode only)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
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
        terminalState: { phase: "terminal", faultIdentified: { text: "Pump non-responsive", detectedAt: new Date().toISOString() }, correctiveAction: null, restorationConfirmed: null },
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
