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

function buildMockFetchResponse(content = "Understood.") {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        const stream = `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\ndata: [DONE]\n\n`;
        controller.enqueue(new TextEncoder().encode(stream));
        controller.close();
      },
    }),
  };
}

describe("/api/chat STEP_GUIDANCE runtime enforcement", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    authMocks.getCurrentUser.mockResolvedValue({
      id: "user_step_guidance",
      email: "tech@example.com",
      plan: "FREE",
      status: "ACTIVE",
    });

    storageMocks.inferLanguageForMessage.mockImplementation((message: string) => ({
      language: /[А-Яа-яЁё]/.test(message) ? "RU" : /[¿¡]|\b(?:cómo|dónde|qué|sí|bomba)\b/i.test(message) ? "ES" : "EN",
      languageSource: "AUTO",
      confidence: 0.95,
    }));

    storageMocks.ensureCase.mockImplementation(async ({ caseId, inputLanguage }: { caseId?: string; inputLanguage?: string }) => ({
      id: caseId ?? "case-step-guidance",
      title: "STEP_GUIDANCE Case",
      userId: "user_step_guidance",
      inputLanguage: inputLanguage ?? "EN",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    storageMocks.appendMessage.mockResolvedValue({
      id: "msg_step_guidance",
      caseId: "case-step-guidance",
      role: "assistant",
      content: "Acknowledged.",
      language: "EN",
      createdAt: new Date().toISOString(),
    });

    fetchMock.mockImplementation(async () => buildMockFetchResponse());

    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");

    [
      "sg_en_wh5",
      "sg_en_wh5_identify",
      "sg_en_wh5a_locate",
      "sg_en_case_27",
      "sg_en_progress_after_followup",
      "sg_ru_branch_wh5a",
      "sg_ru_branch_wh5a_locate",
      "sg_ru_case_28",
      "sg_es_wp2",
      "sg_es_wh5_identify",
      "sg_es_fragment_wh5",
    ].forEach((caseId) => {
      clearRegistry(caseId);
      clearContext(caseId);
    });
  });

  async function postChat(caseId: string, message: string) {
    const { POST } = await import("@/app/api/chat/route");
    const fetchCallsBefore = fetchMock.mock.calls.length;

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
      fetchTriggered: fetchMock.mock.calls.length > fetchCallsBefore,
    };
  }

  async function seedActiveStep(caseId: string, systemMessage: string, stepId: string) {
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    const { getOrCreateContext, setActiveStep, updateContext } = await import("@/lib/context-engine");

    const init = initializeCase(caseId, systemMessage);
    const context = getOrCreateContext(caseId);
    updateContext({
      ...context,
      activeProcedureId: init.system,
    });
    setActiveStep(caseId, stepId);

    expect(getOrCreateContext(caseId).activeStepId).toBe(stepId);
  }

  async function advanceToWh5(caseId: string) {
    const messages = [
      "газовый водонагреватель Suburban не работает",
      "бак полный, вентиль открыт",
      "да, плита работает",
      "клапан открыт",
    ];

    for (const message of messages) {
      await postChat(caseId, message);
    }

    const { getOrCreateContext } = await import("@/lib/context-engine");
    expect(getOrCreateContext(caseId).activeStepId).toBe("wh_5");
  }

  it("keeps the same active step, completion state, mode, and follow-up after EN step guidance", async () => {
    const caseId = "sg_en_wh5";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");

    const turn = await postChat(caseId, "How do I check that voltage?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(turn.streamText).not.toContain("Complaint:");
    expect(turn.streamText).not.toContain("Diagnostic Procedure:");
    expect(turn.streamText).not.toContain("START FINAL REPORT");
    expect(turn.streamText).not.toMatch(/authorization/i);

    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
    expect(context.mode).toBe("diagnostic");
  });

  it("answers EN identify-point guidance for the active wh_5 step without advancing", async () => {
    const caseId = "sg_en_wh5_identify";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");

    const turn = await postChat(caseId, "How do I find the 12V/B+ input?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain("12V/B+");
    expect(turn.streamText).toMatch(/board|connector|switch/i);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("answers EN fuse-location guidance for the active wh_5a step without advancing", async () => {
    const caseId = "sg_en_wh5a_locate";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5a");

    const turn = await postChat(caseId, "Where is the fuse on this model?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toMatch(/fuse|breaker/i);
    expect(turn.streamText).toMatch(/switch input and output|upstream and downstream/i);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
  });

  it("Case-27 failure class: confirmation-style EN follow-up stays on the same active step", async () => {
    const caseId = "sg_en_case_27";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");

    const turn = await postChat(caseId, "Is this the right one?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("preserves the active branch and same branch step for RU STEP_GUIDANCE", async () => {
    const caseId = "sg_ru_branch_wh5a";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const guidanceTurn = await postChat(caseId, "Как проверить предохранитель?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getBranchState } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(guidanceTurn.fetchTriggered).toBe(false);
    expect(guidanceTurn.streamText).toContain("Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.");
    expect(guidanceTurn.streamText).not.toContain("START FINAL REPORT");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
  });

  it("answers RU fuse-location guidance for the active wh_5a branch step without advancing", async () => {
    const caseId = "sg_ru_branch_wh5a_locate";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const guidanceTurn = await postChat(caseId, "Где находится предохранитель у этой модели?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getBranchState } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(guidanceTurn.fetchTriggered).toBe(false);
    expect(guidanceTurn.streamText).toMatch(/предохранител|автомат/i);
    expect(guidanceTurn.streamText).toMatch(/вход и выход|напряжение аккумулятора/i);
    expect(guidanceTurn.streamText).toContain("Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
  });

  it("Case-28 failure class: RU photo-confirmation follow-up stays on the same branch step", async () => {
    const caseId = "sg_ru_case_28";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const turn = await postChat(caseId, "Фото приложил — это он?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getBranchState } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain("Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
  });

  it("preserves ES session language during STEP_GUIDANCE and asks for findings on the same step", async () => {
    const caseId = "sg_es_wp2";
    await seedActiveStep(caseId, "la bomba de agua no funciona", "wp_2");

    const turn = await postChat(caseId, "¿Cómo verifico eso?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain('"outputEffective":"ES"');
    expect(turn.streamText).toContain("Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.");
    expect(turn.streamText).not.toMatch(/Current step|Guided Diagnostics|Progress:/);
    expect(turn.streamText).not.toContain("Complaint:");
    expect(context.activeStepId).toBe("wp_2");
    expect(context.completedSteps.has("wp_2")).toBe(false);
  });

  it("answers ES identify-point guidance for the active wh_5 step without advancing", async () => {
    const caseId = "sg_es_wh5_identify";
    await seedActiveStep(caseId, "el calentador de agua a gas no funciona", "wh_5");

    const turn = await postChat(caseId, "¿Cómo encuentro la entrada 12V/B+?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toContain("12V/B+");
    expect(turn.streamText).toMatch(/placa|interruptor interior|conector/i);
    expect(turn.streamText).toContain("Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.");
    expect(turn.streamText).not.toContain("START FINAL REPORT");
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("keeps ES fragment-style confirmation on the same active step", async () => {
    const caseId = "sg_es_fragment_wh5";
    await seedActiveStep(caseId, "el calentador de agua a gas no funciona", "wh_5");

    const turn = await postChat(caseId, "¿es este?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(false);
    expect(turn.streamText).toMatch(/Seguimos en este paso\.|We are still on this step\./);
    expect(turn.streamText).toMatch(/qué encontraste|what you found/i);
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("resumes normal progression only after actual findings are reported", async () => {
    const caseId = "sg_en_progress_after_followup";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");

    const { markStepCompleted } = await import("@/lib/diagnostic-registry");
    const { getOrCreateContext, updateContext } = await import("@/lib/context-engine");

    ["wh_1", "wh_2", "wh_3", "wh_4"].forEach((stepId) => markStepCompleted(caseId, stepId));
    const seededContext = getOrCreateContext(caseId);
    updateContext({
      ...seededContext,
      completedSteps: new Set(["wh_1", "wh_2", "wh_3", "wh_4"]),
    });

    const clarificationTurn = await postChat(caseId, "Is this the right one?");
    expect(clarificationTurn.fetchTriggered).toBe(false);

    await postChat(caseId, "12.6V is present at the control board input.");
    const context = getOrCreateContext(caseId);

    expect(context.completedSteps.has("wh_5")).toBe(true);
    expect(context.activeStepId).toBe("wh_6");
  });
});