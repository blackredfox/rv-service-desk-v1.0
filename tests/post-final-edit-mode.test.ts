/**
 * Post-Final Edit Mode Regression Tests (Case-58 anchor)
 *
 * Delta-fix PR: Post-Final Edit Mode + Report Patch Behavior
 *
 * Proves the four required behaviors for narrow edits arriving AFTER a final
 * report has already been generated:
 *
 *  1. `narrow_labor_line_correction_enters_edit_mode`
 *      — A post-final labor-line correction is routed through the report
 *        REVISION prompt path, not the generic report-prompting path, and not
 *        the broad labor TOTAL override path.
 *
 *  2. `no_start_final_report_restart_loop`
 *      — The system must not respond with the "If you want the report now ...
 *        START FINAL REPORT" invitation when the user asks to patch the
 *        existing report. No restart request is emitted.
 *
 *  3. `revision_prompt_preserves_output_contract`
 *      — The revision directive instructs the LLM to apply only the requested
 *        changes and to regenerate the complete final report with unchanged
 *        facts preserved.
 *
 *  4. `successful_case_58_generation_path_not_regressed`
 *      — A plain "START FINAL REPORT" command that arrives with an already-
 *        ready diagnostic state still produces a fresh final report (i.e. the
 *        new routing does not hijack the existing report-generation path).
 *
 * Regression anchor transcript (Case-58 fragment):
 *   ... final report already on record (English-first + Russian translation) ...
 *   Technician: "исправь - Замена предохранителя и проверка работы: 0.3 ч"
 *   Expected:   the assistant patches the existing report in place.
 *   Observed pre-fix: "Если хотите отчёт сейчас ..." followed by a
 *                      START FINAL REPORT-triggered full regeneration.
 */

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
    system: "water_heater",
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
  getOrCreateContext: vi.fn(() => ({ caseId: "case_58" })),
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

/**
 * Case-58 final report — English-first shop report with a Russian translation.
 * This matches the real structure produced by the report generation path and
 * is the pre-existing assistant message that post-final edits must target.
 */
const CASE_58_FINAL_REPORT = `Complaint: Water heater not operating on 12V.
Diagnostic Procedure: Verified supply, traced power path, isolated failed in-line fuse in the 12V supply to the water heater module.
Verified Condition: Failed in-line fuse in the water heater 12V supply; heater inoperative until fuse restored.
Recommended Corrective Action: Replace the failed in-line fuse and verify water heater operation.
Estimated Labor: Access and inspection - 0.2 hr. Fuse replacement and operation verification - 0.2 hr. Total labor: 0.4 hr.
Required Parts: In-line automotive fuse (matching OEM amperage).

--- TRANSLATION ---

Жалоба: Водонагреватель не работает от 12 В.
Диагностическая процедура: Проверено питание, прослежена цепь, изолирован неисправный линейный предохранитель в цепи 12 В к модулю водонагревателя.
Подтверждённое состояние: Неисправный линейный предохранитель в цепи 12 В водонагревателя; водонагреватель не работает до восстановления предохранителя.
Рекомендуемое корректирующее действие: Заменить неисправный линейный предохранитель и проверить работу водонагревателя.
Оценка трудозатрат: Доступ и осмотр - 0.2 ч. Замена предохранителя и проверка работы - 0.2 ч. Total labor: 0.4 hr.
Необходимые детали: Линейный автомобильный предохранитель (соответствующего OEM номинала).`;

const READY_CONTEXT = {
  caseId: "case_58",
  submode: "main",
  activeStepId: null,
  activeProcedureId: "water_heater",
  primarySystem: "water_heater",
  isolationComplete: true,
  isolationFinding: "Failed in-line fuse in water heater 12V supply",
  terminalState: {
    phase: "terminal" as const,
    faultIdentified: { text: "Failed fuse", stepId: null },
    correctiveAction: "Replace fuse",
    restorationConfirmed: true,
  },
};

function extractPostFinalEditCall(): { system: string; userMessage: string } {
  // The first OpenAI call after the post-final edit message is the one we care
  // about: it contains the composed system prompt + the edit message.
  expect(mockFetch).toHaveBeenCalled();
  const call = mockFetch.mock.calls[0][1] as RequestInit;
  const payload = JSON.parse(call.body as string) as {
    messages: { role: string; content: string }[];
  };
  const system = payload.messages[0]?.content ?? "";
  const userMessage = payload.messages.at(-1)?.content ?? "";
  return { system, userMessage };
}

describe("Post-final edit mode (Case-58 regression anchor)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    mockGetCurrentUser.mockResolvedValue({ id: "user_58" });
    mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_58",
      title: "Water Heater — Case 58",
      userId: "user_58",
      inputLanguage: "RU",
      languageSource: "AUTO",
      mode: "final_report",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockStorage.listMessagesForContext.mockResolvedValue([
      { role: "user", content: "водонагреватель не работает от 12 В" },
      { role: "assistant", content: "Принято. Diagnostics proceed..." },
      { role: "user", content: "START FINAL REPORT" },
      { role: "assistant", content: CASE_58_FINAL_REPORT },
    ]);
    mockStorage.appendMessage.mockResolvedValue({ id: "msg_new" });
    mockStorage.updateCase.mockResolvedValue({ id: "case_58" });

    mockProcessContextMessage.mockReturnValue({
      context: READY_CONTEXT,
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

  it("narrow_labor_line_correction_enters_edit_mode", async () => {
    // Patched labor-line output returned by the mocked LLM. Exercises the
    // REVISION prompt path rather than the labor TOTAL override path.
    const patched = CASE_58_FINAL_REPORT
      .replace("Fuse replacement and operation verification - 0.2 hr", "Fuse replacement and operation verification - 0.3 hr")
      .replace("Total labor: 0.4 hr", "Total labor: 0.5 hr")
      .replace("Замена предохранителя и проверка работы - 0.2 ч", "Замена предохранителя и проверка работы - 0.3 ч");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: patched } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_58",
        message: "исправь - Замена предохранителя и проверка работы: 0.3 ч",
      }),
    });

    await POST(req);

    const { system, userMessage } = extractPostFinalEditCall();

    // The revision prompt must be active (report is being patched, not regenerated from the questionnaire).
    expect(system).toContain("REPORT REVISION (MANDATORY)");
    expect(system).toContain("A final report already exists in the current case history");

    // Ensure the LINE-level edit did NOT trigger the TOTAL labor override path
    // (that path injects a "LABOR OVERRIDE (MANDATORY)" block and a
    // "Regenerate the FINAL SHOP REPORT now" user message instead of the edit).
    expect(system).not.toContain("LABOR OVERRIDE (MANDATORY)");
    expect(userMessage).not.toContain("Regenerate the FINAL SHOP REPORT now");
    expect(userMessage).toBe("исправь - Замена предохранителя и проверка работы: 0.3 ч");
  });

  it("no_start_final_report_restart_loop", async () => {
    const patched = CASE_58_FINAL_REPORT.replace("Total labor: 0.4 hr", "Total labor: 0.5 hr");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: patched } }] }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_58",
        message: "исправь - Замена предохранителя и проверка работы: 0.3 ч",
      }),
    });

    const response = await POST(req);
    const streamText = await response.text();

    // Must NOT emit the deterministic completion-offer / restart-invitation.
    expect(streamText).not.toMatch(/Если хотите отч[её]т сейчас/i);
    expect(streamText).not.toMatch(/START\s+FINAL\s+REPORT/i);
    expect(streamText).not.toMatch(/If you want the report now/i);

    // Must NOT emit the "diagnostics not ready" guard (readiness is satisfied
    // — we are post-final).
    expect(streamText).not.toMatch(/Диагностика ещё не завершена/i);
    expect(streamText).not.toMatch(/Diagnostics are not yet complete/i);
  });

  it("revision_prompt_preserves_output_contract", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: CASE_58_FINAL_REPORT } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_58",
        message: "исправь - Замена предохранителя и проверка работы: 0.3 ч",
      }),
    });

    await POST(req);

    const { system } = extractPostFinalEditCall();

    // Revision directive must instruct the LLM to apply ONLY the requested
    // changes and preserve all unchanged facts.
    expect(system).toContain("Apply only the requested changes and regenerate the complete final report now");
    expect(system).toContain("Preserve every unchanged fact and unchanged section semantically");
    // The revision path also forbids re-asking follow-up questions / sending
    // START FINAL REPORT.
    expect(system).toContain("Do NOT ask follow-up questions");
    expect(system).toContain("Do NOT send START FINAL REPORT");
  });

  it("successful_case_58_generation_path_not_regressed", async () => {
    // A fresh case in diagnostic mode with isolation complete and an explicit
    // "START FINAL REPORT" command must still route through the final-report
    // generation path (not the revision path — there's no prior report yet).
    mockStorage.ensureCase.mockResolvedValue({
      id: "case_58_fresh",
      title: "Water Heater — Case 58 (fresh)",
      userId: "user_58",
      inputLanguage: "RU",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockStorage.listMessagesForContext.mockResolvedValue([
      { role: "user", content: "водонагреватель не работает от 12 В" },
      {
        role: "assistant",
        content:
          "Принято. Причина подтверждена: неисправный предохранитель. Repair confirmed.",
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: CASE_58_FINAL_REPORT } }],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_58_fresh",
        message: "START FINAL REPORT",
      }),
    });

    await POST(req);

    const { system } = extractPostFinalEditCall();

    // Fresh final-report generation path uses the draft-assembly directive and
    // must NOT use the revision directive (there is no prior report to patch).
    expect(system).toContain("REPORT ASSEMBLY (MANDATORY)");
    expect(system).not.toContain("REPORT REVISION (MANDATORY)");
    expect(system).not.toContain(
      "A final report already exists in the current case history",
    );
  });
});
