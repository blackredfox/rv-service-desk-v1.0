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

const caseHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
let messageCounter = 0;

function buildMockFetchResponse(content: string) {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        const encodedContent = JSON.stringify(content);
        const stream = `data: {"choices":[{"delta":{"content":${encodedContent}}}]}\n\ndata: [DONE]\n\n`;
        controller.enqueue(new TextEncoder().encode(stream));
        controller.close();
      },
    }),
  };
}

function queueAssistantResponses(...contents: string[]) {
  contents.forEach((content) => {
    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse(content));
  });
}

describe("/api/chat evidence integrity regressions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-mock";
    caseHistory.clear();
    messageCounter = 0;

    authMocks.getCurrentUser.mockResolvedValue({
      id: "user_evidence",
      email: "tech@example.com",
      plan: "FREE",
      status: "ACTIVE",
    });

    storageMocks.inferLanguageForMessage.mockImplementation((message: string) => ({
      language: /[А-Яа-яЁё]/.test(message) ? "RU" : "EN",
      languageSource: "AUTO",
      confidence: 0.95,
    }));

    storageMocks.getCase.mockResolvedValue({ case: null, messages: [] });
    storageMocks.ensureCase.mockImplementation(
      async ({ caseId, inputLanguage }: { caseId?: string; inputLanguage?: string }) => ({
        id: caseId ?? "case-evidence",
        title: "Evidence Integrity Case",
        userId: "user_evidence",
        inputLanguage: inputLanguage ?? "RU",
        languageSource: "AUTO",
        mode: "diagnostic",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    storageMocks.updateCase.mockResolvedValue({ id: "case-evidence" });
    (storageMocks.listMessagesForContext as any).mockImplementation(async (caseId: string) => caseHistory.get(caseId) ?? []);
    storageMocks.appendMessage.mockImplementation(async (payload: { caseId: string; role: "user" | "assistant"; content: string; language?: string }) => {
      const history = caseHistory.get(payload.caseId) ?? [];
      history.push({ role: payload.role, content: payload.content });
      caseHistory.set(payload.caseId, history);
      return {
        id: `msg_${++messageCounter}`,
        caseId: payload.caseId,
        role: payload.role,
        content: payload.content,
        language: payload.language ?? "RU",
        createdAt: new Date().toISOString(),
      };
    });

    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");
    ["ei_case39", "ei_case40", "ei_case41", "ei_case42"].forEach((caseId) => {
      clearRegistry(caseId);
      clearContext(caseId);
    });
  });

  async function seedCabStep(caseId: string, stepId: string) {
    const { initializeCase, markStepCompleted } = await import("@/lib/diagnostic-registry");
    const { getOrCreateContext, setActiveStep, updateContext } = await import("@/lib/context-engine");

    const completedByStep: Record<string, string[]> = {
      cab_4: ["cab_1", "cab_2", "cab_3"],
      cab_5: ["cab_1", "cab_2", "cab_3", "cab_4"],
      cab_6: ["cab_1", "cab_2", "cab_3", "cab_4", "cab_5"],
    };
    const priorSteps = completedByStep[stepId] ?? [];

    const init = initializeCase(caseId, "cab ac not cooling");
    priorSteps.forEach((completedStepId) => markStepCompleted(caseId, completedStepId));
    const context = getOrCreateContext(caseId);
    updateContext({
      ...context,
      activeProcedureId: init.system,
      completedSteps: new Set(priorSteps),
      askedSteps: new Set(priorSteps),
    });
    setActiveStep(caseId, stepId);
  }

  async function postChat(caseId: string, message: string) {
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message }),
      }),
    );

    return {
      response,
      streamText: await response.text(),
    };
  }

  it("Case-39: suppresses invented recap findings and keeps recap grounded to collected evidence", async () => {
    const caseId = "ei_case39";
    await seedCabStep(caseId, "cab_4");

    queueAssistantResponses(
      "Уже видно вздутие и перегрев. Шаг 5: Есть ли напряжение на разъёме муфты компрессора при включённом кондиционере кабины? Точное значение?",
      "Шаг 5: Есть ли напряжение на разъёме муфты компрессора при включённом кондиционере кабины? Точное значение?",
    );

    const turn = await postChat(caseId, "нет");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(turn.streamText).not.toContain("вздут");
    expect(turn.streamText).not.toContain("перегрев");
    expect(turn.streamText).toContain("напряжение");
    expect(context.activeStepId).toBe("cab_5");
    expect(context.recentStepResolution?.stepId).toBe("cab_4");
  });

  it("Case-40: prevents duplicate step numbering and contradictory recap drift", async () => {
    const caseId = "ei_case40";
    await seedCabStep(caseId, "cab_5");

    queueAssistantResponses(
      "Шаг 6: Напряжения нет. Шаг 6: Какие показания по низкой и высокой стороне?",
      "Шаг 6: Какие показания по низкой и высокой стороне, или давление явно низкое / уравненное?",
    );

    const turn = await postChat(caseId, "да, 12В");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);
    const stepSixCount = turn.streamText.match(/Шаг 6/giu)?.length ?? 0;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stepSixCount).toBeLessThanOrEqual(1);
    expect(turn.streamText).not.toContain("Напряжения нет");
    expect(context.activeStepId).toBe("cab_6");
    expect(context.recentStepResolution?.stepId).toBe("cab_5");
  });

  it("Case-41: treats an immediate correction as replacing the prior measurement without rollback or report-ready leakage", async () => {
    const caseId = "ei_case41";
    await seedCabStep(caseId, "cab_5");

    queueAssistantResponses(
      "Шаг 6: Какие показания по низкой и высокой стороне, или давление явно низкое / уравненное?",
    );

    await postChat(caseId, "да, 115В");

    queueAssistantResponses(
      "Шаг 6: Какие показания по низкой и высокой стороне, или давление явно низкое / уравненное?",
    );

    const correctionTurn = await postChat(caseId, "ой, 12В");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);
    const correctionFetch = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const correctionPayload = JSON.parse(String(correctionFetch.body));

    expect(correctionTurn.streamText).not.toContain("START FINAL REPORT");
    expect(correctionTurn.streamText).not.toContain("[System] Repairing output...");
    expect(context.mode).toBe("diagnostic");
    expect(context.isolationComplete).toBe(false);
    expect(context.activeStepId).toBe("cab_6");
    expect(context.recentStepResolution?.stepId).toBe("cab_5");
    expect(correctionPayload.messages[0].content).toContain("ТЕКУЩИЙ ШАГ: cab_6");
    expect(correctionPayload.messages[0].content).not.toContain("ТЕКУЩИЙ ШАГ: cab_4");
  });

  it("Case-42: follow-up technician hypothesis reopens unresolved evidence instead of staying report-ready", async () => {
    const caseId = "ei_case42";
    await seedCabStep(caseId, "cab_5");

    const { getOrCreateContext, updateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);
    updateContext({
      ...context,
      activeProcedureId: "cab_ac",
      primarySystem: "cab_ac",
      activeStepId: null,
      isolationComplete: true,
      isolationFinding: "Verified restoration — cab ac: clutch feed restored",
      terminalState: {
        phase: "terminal",
        faultIdentified: { text: "compressor clutch feed fault", detectedAt: new Date().toISOString() },
        correctiveAction: { text: "restored clutch feed", detectedAt: new Date().toISOString() },
        restorationConfirmed: { text: "cab AC started cooling", detectedAt: new Date().toISOString() },
      },
    });

    queueAssistantResponses(
      "Понял. Это пока гипотеза, поэтому вернёмся к диагностике. Шаг 5: Есть ли напряжение на разъёме муфты компрессора при включённом кондиционере кабины? Точное значение?",
    );

    const turn = await postChat(caseId, "может, проблема всё-таки в муфте компрессора, это пока не подтверждено");
    const updatedContext = getOrCreateContext(caseId);
    const hypothesisFetch = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const hypothesisPayload = JSON.parse(String(hypothesisFetch.body));

    expect(turn.streamText).not.toContain("START FINAL REPORT");
    expect(turn.streamText).not.toContain("[System] Repairing output...");
    expect(turn.streamText).toContain("Шаг 5");
    expect(updatedContext.isolationComplete).toBe(false);
    expect(updatedContext.terminalState.phase).toBe("normal");
    expect(updatedContext.activeStepId).toBe("cab_5");
    expect(hypothesisPayload.messages[0].content).toContain("REPLAN NOTICE");
  });
});