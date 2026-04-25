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

  // Doctrine update (runtime customer-fidelity regression fix):
  //
  // The previous tests here asserted that a first-message "complaint +
  // findings + corrective-action + write-report" shape must immediately
  // transition the case into final_report and emit a generated report.
  //
  // That behavior relied on `repairSummaryIntent.readyForReportRouting`
  // (a wording-based heuristic) to unlock final-report availability
  // before the Context Engine confirmed isolation / terminal readiness.
  // Per CUSTOMER_BEHAVIOR_SPEC §5–§6 and ROADMAP §7.1 / §7.4, final-output
  // legality is runtime-owned and MUST NOT be inferred from message
  // wording alone (LLM or technician). The gate is the Context Engine's
  // isolationComplete / terminal phase — nothing else.
  //
  // The replacement tests below assert the doctrine-aligned outcome
  // for exactly the same inputs:
  //   - NO mode transition to final_report,
  //   - NO LLM fetch for report generation,
  //   - system remains in diagnostic mode,
  //   - diagnostics-not-ready deterministic response is emitted.
  it("does NOT transition to final_report for EN complaint + findings + repair summary at the beginning (runtime readiness not satisfied)", async () => {
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

    // No wording-inferred mode transition.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_dirty_1",
      { mode: "final_report" },
    );
    // No LLM call for final-report generation.
    expect(mockFetch).not.toHaveBeenCalled();
    // Emits the diagnostic stream envelope, not the final_report mode event.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Specific report-gate response (Blocker 2 + Case-86 ChatGPT-like
    // acknowledgment): dynamic EN wording. Either Tier 2 ("Understood —
    // you want the report. Complaint, inspection findings, …"), Tier 3
    // ("Understood — you want the report. Before I can prepare it, …"),
    // or Tier 4 fallback ("not yet complete").
    expect(streamText).toMatch(
      /Understood — you want the report\.|not yet complete/,
    );
    // Anti-questionnaire guard.
    expect(streamText).not.toContain("the original complaint");
  });

  it("does NOT transition to final_report for RU natural report intent before runtime readiness", async () => {
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

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_dirty_1",
      { mode: "final_report" },
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Specific report-gate response (Blocker 2 + Case-86): dynamic RU
    // wording. Either Tier 2 ("Понял — отчёт нужен. Жалоба, осмотр …"),
    // Tier 3 ("Понял — отчёт нужен. Прежде чем я его подготовлю, …"),
    // or Tier 4 fallback ("Диагностика ещё не завершена").
    expect(streamText).toMatch(
      /Понял — отчёт нужен\.|Диагностика ещё не завершена/,
    );
    // Anti-questionnaire guard.
    expect(streamText).not.toContain("исходную жалобу");
  });

  it("does NOT transition to final_report for ES natural report intent before runtime readiness", async () => {
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

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_dirty_1",
      { mode: "final_report" },
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Specific report-gate response (Blocker 2 + Case-86): dynamic ES
    // wording. Either Tier 2 ("Entendido — quieres el informe. La queja,
    // la inspección …"), Tier 3 ("Entendido — quieres el informe.
    // Antes de prepararlo, …"), or Tier 4 fallback ("aún no está
    // completo").
    expect(streamText).toMatch(
      /Entendido — quieres el informe\.|aún no está completo/,
    );
    // Anti-questionnaire guard.
    expect(streamText).not.toContain("la queja original");
  });

  it("does NOT transition to final_report for mixed-language typo-heavy report request before runtime readiness", async () => {
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

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_dirty_1",
      { mode: "final_report" },
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
  });

  it("does not ask the technician to re-author complaint/findings/repair when dirty input summary is incomplete", async () => {
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

    // The assistant must NEVER default to asking the technician to
    // author complaint / findings / performed repair. This is the
    // core "no questionnaire-first authored report flow" rule.
    expect(streamText).not.toContain("missing report details");
    expect(streamText).not.toContain("what repair you completed");
    expect(streamText).not.toContain("what you found");
    expect(streamText).not.toContain("the original complaint");
    expect(streamText).not.toContain("какой ремонт был фактически выполнен");
    expect(streamText).not.toContain("что именно было обнаружено");
    expect(streamText).not.toContain("исходную жалобу");
    expect(streamText).not.toContain("qué reparación completaste");
  });

  it("does not ask the technician to re-author the repair for explicit START FINAL REPORT when data is incomplete", async () => {
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

    // No questionnaire-first authored report flow.
    expect(streamText).not.toContain("какой ремонт был фактически выполнен");
    expect(streamText).not.toContain("что именно было обнаружено");
    expect(streamText).not.toContain("исходную жалобу");
    expect(streamText).not.toContain("missing report details");
  });
});