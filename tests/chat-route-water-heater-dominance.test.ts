import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  inferLanguageForMessage: vi.fn(),
  getCase: vi.fn(() => ({ case: null, messages: [] })),
  ensureCase: vi.fn(),
  updateCase: vi.fn(),
  listMessagesForContext: vi.fn(() => []),
  appendMessage: vi.fn(),
}));

vi.mock("@/lib/auth", () => authMocks);

vi.mock("@/lib/storage", () => ({
  storage: storageMocks,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    }),
  ),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as typeof fetch;

function buildMockStreamData(content = "Принято.") {
  return `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\ndata: [DONE]\n\n`;
}

function buildMockFetchResponse(content = "Принято.") {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(buildMockStreamData(content)));
        controller.close();
      },
    }),
  };
}

describe("/api/chat water-heater runtime dominance", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    authMocks.getCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "tech@example.com",
      plan: "FREE",
      status: "ACTIVE",
    });

    storageMocks.inferLanguageForMessage.mockImplementation((message: string) => ({
      language: /[А-Яа-яЁё]/.test(message) ? "RU" : "EN",
      languageSource: "AUTO",
      confidence: 0.95,
    }));

    storageMocks.ensureCase.mockImplementation(async ({ caseId, inputLanguage }: { caseId?: string; inputLanguage?: string }) => ({
      id: caseId ?? "case_runtime_wh",
      title: "Water Heater Runtime Case",
      userId: "user_1",
      inputLanguage: inputLanguage ?? "RU",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    storageMocks.appendMessage.mockResolvedValue({
      id: "msg_1",
      caseId: "case_runtime_wh",
      role: "assistant",
      content: "Принято.",
      language: "RU",
      createdAt: new Date().toISOString(),
    });

    fetchMock.mockImplementation(async () => buildMockFetchResponse());

    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");
    [
      "route_wh5_negative",
      "route_wh6_loop",
      "route_wh5_positive",
      "route_wh5_clarification",
      "route_wh5_terminal_completion",
      "route_wh5_report_ru",
      "route_report_en",
      "route_wh5_terminal_completion_exact",
      "route_wh5_final_report_restored",
    ].forEach((caseId) => {
      clearRegistry(caseId);
      clearContext(caseId);
    });
  });

  async function postChat(caseId: string, message: string) {
    const { POST } = await import("@/app/api/chat/route");
    const fetchCallCountBefore = fetchMock.mock.calls.length;

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message }),
      }),
    );

    const streamText = await response.text();
    const fetchTriggered = fetchMock.mock.calls.length > fetchCallCountBefore;
    const lastFetchCall = fetchTriggered ? (fetchMock.mock.calls.at(-1)?.[1] as RequestInit) : null;
    const payload = lastFetchCall?.body ? JSON.parse(lastFetchCall.body as string) : null;

    return { response, streamText, payload, fetchTriggered };
  }

  async function advanceToWh5(caseId: string) {
    await postChat(caseId, "газовый водонагреватель Suburban не работает");
    await postChat(caseId, "бак полный, вентиль открыт");
    await postChat(caseId, "да, плита работает");
    await postChat(caseId, "клапан открыт");

    const { getOrCreateContext } = await import("@/lib/context-engine");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_5");
  }

  it("route transcript pivots from bare 'нет' at wh_5 into upstream 12V diagnostics", async () => {
    const caseId = "route_wh5_negative";
    await advanceToWh5(caseId);

    const finalTurn = await postChat(caseId, "нет");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getNextStepId, getBranchState } = await import("@/lib/diagnostic-registry");

    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_5a");
    expect(getNextStepId(caseId)).toBe("wh_5a");
    expect(getNextStepId(caseId)).not.toBe("wh_6");
    expect(getNextStepId(caseId)).not.toBe("wh_6a");
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
    expect(finalTurn.payload.messages[0].content).toContain("wh_5a");
  });

  it("route no-ignition branch does not loop on wh_6a after repeated negative answers", async () => {
    const caseId = "route_wh6_loop";
    await advanceToWh5(caseId);
    await postChat(caseId, "да, 12.6 В есть");

    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getNextStepId } = await import("@/lib/diagnostic-registry");

    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6");

    await postChat(caseId, "нет");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6a");
    expect(getNextStepId(caseId)).toBe("wh_6a");

    await postChat(caseId, "нет");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6b");
    expect(getNextStepId(caseId)).toBe("wh_6b");

    await postChat(caseId, "нет");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6c");
    expect(getNextStepId(caseId)).toBe("wh_6c");
  });

  it("route keeps the normal positive ignition path when wh_5 confirms 12V", async () => {
    const caseId = "route_wh5_positive";
    await advanceToWh5(caseId);
    await postChat(caseId, "да, 12.6 В есть");

    const { getOrCreateContext } = await import("@/lib/context-engine");

    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6");

    await postChat(caseId, "да, щелчки есть");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_7");
  });

  it("route preserves clarification at wh_5 without completing the step", async () => {
    const caseId = "route_wh5_clarification";
    await advanceToWh5(caseId);
    await postChat(caseId, "Как проверить это напряжение?");

    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getNextStepId, getBranchState } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
    expect(getNextStepId(caseId)).toBe("wh_5");
    expect(getBranchState(caseId).activeBranchId).toBeNull();
  });

  it("stops diagnostic step progression when repair is complete and the heater works", async () => {
    const caseId = "route_wh5_terminal_completion";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const completionTurn = await postChat(
      caseId,
      "предохранитель не работал. Я заменил, водонагреватель заработал.",
    );

    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(context.activeStepId).toBeNull();
    expect(context.isolationComplete).toBe(true);
    expect(context.terminalState.phase).toBe("terminal");
    expect(completionTurn.fetchTriggered).toBe(false);
    expect(completionTurn.streamText).toContain("START FINAL REPORT");
    expect(completionTurn.streamText).not.toContain("wh_5b");
    expect(completionTurn.streamText).not.toContain("Step 6");
    expect(completionTurn.streamText).not.toContain("Status: Isolation not completed");
  });

  it("treats the exact wh_5a repair-complete transcript as authoritative terminal state", async () => {
    const caseId = "route_wh5_terminal_completion_exact";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const completionTurn = await postChat(
      caseId,
      "Был неисправен предохранитель. Я заменил. Теперь водонагреватель работает. Проблема устранена",
    );

    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(context.activeStepId).toBeNull();
    expect(context.isolationComplete).toBe(true);
    expect(context.terminalState.phase).toBe("terminal");
    expect(completionTurn.fetchTriggered).toBe(false);
    expect(completionTurn.streamText).toContain("START FINAL REPORT");
    expect(completionTurn.streamText).not.toContain("wh_5b");
    expect(completionTurn.streamText).not.toContain("Step 6");
    expect(completionTurn.streamText).not.toContain("Status: Isolation not completed");
  });

  it("transitions to final_report for RU repair-complete + report-request runtime messages", async () => {
    const caseId = "route_wh5_report_ru";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("Complaint: Heater inoperative.\nDiagnostic Procedure: Verified fuse failure and repair.\nVerified Condition: Heater operates normally after fuse replacement.\nRecommended Corrective Action: Replace failed fuse and verify operation.\nEstimated Labor: Replace fuse and functional test - 0.4 hr. Total labor: 0.4 hr.\nRequired Parts: Fuse."));

    const reportTurn = await postChat(
      caseId,
      "предохранитель не работает. Я заменил, водонагреватель заработал. Напиши Report",
    );

    expect(storageMocks.updateCase).toHaveBeenCalledWith(caseId, { mode: "final_report" });
    expect(reportTurn.streamText).toContain('"type":"mode","mode":"final_report"');
  });

  it("transitions to final_report for natural-language English report commands", async () => {
    const caseId = "route_report_en";
    await advanceToWh5(caseId);
    await postChat(caseId, "no");
    await postChat(caseId, "The fuse was open. I replaced it and the water heater works now.");

    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("Complaint: Heater inoperative.\nDiagnostic Procedure: Verified fuse failure and repair.\nVerified Condition: Heater operates normally after fuse replacement.\nRecommended Corrective Action: Replace failed fuse and verify operation.\nEstimated Labor: Replace fuse and functional test - 0.4 hr. Total labor: 0.4 hr.\nRequired Parts: Fuse."));

    const reportTurn = await postChat(caseId, "Write report");

    expect(storageMocks.updateCase).toHaveBeenCalledWith(caseId, { mode: "final_report" });
    expect(reportTurn.streamText).toContain('"type":"mode","mode":"final_report"');
  });

  it("uses repaired/restored terminal state as final-report source of truth after START FINAL REPORT", async () => {
    const caseId = "route_wh5_final_report_restored";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");
    await postChat(
      caseId,
      "Был неисправен предохранитель. Я заменил. Теперь водонагреватель работает. Проблема устранена",
    );

    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("invalid final report output"));

    const reportTurn = await postChat(caseId, "START FINAL REPORT");

    expect(reportTurn.streamText).toContain("Complaint:");
    expect(reportTurn.streamText).toContain("failed fuse");
    expect(reportTurn.streamText).toContain("Replace failed fuse");
    expect(reportTurn.streamText).toContain("operational after fuse replacement");
  });
});