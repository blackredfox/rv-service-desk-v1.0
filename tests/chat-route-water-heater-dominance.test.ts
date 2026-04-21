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
      language: /[А-Яа-яЁё]/.test(message) ? "RU" : /[¿¡]|(?:c[oó]mo|d[oó]nde|qu[eé]|s[ií]|cambi[eé]|prepara|reporte)/iu.test(message) ? "ES" : "EN",
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
      "route_wh5_report_ru_typo",
      "route_wh5_report_en_active_flow",
      "route_wh5_report_es_missing_active_flow",
      "route_wh5_report_too_early_active_flow",
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

  it("route critical no-12V at wh_6a overrides no_ignition and pivots to no_12v_supply (wh_5a)", async () => {
    const caseId = "route_wh6_loop";
    await advanceToWh5(caseId);
    await postChat(caseId, "да, 12.6 В есть");

    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getNextStepId, getBranchState } = await import("@/lib/diagnostic-registry");

    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6");

    // "нет" at wh_6 triggers no_ignition → wh_6a
    await postChat(caseId, "нет");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_6a");
    expect(getNextStepId(caseId)).toBe("wh_6a");
    expect(getBranchState(caseId).activeBranchId).toBe("no_ignition");

    // "нет" at wh_6a (no 12V at igniter module) is a CRITICAL signal: the
    // system must leave the generic no_ignition checklist and pivot into the
    // no_12v_supply branch to diagnose why the required 12V is absent.
    await postChat(caseId, "нет");
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_5a");
    expect(getNextStepId(caseId)).toBe("wh_5a");
    // Must NOT continue the generic downstream checklist
    expect(getOrCreateContext(caseId).activeStepId).not.toBe("wh_6b");
    expect(getOrCreateContext(caseId).activeStepId).not.toBe("wh_6c");
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
    // PR1 (agent-freedom): the offer_completion turn no longer bypasses the LLM.
    // The bounded LLM authors the reply under the Context Engine's completion
    // directive; only on validation failure does the transcript-grounded
    // authoritative offer text kick in. Either way the legality properties below
    // must hold — START FINAL REPORT invitation present, no cross-step/cross-
    // system drift, and no status-terminal "Isolation not completed" prose.
    expect(completionTurn.fetchTriggered).toBe(true);
    expect(completionTurn.streamText).toContain("START FINAL REPORT");
    expect(completionTurn.streamText).toContain("сделать отчёт");
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
    // PR1 (agent-freedom): see note above — LLM is called for the completion
    // offer turn under a bounded directive; legality + fact-integrity must
    // survive either way. Fuse-case fallback prose preserves the finding.
    expect(completionTurn.fetchTriggered).toBe(true);
    expect(completionTurn.streamText).toContain("START FINAL REPORT");
    expect(completionTurn.streamText).toContain("сделать отчёт");
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

  it("does NOT override unfinished wh_5a branch flow for typo-heavy RU repair summary + natural warranty-report request (runtime readiness not satisfied)", async () => {
    // Doctrine update (runtime customer-fidelity regression fix):
    // A natural warranty-report request combined with a technician-worded
    // repair summary MUST NOT override the Context Engine's state and
    // collapse an unfinished branch flow into final_report. Only the
    // Context Engine's restoration / terminal detection is allowed to
    // unlock final-output availability (see CUSTOMER_BEHAVIOR_SPEC §5–§6,
    // ARCHITECTURE_RULES A1 / G1b, ROADMAP §7.1 / §7.4).
    //
    // The typo-heavy message here ("поменял предохранитель") deliberately
    // does NOT match the engine's restoration patterns, so the engine
    // correctly stays on wh_5a. The route must respect that — defer the
    // report request and continue diagnostics.
    const caseId = "route_wh5_report_ru_typo";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const reportTurn = await postChat(
      caseId,
      "я нашел, поменял предохранитель и теперь водонагреватель работает. Сделай воранти репорт",
    );

    const { getOrCreateContext } = await import("@/lib/context-engine");

    // No wording-inferred mode transition.
    expect(storageMocks.updateCase).not.toHaveBeenCalledWith(caseId, { mode: "final_report" });
    // PR1 (agent-freedom): under the new server-bounded contract the LLM is
    // called with a bounded "report-not-ready" directive; on validation
    // failure the transcript-grounded diagnostics-not-ready fallback is
    // used. No wording-inferred mode transition, no LLM-authored report.
    expect(reportTurn.fetchTriggered).toBe(true);
    // Case remains in diagnostic mode for SSE envelope.
    expect(reportTurn.streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(reportTurn.streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Deterministic RU diagnostics-not-ready deferral (fallback path) — NOT a questionnaire.
    expect(reportTurn.streamText).toContain("Диагностика ещё не завершена");
    // Context Engine retains authority — the branch is still active.
    // The specific next step within the branch (e.g. wh_5a → wh_5b) is
    // owned by the engine; what matters for doctrine is that we remain
    // inside the no_12v_supply branch and did NOT collapse the case.
    const ctxAfter = getOrCreateContext(caseId);
    expect(ctxAfter.activeStepId).toMatch(/^wh_5[a-z]?$/);
    expect(ctxAfter.isolationComplete).toBe(false);
    expect(ctxAfter.terminalState?.phase).toBe("normal");
  });

  it("overrides unfinished wh_5a branch flow for EN repair summary + natural warranty-report request", async () => {
    const caseId = "route_wh5_report_en_active_flow";
    await advanceToWh5(caseId);
    await postChat(caseId, "no");

    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("Complaint: Heater inoperative.\nDiagnostic Procedure: Verified failed fuse and completed repair summary.\nVerified Condition: Water heater operates normally after fuse replacement.\nRecommended Corrective Action: Replace the failed fuse and verify normal operation.\nEstimated Labor: Fuse replacement and functional test - 0.4 hr. Total labor: 0.4 hr.\nRequired Parts: Fuse."));

    const reportTurn = await postChat(
      caseId,
      "I found the fuse was blown, replaced it, and now the water heater works. Generate warranty report",
    );

    expect(storageMocks.updateCase).toHaveBeenCalledWith(caseId, { mode: "final_report" });
    expect(reportTurn.fetchTriggered).toBe(true);
    expect(reportTurn.streamText).toContain('"type":"mode","mode":"final_report"');
    expect(reportTurn.streamText).not.toContain("wh_5b");
    expect(reportTurn.streamText).not.toContain("wh_5c");
  });

  it("blocks ES report request during active diagnostic flow — diagnostics not ready", async () => {
    const caseId = "route_wh5_report_es_missing_active_flow";
    await advanceToWh5(caseId);
    await postChat(caseId, "no");

    const reportTurn = await postChat(
      caseId,
      "¿Prepara el warranty report? Cambié el fusible.",
    );

    // PR1 (agent-freedom): LLM is now called with the bounded report-not-ready
    // directive. On validation failure the ES diagnostics-not-ready fallback
    // text is emitted. Mode legality and no cross-step drift in assistant
    // tokens must still hold.
    expect(reportTurn.fetchTriggered).toBe(true);
    expect(storageMocks.updateCase).not.toHaveBeenCalledWith(caseId, { mode: "final_report" });
    // Fallback text (or valid ES LLM reply) must include the "not complete" wording.
    expect(reportTurn.streamText).toContain("no est");
    // No assistant token should advance to a different step.
    expect(reportTurn.streamText).not.toMatch(/"type":"token","token":"[^"]*wh_5b/);
    expect(reportTurn.streamText).not.toMatch(/"type":"token","token":"[^"]*wh_5c/);
  });

  it("blocks bare natural report request during active diagnostic flow — diagnostics not ready", async () => {
    const caseId = "route_wh5_report_too_early_active_flow";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const reportTurn = await postChat(caseId, "Generate warranty report");

    // PR1 (agent-freedom): LLM called with report-not-ready directive; on
    // validation failure the EN diagnostics-not-ready fallback text is used.
    expect(reportTurn.fetchTriggered).toBe(true);
    expect(storageMocks.updateCase).not.toHaveBeenCalledWith(caseId, { mode: "final_report" });
    expect(reportTurn.streamText).toContain("not yet complete");
    expect(reportTurn.streamText).not.toMatch(/"type":"token","token":"[^"]*wh_5b/);
    expect(reportTurn.streamText).not.toMatch(/"type":"token","token":"[^"]*wh_5c/);
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