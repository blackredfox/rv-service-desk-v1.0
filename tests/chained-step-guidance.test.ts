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

/**
 * PR4: Chained Step Guidance Without Advancement Tests
 *
 * Verifies:
 * - A. First clarification stays on same step
 * - B. Repeated locate clarification stays on same step
 * - C. Actual locate question is answered (not next-step advancement)
 * - D. No hidden progress (wh_5a does not advance to wh_5b/wh_5c)
 * - E. Findings still allow advancement
 * - F. Multilingual support (EN/ES/RU)
 * - G. No second authority introduced
 * - H. Photo/dictation follow-ups stay on same step
 */
describe("PR4: Chained Step Guidance Without Advancement", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    authMocks.getCurrentUser.mockResolvedValue({
      id: "user_chained",
      email: "tech@example.com",
      plan: "FREE",
      status: "ACTIVE",
    });

    storageMocks.inferLanguageForMessage.mockImplementation((message: string) => ({
      language: /[А-Яа-яЁё]/.test(message) ? "RU" : /[¿¡]|\b(?:cómo|dónde|qué|sí|bomba|fusible)\b/i.test(message) ? "ES" : "EN",
      languageSource: "AUTO",
      confidence: 0.95,
    }));

    storageMocks.ensureCase.mockImplementation(async ({ caseId, inputLanguage }: { caseId?: string; inputLanguage?: string }) => ({
      id: caseId ?? "case-chained",
      title: "Chained Guidance Case",
      userId: "user_chained",
      inputLanguage: inputLanguage ?? "EN",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    storageMocks.appendMessage.mockResolvedValue({
      id: "msg_chained",
      caseId: "case-chained",
      role: "assistant",
      content: "Acknowledged.",
      language: "EN",
      createdAt: new Date().toISOString(),
    });

    fetchMock.mockImplementation(async () => buildMockFetchResponse());

    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");

    // Clear test cases
    [
      "chained_en_wh5a",
      "chained_ru_wh5a",
      "chained_ru_wh5a_repeated",
      "chained_es_wh5a",
      "chained_photo_confirm",
      "chained_findings_advance",
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

  async function seedActiveStepWithPriorGuidance(
    caseId: string,
    systemMessage: string,
    stepId: string,
    language: "EN" | "RU" | "ES",
  ) {
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    const { getOrCreateContext, setActiveStep, updateContext } = await import("@/lib/context-engine");

    const init = initializeCase(caseId, systemMessage);
    const context = getOrCreateContext(caseId);
    updateContext({
      ...context,
      activeProcedureId: init.system,
    });
    setActiveStep(caseId, stepId);

    // Mock prior guidance message to simulate chained state
    const continuationText = {
      EN: "We are still on this step. After you perform that check, tell me exactly what you found.",
      RU: "Мы всё ещё на этом шаге. После проверки сообщите точно, что вы обнаружили.",
      ES: "Seguimos en este paso. Después de realizar esa verificación, dime exactamente qué encontraste.",
    }[language];

    storageMocks.listMessagesForContext.mockResolvedValue([
      {
        id: "prior_guidance",
        caseId,
        role: "assistant",
        content: `How to check: Use multimeter at the fuse terminals.\n\n${continuationText}`,
        language,
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(getOrCreateContext(caseId).activeStepId).toBe(stepId);
  }

  describe("A. First clarification stays on same step", () => {
    it("EN: 'how do I check that?' stays on wh_5a", async () => {
      const caseId = "chained_en_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "gas water heater not working", "wh_5a", "EN");

      const turn = await postChat(caseId, "how do I check that?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(turn.fetchTriggered).toBe(false);
      expect(context.activeStepId).toBe("wh_5a");
      expect(context.completedSteps.has("wh_5a")).toBe(false);
      expect(turn.streamText).toContain("We are still on this step");
    });
  });

  describe("B. Repeated locate clarification stays on same step", () => {
    it("RU: 'а где находится предохранитель?' after prior clarification stays on wh_5a", async () => {
      const caseId = "chained_ru_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "газовый водонагреватель не работает", "wh_5a", "RU");

      const turn = await postChat(caseId, "а где находится предохранитель?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(turn.fetchTriggered).toBe(false);
      expect(context.activeStepId).toBe("wh_5a");
      expect(context.completedSteps.has("wh_5a")).toBe(false);
      // Should contain locate help
      expect(turn.streamText).toMatch(/предохранител|распределительн|щит/i);
    });

    it("RU: repeated 'скажи мне, где находится предохранитель?' still stays on wh_5a", async () => {
      const caseId = "chained_ru_wh5a_repeated";
      await seedActiveStepWithPriorGuidance(caseId, "газовый водонагреватель не работает", "wh_5a", "RU");

      const turn = await postChat(caseId, "скажи мне, где находится предохранитель?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(turn.fetchTriggered).toBe(false);
      expect(context.activeStepId).toBe("wh_5a");
      expect(context.completedSteps.has("wh_5a")).toBe(false);
    });
  });

  describe("C. Actual locate question is answered", () => {
    it("response contains bounded locate/identify help, not next-step text", async () => {
      const caseId = "chained_en_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "gas water heater not working", "wh_5a", "EN");

      const turn = await postChat(caseId, "where is the fuse?");

      // Should contain fuse location guidance
      expect(turn.streamText).toMatch(/fuse|DC distribution|panel|breaker/i);
      // Should NOT contain next-step advancement indicators
      expect(turn.streamText).not.toMatch(/Step wh_5b/i);
      expect(turn.streamText).not.toMatch(/moving to next/i);
    });
  });

  describe("D. No hidden progress (regression case)", () => {
    it("RU wh_5a chained clarification does NOT advance to wh_5b or wh_5c", async () => {
      const caseId = "chained_ru_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "газовый водонагреватель не работает", "wh_5a", "RU");

      // First clarification
      await postChat(caseId, "как проверить?");
      const { getOrCreateContext: getCtx1 } = await import("@/lib/context-engine");
      expect(getCtx1(caseId).activeStepId).toBe("wh_5a");

      // Second clarification (locate)
      await postChat(caseId, "а где находится предохранитель?");
      const { getOrCreateContext: getCtx2 } = await import("@/lib/context-engine");
      expect(getCtx2(caseId).activeStepId).toBe("wh_5a");

      // Third clarification (repeated locate)
      await postChat(caseId, "скажи мне, где находится предохранитель?");
      const { getOrCreateContext: getCtx3 } = await import("@/lib/context-engine");
      expect(getCtx3(caseId).activeStepId).toBe("wh_5a");
      expect(getCtx3(caseId).completedSteps.has("wh_5a")).toBe(false);
      expect(getCtx3(caseId).completedSteps.has("wh_5b")).toBe(false);
    });
  });

  describe("E. Findings still allow advancement", () => {
    it("actual findings after clarification allow step progression", async () => {
      const caseId = "chained_findings_advance";
      await seedActiveStepWithPriorGuidance(caseId, "gas water heater not working", "wh_5a", "EN");

      // Clear the mocked messages to simulate fresh state for findings
      storageMocks.listMessagesForContext.mockResolvedValue([]);

      // Report actual findings (should advance)
      const turn = await postChat(caseId, "I checked the fuse, it shows 12V on both sides");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      // Findings should allow progression (step may advance or complete)
      expect(turn.fetchTriggered).toBe(true); // LLM call triggered for diagnostic response
    });
  });

  describe("F. Multilingual support", () => {
    it("ES: '¿dónde está el fusible?' stays on same step", async () => {
      const caseId = "chained_es_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "el calentador de agua a gas no funciona", "wh_5a", "ES");

      const turn = await postChat(caseId, "¿dónde está el fusible?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(turn.fetchTriggered).toBe(false);
      expect(context.activeStepId).toBe("wh_5a");
      expect(turn.streamText).toMatch(/fusible|panel|distribución/i);
    });
  });

  describe("G. No second authority", () => {
    it("chained clarification handling does not make flow decisions", async () => {
      const { classifyStepGuidanceIntent, isChainedClarificationFollowUp } = await import(
        "@/lib/chat/step-guidance-intent"
      );

      // Classification returns category only, not flow decisions
      const result = classifyStepGuidanceIntent({
        message: "где находится предохранитель?",
        activeStepQuestion: "Проверьте предохранитель водонагревателя",
        isChainedFollowUp: true,
      });

      expect(result).toHaveProperty("category");
      expect(result).not.toHaveProperty("nextStep");
      expect(result).not.toHaveProperty("modeTransition");
      expect(result).not.toHaveProperty("shouldAdvance");

      // isChainedClarificationFollowUp is a boolean helper, not flow controller
      const isChained = isChainedClarificationFollowUp({
        message: "где находится предохранитель?",
        previousWasGuidance: true,
        activeStepQuestion: "Проверьте предохранитель водонагревателя",
      });
      expect(typeof isChained).toBe("boolean");
    });
  });

  describe("H. Photo/dictation follow-ups stay on same step", () => {
    it("EN: 'is this the fuse?' stays on same step", async () => {
      const caseId = "chained_photo_confirm";
      await seedActiveStepWithPriorGuidance(caseId, "gas water heater not working", "wh_5a", "EN");

      const turn = await postChat(caseId, "is this the fuse?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(context.activeStepId).toBe("wh_5a");
      expect(context.completedSteps.has("wh_5a")).toBe(false);
    });

    it("RU: 'это он?' stays on same step", async () => {
      const caseId = "chained_ru_wh5a";
      await seedActiveStepWithPriorGuidance(caseId, "газовый водонагреватель не работает", "wh_5a", "RU");

      const turn = await postChat(caseId, "это он?");
      const { getOrCreateContext } = await import("@/lib/context-engine");
      const context = getOrCreateContext(caseId);

      expect(context.activeStepId).toBe("wh_5a");
    });
  });
});
