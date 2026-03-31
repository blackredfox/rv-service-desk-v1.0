import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  inferLanguageForMessage: vi.fn(() => ({
    language: "RU",
    languageSource: "AUTO",
    confidence: 0.95,
  })),
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
    ].forEach((caseId) => {
      clearRegistry(caseId);
      clearContext(caseId);
    });
  });

  async function postChat(caseId: string, message: string) {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, message }),
      }),
    );

    const streamText = await response.text();
    const lastFetchCall = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const payload = JSON.parse(lastFetchCall.body as string);

    return { response, streamText, payload };
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
});