/**
 * Cases 100–103 manual-acceptance follow-up — runtime-level
 * report-intent generalization tests.
 *
 * These are ROUTE-LEVEL tests (not helper-level): they import the
 * actual Next.js route handler `POST` from `@/app/api/chat/route`,
 * invoke it with the real failing transcript shapes, and inspect
 * the final SSE stream that reaches the technician.
 *
 * Three runtime invariants are pinned here:
 *
 *   1. Dimmer dense report request — when the technician submits a
 *      structured shop-style narrative (Complaint / Inspection /
 *      Conclusion / Parts / Labor) AND there is no active procedure,
 *      the route MUST transition to `final_report` instead of
 *      emitting the legacy generic wall.
 *
 *   2. START FINAL REPORT after invitation — when the previous
 *      assistant turn invited START FINAL REPORT and the technician
 *      complies, the route MUST transition to `final_report`. It
 *      MUST NOT emit a gate response.
 *
 *   3. Water-heater gas-valve / solenoid component-isolation — when
 *      the technician's message contains diagnostic verification +
 *      component failure + future-replacement intent inside an
 *      active procedure context, the Context Engine flips
 *      isolation-complete (via the generalized component-isolation
 *      detector) and the route transitions to `final_report`. It
 *      MUST NOT continue asking the next procedural step.
 *
 * Tests are deterministic: storage, auth, the registry, the context
 * engine, and the OpenAI client are mocked. No live LLM key required.
 */

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
  getBranchState: vi.fn(() => ({
    activeBranchId: null,
    decisionPath: [],
    lockedOutBranches: [],
  })),
  exitBranch: vi.fn(),
  scanMessageForSubtypeAssertions: vi.fn(() => []),
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

function seedMocks(opts?: {
  caseId?: string;
  activeProcedureId?: string | null;
  activeStepId?: string | null;
  isolationComplete?: boolean;
  isolationFinding?: string | null;
  storedMessages?: { role: string; content: string }[];
  caseMode?: "diagnostic" | "final_report";
}) {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test-mock";
  mockFetch.mockReset();

  // Default LLM stub — emits a single token so the route streams a
  // valid SSE end-of-turn. The route's diagnostic-output sanitizer is
  // applied to this stream when mode is `diagnostic`. For
  // `final_report` we still get a single completion call.
  mockFetch.mockResolvedValue(new Response(
    'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  ));

  mockGetCurrentUser.mockResolvedValue({ id: "user_cases_100_103" });
  mockStorage.getCase.mockResolvedValue({
    case: null,
    messages: opts?.storedMessages ?? [],
  });
  mockStorage.ensureCase.mockResolvedValue({
    id: opts?.caseId ?? "case_100_103",
    title: "Cases 100–103",
    userId: "user_cases_100_103",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: opts?.caseMode ?? "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue(
    opts?.storedMessages ?? [],
  );
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_n" });
  mockStorage.updateCase.mockResolvedValue({ id: opts?.caseId ?? "case_100_103" });

  const baseContext = {
    caseId: opts?.caseId ?? "case_100_103",
    activeStepId: opts?.activeStepId ?? null,
    activeProcedureId: opts?.activeProcedureId ?? null,
    primarySystem: opts?.activeProcedureId ?? null,
    isolationComplete: opts?.isolationComplete ?? false,
    isolationFinding: opts?.isolationFinding ?? null,
    terminalState: {
      phase: "normal" as const,
      faultIdentified: null,
      correctiveAction: null,
      restorationConfirmed: null,
    },
  };

  mockGetOrCreateContext.mockReturnValue(baseContext);
  mockProcessContextMessage.mockReturnValue({
    context: { ...baseContext, submode: "main" },
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
    system: opts?.activeProcedureId ?? null,
    procedure: opts?.activeProcedureId
      ? {
          system: opts.activeProcedureId,
          displayName: opts.activeProcedureId,
          complex: false,
          variant: "STANDARD",
          steps: [],
        }
      : null,
    preCompletedSteps: [],
  });
}

// ── Case 100/103 — Dimmer dense report (no active procedure) ────────

describe("Cases 100–103 — dimmer dense report no longer generic-walls", () => {
  beforeEach(() =>
    seedMocks({
      caseId: "case_dimmer",
      activeProcedureId: null,
      activeStepId: null,
      isolationComplete: false,
      storedMessages: [],
    }),
  );

  it("structured shop-style narrative + 'Сделай отчет' transitions to final_report", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const message = [
      "заменил выключатель в living room. Не работает изменение яркости света. Взял другой выключатель. Заменил. Все работает. Похоже дефект фабрики.",
      "Сделай отчет.",
      "",
      "Complaint: Dimmer switches not changing light brightness in living room.",
      "Inspection performed: Replaced living room dimmer switch with a known-good unit; brightness adjustment now works. Bathroom dimmer not yet replaced — factory defect suspected.",
      "Conclusion: Factory-defect dimmer; replacement required for bathroom unit on next visit.",
      "Parts required: 1× dimmer switch (bathroom).",
      "Labor: 0.5 hr.",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dimmer", message }),
    }));

    const streamText = await response.text();

    // Mode transition to final_report MUST happen.
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_dimmer",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    // No legacy generic wall.
    expect(streamText).not.toMatch(/Диагностика ещё не завершена/);
    expect(streamText).not.toMatch(
      /Diagnostics are not yet complete\. Let's continue/,
    );
  });

  it("non-structured short report request stays in diagnostic mode (Tier 4 last-resort wall is still allowed)", async () => {
    // Sanity contrast: a bare 'write report' with NO structured headers
    // and NO active procedure does NOT auto-transition.
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_dimmer", message: "write report" }),
    }));
    const streamText = await response.text();
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_dimmer",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
  });
});

// ── START FINAL REPORT after invitation invariant ───────────────────

describe("Cases 100–103 — START FINAL REPORT honoured after assistant invitation", () => {
  it("transitions to final_report when prior assistant turn invited it", async () => {
    seedMocks({
      caseId: "case_invitation",
      activeProcedureId: "water_heater",
      activeStepId: null,
      isolationComplete: false,
      // Stored history includes the assistant's prior invitation.
      storedMessages: [
        {
          role: "assistant",
          content:
            "Готовы сформировать финальный отчёт? Отправьте START FINAL REPORT, когда будете готовы.",
        },
      ],
    });
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_invitation",
        message: "START FINAL REPORT",
      }),
    }));
    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_invitation",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    // Must NOT emit the legacy wall NOR the new "I still need
    // isolation confirmation" gate when the invitation was honoured.
    expect(streamText).not.toMatch(/Диагностика ещё не завершена/);
    expect(streamText).not.toMatch(/подтверждения изоляции неисправности/);
  });

  it("without prior invitation, START FINAL REPORT alone does NOT auto-transition (gate response)", async () => {
    seedMocks({
      caseId: "case_no_invitation",
      activeProcedureId: "water_heater",
      activeStepId: "wh_5",
      isolationComplete: false,
      storedMessages: [],
    });
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_no_invitation",
        message: "START FINAL REPORT",
      }),
    }));
    const streamText = await response.text();

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_no_invitation",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
  });
});

// ── Water-heater component-isolation generalization ─────────────────

describe("Cases 100–103 — water-heater gas-valve component isolation transitions to final_report", () => {
  it("technician verifies gas pressure, identifies bad solenoid, requires replacement, asks for report → final_report", async () => {
    // Simulate Context Engine returning isolationComplete=true after
    // its post-message processing — the generalized
    // detectGenericComponentIsolation path that we wired into
    // `processMessage` would set this for active procedure
    // `water_heater`. Here we mock that side-effect directly so the
    // route-level test exercises the post-context branch deterministically.
    seedMocks({
      caseId: "case_wh_valve",
      activeProcedureId: "water_heater",
      activeStepId: null,
      isolationComplete: false,
    });
    mockProcessContextMessage.mockReturnValueOnce({
      context: {
        caseId: "case_wh_valve",
        submode: "main",
        activeStepId: null,
        activeProcedureId: "water_heater",
        primarySystem: "water_heater",
        isolationComplete: true,
        isolationFinding:
          "Water heater component-level isolation: technician verified gas pressure, gas-valve solenoid is failed; replacement required.",
        terminalState: {
          phase: "normal",
          faultIdentified: {
            text: "Water heater component-level isolation: solenoid failed",
            detectedAt: new Date().toISOString(),
          },
          correctiveAction: null,
          restorationConfirmed: null,
        },
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: {
        action: "offer_completion",
        constraints: [],
        antiLoopDirectives: [],
      },
      stateChanged: true,
      notices: [],
    });
    const { POST } = await import("@/app/api/chat/route");

    const message =
      "Не работает водонагреватель Suburban. бак полный, вентиль бака полностью открыт. да, все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт";

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_wh_valve", message }),
    }));
    const streamText = await response.text();

    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_wh_valve",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
    // No procedure-step continuation.
    expect(streamText).not.toMatch(/Шаг\s+wh_/);
    expect(streamText).not.toMatch(/Step\s+wh_/);
    // No legacy generic wall.
    expect(streamText).not.toMatch(/Диагностика ещё не завершена/);
  });
});
