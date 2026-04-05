import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();
const mockGetOrCreateContext = vi.fn();
const mockInitializeCase = vi.fn();

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
  initializeCase: (...args: unknown[]) => mockInitializeCase(...args),
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

const FINAL_REPORT_TEXT = `Complaint: Bedroom slide wall leak.
Diagnostic Procedure: Reviewed technician repair summary and verified completed corrective action.
Verified Condition: Vertical trim was re-secured and water leak path was sealed.
Recommended Corrective Action: Document completed repair and warranty claim details.
Estimated Labor: Repair summary review and report preparation - 0.5 hr. Total labor: 0.5 hr.
Required Parts: Screws and sealant as used.`;

const FINAL_REPORT_TEXT_RU = `${FINAL_REPORT_TEXT}

--- TRANSLATION ---

Жалоба: течь воды в стенке слайда спальни. Диагностика выполнена по сводке техника. Состояние после ремонта подтверждено.`;

const FINAL_REPORT_TEXT_ES = `${FINAL_REPORT_TEXT}

--- TRANSLATION ---

Queja: filtración de agua en la pared del slide del dormitorio. El diagnóstico se revisó con base en el resumen del técnico. La condición reparada quedó verificada.`;

describe("Dirty-input report routing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    mockGetCurrentUser.mockResolvedValue({ id: "user_123" });
    mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_dirty_1",
      title: "Dirty Input Case",
      userId: "user_123",
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_1" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_dirty_1" });

    mockGetOrCreateContext.mockReturnValue({
      caseId: "case_dirty_1",
      activeStepId: null,
      isolationComplete: false,
      terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
    });

    mockProcessContextMessage.mockReturnValue({
      context: {
        caseId: "case_dirty_1",
        submode: "main",
        activeStepId: "ic_3",
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

    mockInitializeCase.mockReturnValue({
      system: "inverter_converter",
      procedure: {
        system: "inverter_converter",
        displayName: "Inverter / Converter",
        complex: true,
        variant: "STANDARD",
        steps: [],
      },
      preCompletedSteps: [],
    });
  });

  it("generates a report immediately for EN complaint + findings + repair summary at the beginning", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "Complaint: bedroom slide outside left side wall black metal vertical piece not attached and water leaking into the RV.",
      "Findings: only two screws were present and there was no silicone sealant.",
      "Corrective action: added more screws and applied silicone sealant.",
      "write warranty report",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).toContain("Complaint:");
    expect(streamText).not.toContain("converter");
  });

  it("generates a report immediately for RU natural report intent when enough data already exists", async () => {
    mockStorage.ensureCase.mockResolvedValueOnce({
      id: "case_dirty_1",
      title: "Dirty Input Case",
      userId: "user_123",
      inputLanguage: "RU",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT_RU } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "Жалоба: течь воды у левой наружной стенки слайда спальни.",
      "Найдено: только два самореза, герметика нет.",
      "Ремонт: добавил саморезы и нанес герметик.",
      "сделай отчет",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    expect(streamText).not.toContain("START FINAL REPORT");
  });

  it("generates a report immediately for ES natural report intent when enough data already exists", async () => {
    mockStorage.ensureCase.mockResolvedValueOnce({
      id: "case_dirty_1",
      title: "Dirty Input Case",
      userId: "user_123",
      inputLanguage: "ES",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT_ES } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "Queja: slide del dormitorio con filtración de agua en la pared exterior izquierda y una pieza metálica vertical negra suelta.",
      "Hallazgo: solo había dos tornillos y sin silicona.",
      "Reparación: agregué más tornillos y apliqué silicona.",
      "genera el reporte",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
  });

  it("handles mixed-language typo-heavy report requests when intent is still clear", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: FINAL_REPORT_TEXT_RU } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "bedrom slied ouside left wall blak metal vertical peice not atached, water leeking into rv.",
      "найдено: герметика нет.",
      "added more screwws and applied sillicone.",
      "write warranty report",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
  });

  it("asks only for the missing report fields when dirty input summary is incomplete", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "Complaint: bedroom slide wall leak.",
      "Found only two screws and no silicone.",
      "write warranty report",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();
    const questionCount = (streamText.match(/\?/g) ?? []).length;

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).toContain("missing report details");
    expect(streamText).toContain("what repair you completed");
    expect(questionCount).toBe(1);
  });

  it("does not bypass readiness for explicit START FINAL REPORT when repair data is still missing", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const message = [
      "Complaint: bedroom slide wall leak.",
      "Найдено: только два самореза, силикона нет.",
      "START FINAL REPORT",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dirty_1", message }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_dirty_1", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockInitializeCase).not.toHaveBeenCalled();
    expect(mockProcessContextMessage).not.toHaveBeenCalled();
    expect(streamText).not.toContain("START FINAL REPORT");
    expect(streamText).toContain("какой ремонт был фактически выполнен");
  });
});