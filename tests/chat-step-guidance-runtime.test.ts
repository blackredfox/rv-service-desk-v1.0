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

function getMockClarificationResponse(body: string): string {
  const parsed = JSON.parse(body) as {
    messages?: Array<{
      role?: string;
      content?: string | Array<{ type: "text"; text: string }>;
    }>;
  };

  const userMessage = [...(parsed.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user" && message.content)
    ?.content;

  const text = typeof userMessage === "string"
    ? userMessage
    : userMessage?.find((part) => part.type === "text")?.text ?? "";

  if (/Как проверить предохранитель\?/i.test(text)) {
    return "Проверьте предохранитель в цепи питания 12V перед платой и сравните напряжение до и после него.\n\nМы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.";
  }

  if (/А как измеритл 12В/i.test(text)) {
    return "Измерьте напряжение мультиметром между входом 12V на плате и массой, затем сравните показание с напряжением аккумулятора.\n\nМы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.";
  }

  if (/Где находится предохранитель/i.test(text)) {
    return "Ищите предохранитель в линии 12V перед платой водонагревателя или у панели предохранителей дома на колёсах.\n\nМы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.";
  }

  if (/Фото приложил/i.test(text)) {
    return "Сравните деталь на фото с линией питания 12V, идущей к плате, а не с соседними слаботочными проводами.\n\nМы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.";
  }

  if (/¿Cómo verifico eso\?/i.test(text)) {
    return "Haz la medición en el punto exacto de este paso con multímetro y compárala con la referencia indicada.\n\nSeguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.";
  }

  if (/¿Cómo encuentro la entrada 12V\/B\+\?/i.test(text)) {
    return "Sigue el positivo de 12V hasta la placa y ubica la entrada B+ en el conector o terminal de alimentación.\n\nSeguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.";
  }

  if (/¿es este\?/i.test(text)) {
    return "Compara ese cable o terminal con la alimentación que entra a la placa, no con un cable de señal cercano.\n\nSeguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.";
  }

  if (/Where is the fuse on this model\?/i.test(text)) {
    return "Look in the 12V feed ahead of the water-heater board or at the RV DC fuse panel, then compare upstream and downstream voltage.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  if (/How do I find the 12V\/B\+ input\?/i.test(text)) {
    return "Follow the 12V feed into the control board and identify the B+ power input at the board connector or inside switch lead.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  if (/How do I check that voltage\?/i.test(text)) {
    return "Place your meter across the board B+ input and board ground, then compare that reading to battery voltage.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  if (/So how do I measure 12V there\?/i.test(text)) {
    return "Measure between the board B+ input and ground, then compare that reading to battery voltage before changing anything.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  if (/Is this the right one\?/i.test(text)) {
    return "Match the wire or terminal that actually feeds the board B+ input, not a nearby sensor or signal lead.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  if (/near the board harness\?/i.test(text)) {
    return "Yes—stay near the harness that feeds the control board power input, not the adjacent signal wires.\n\nWe are still on this step. After you perform that check, tell me exactly what you found.";
  }

  return "Understood.";
}

function buildMockFetchResponse(content = "Understood.") {
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

    fetchMock.mockImplementation(async (_url, init) =>
      buildMockFetchResponse(getMockClarificationResponse(String(init?.body ?? "{}"))),
    );

    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");

    [
      "sg_en_wh5",
      "sg_en_wh5_identify",
      "sg_en_wh5a_locate",
      "sg_en_case_27",
      "sg_en_generic_support",
      "sg_en_invalid_fallback",
      "sg_en_progress_after_followup",
      "sg_en_wh5a_filler_measure",
      "sg_ru_branch_wh5a",
      "sg_ru_branch_wh5a_locate",
      "sg_ru_case_28",
      "sg_ru_branch_wh5a_typo_howto",
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(turn.streamText).not.toContain("Current step:");
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toContain("Current step:");
    expect(turn.streamText).toMatch(/board|connector|switch|power input/i);
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toContain("Current step:");
    expect(turn.streamText).toMatch(/fuse|breaker/i);
    expect(turn.streamText).toMatch(/switch input and output|upstream and downstream/i);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
  });

  it("keeps filler-led EN measurement follow-ups sticky on wh_5a without advancing", async () => {
    const caseId = "sg_en_wh5a_filler_measure";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5a");

    const turn = await postChat(caseId, "So how do I measure 12V there?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(true);
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).toMatch(/wire|terminal|feeds the board/i);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("keeps an unlisted but related EN follow-up on the same active step by default", async () => {
    const caseId = "sg_en_generic_support";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");

    const turn = await postChat(caseId, "near the board harness?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toContain("Current step:");
    expect(turn.streamText).toMatch(/harness|control board power input/i);
    expect(turn.streamText).toContain("We are still on this step. After you perform that check, tell me exactly what you found.");
    expect(context.activeStepId).toBe("wh_5");
    expect(context.completedSteps.has("wh_5")).toBe(false);
  });

  it("falls back safely when bounded step clarification output is invalid", async () => {
    const caseId = "sg_en_invalid_fallback";
    await seedActiveStep(caseId, "gas water heater not working", "wh_5");
    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("Understood."));
    fetchMock.mockImplementationOnce(async () => buildMockFetchResponse("Still checking."));

    const turn = await postChat(caseId, "near the board harness?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toContain("[System] Repairing clarification...");
    expect(turn.streamText).toContain("Current step:");
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

    expect(guidanceTurn.fetchTriggered).toBe(true);
    expect(guidanceTurn.streamText).not.toContain("Текущий шаг");
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

    expect(guidanceTurn.fetchTriggered).toBe(true);
    expect(guidanceTurn.streamText).not.toContain("Текущий шаг");
    expect(guidanceTurn.streamText).toMatch(/предохранител|линии 12V|панел/i);
    expect(guidanceTurn.streamText).toMatch(/плат|напряжени|до и после/i);
    expect(guidanceTurn.streamText).toContain("Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
  });

  it("keeps wh_5a sticky for typo-heavy RU same-step clarification without findings", async () => {
    const caseId = "sg_ru_branch_wh5a_typo_howto";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const guidanceTurn = await postChat(caseId, "А как измеритл 12В");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getBranchState, getNextStepId } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(guidanceTurn.fetchTriggered).toBe(true);
    expect(guidanceTurn.streamText).toContain("Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.");
    expect(context.activeStepId).toBe("wh_5a");
    expect(context.completedSteps.has("wh_5a")).toBe(false);
    expect(getNextStepId(caseId)).toBe("wh_5a");
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
    expect(guidanceTurn.streamText).not.toContain("wh_5b");
  });

  it("Case-28 failure class: RU photo-confirmation follow-up stays on the same branch step", async () => {
    const caseId = "sg_ru_case_28";
    await advanceToWh5(caseId);
    await postChat(caseId, "нет");

    const turn = await postChat(caseId, "Фото приложил — это он?");
    const { getOrCreateContext } = await import("@/lib/context-engine");
    const { getBranchState } = await import("@/lib/diagnostic-registry");
    const context = getOrCreateContext(caseId);

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).toMatch(/фото|деталь|питани/i);
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toMatch(/Paso actual|Current step/);
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

    expect(turn.fetchTriggered).toBe(true);
    expect(turn.streamText).not.toMatch(/Paso actual|Current step/);
    expect(turn.streamText).toMatch(/placa|conector|terminal de alimentación/i);
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

    expect(turn.fetchTriggered).toBe(true);
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
    expect(clarificationTurn.fetchTriggered).toBe(true);

    await postChat(caseId, "12.6V is present at the control board input.");
    const context = getOrCreateContext(caseId);

    expect(context.completedSteps.has("wh_5")).toBe(true);
    expect(context.activeStepId).toBe("wh_6");
  });
});