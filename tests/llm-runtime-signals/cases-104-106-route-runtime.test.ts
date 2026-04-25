/**
 * Cases 104–106 — water-heater active-procedure runtime invariants.
 *
 * Manual acceptance still showed:
 *
 *   1. Metadata leak in the actual emitted SSE for water-heater
 *      diagnostic turns (`Система:`, `Классификация:`, `Режим:`,
 *      `Статус:`, `Шаг wh_3:`, `Шаг wh_4:`).
 *
 *   2. Mixed-language solenoid evidence not promoted to report
 *      readiness — the gas-valve component-isolation pattern from
 *      the previous PR did NOT match the technician's actual wording
 *      because RU `\b` is ASCII-only and never fires after a
 *      Cyrillic verb. This PR fixes the pattern.
 *
 *   3. START FINAL REPORT after assistant invitation must produce
 *      report/draft, NOT a generic isolation-confirmation gate.
 *
 *   4. Repeated report request with no new evidence must not move
 *      the diagnostic target from one step to another.
 *
 *   5. Dimmer dense report (Case-103) MUST remain passing.
 *
 * These are ROUTE-LEVEL tests: they import the actual `POST` handler
 * and inspect the final SSE stream the technician would see.
 */

import { describe, expect, it, vi } from "vitest";
import {
  detectGenericComponentIsolation,
} from "@/lib/context-engine/context-engine";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();
const mockGetOrCreateContext = vi.fn();
const mockInitializeCase = vi.fn();
const mockGetActiveStepMetadata = vi.fn();

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
  initializeCase: (...a: unknown[]) => mockInitializeCase(...a),
  buildRegistryContext: vi.fn(() => ""),
  getActiveStepQuestion: vi.fn(() => null),
  getActiveStepMetadata: (...a: unknown[]) => mockGetActiveStepMetadata(...a),
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
  processMessage: (...a: unknown[]) => mockProcessContextMessage(...a),
  recordAgentAction: vi.fn(),
  getOrCreateContext: (...a: unknown[]) => mockGetOrCreateContext(...a),
  isInReplanState: vi.fn(() => false),
  clearReplanState: vi.fn((c) => c),
  generateAntiLoopDirectives: vi.fn(() => []),
  buildReplanNotice: vi.fn(() => ""),
  isInClarificationSubflow: vi.fn(() => false),
  buildReturnToMainInstruction: vi.fn(() => ""),
  buildClarificationContext: vi.fn(() => ""),
  popTopic: vi.fn((c) => c),
  updateContext: vi.fn(),
  isFallbackResponse: vi.fn(() => false),
  setActiveStep: vi.fn(),
  markStepCompleted: vi.fn(),
  checkLoopViolation: vi.fn(() => ({ violation: false })),
  suggestLoopRecovery: vi.fn(() => ({ action: "none", reason: "" })),
  DEFAULT_CONFIG: {},
}));

function seedMocks(opts: {
  caseId?: string;
  activeProcedureId?: string | null;
  activeStepId?: string | null;
  isolationComplete?: boolean;
  isolationFinding?: string | null;
  storedMessages?: { role: string; content: string }[];
  caseMode?: "diagnostic" | "final_report";
  llmEmits?: string;
} = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test-mock";
  mockFetch.mockReset();

  // LLM stub. The token stream emits the specified content (or a
  // safe single-token fallback). We deliberately INCLUDE the metadata
  // banner shape the live runtime was observed leaking, so the
  // sanitizer-wrap test below proves the route's emitter strips it
  // BEFORE it reaches the SSE.
  const stream = opts.llmEmits ?? "OK";
  const sseLines = stream
    .split("")
    .map(
      (ch) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: ch }, finish_reason: null }] })}\n\n`,
    )
    .join("");
  mockFetch.mockResolvedValue(
    new Response(
      sseLines +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ),
  );

  mockGetCurrentUser.mockResolvedValue({ id: "user_104_106" });
  mockStorage.getCase.mockResolvedValue({
    case: null,
    messages: opts.storedMessages ?? [],
  });
  mockStorage.ensureCase.mockResolvedValue({
    id: opts.caseId ?? "case_104",
    title: "Cases 104–106",
    userId: "user_104_106",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: opts.caseMode ?? "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue(
    opts.storedMessages ?? [],
  );
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_n" });
  mockStorage.updateCase.mockResolvedValue({ id: opts.caseId ?? "case_104" });

  const baseContext = {
    caseId: opts.caseId ?? "case_104",
    activeStepId: opts.activeStepId ?? null,
    activeProcedureId: opts.activeProcedureId ?? null,
    primarySystem: opts.activeProcedureId ?? null,
    isolationComplete: opts.isolationComplete ?? false,
    isolationFinding: opts.isolationFinding ?? null,
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
    responseInstructions: { action: "ask_step", constraints: [], antiLoopDirectives: [] },
    stateChanged: false,
    notices: [],
  });
  mockInitializeCase.mockReturnValue({
    system: opts.activeProcedureId ?? null,
    procedure: opts.activeProcedureId
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
  mockGetActiveStepMetadata.mockReturnValue(null);
}

// ── Test 1 — water-heater first turn — no metadata in final SSE ─────

describe("Cases 104–106 — water-heater first turn metadata leak ban", () => {
  it("strips Система:/Классификация:/Режим:/Статус:/Шаг wh_3: from final SSE even when LLM emits them", async () => {
    seedMocks({
      caseId: "case_wh_first",
      activeProcedureId: "water_heater",
      activeStepId: "wh_2",
      isolationComplete: false,
      // The live LLM was observed emitting the banner shape; we
      // simulate that exact emission here so the test proves the
      // sanitizer wraps and strips it on the actual route path.
      llmEmits:
        "Detected RU · Reply RU\n" +
        "Система: Водонагреватель (газовый/комбинированный)\n" +
        "Классификация: Комплексная (LP-газовая система)\n" +
        "Режим: Направленная диагностика\n" +
        "Статус: Изоляция не завершена\n\n" +
        "Шаг wh_3: Какой уровень в LP-баке?",
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_wh_first",
          message: "Не работает водонагреватель Suburban",
        }),
      }),
    );
    const stream = await response.text();
    expect(stream).not.toContain("Detected RU");
    expect(stream).not.toContain("Система:");
    expect(stream).not.toContain("Классификация:");
    expect(stream).not.toContain("Режим:");
    expect(stream).not.toContain("Статус:");
    expect(stream).not.toMatch(/Шаг\s+wh_/);
    // The legitimate question survives.
    expect(stream).toContain("Какой уровень в LP-баке");
  });

  it("strips banners regardless of mode (defense in depth — final_report mode also wrapped)", async () => {
    seedMocks({
      caseId: "case_wh_fr",
      activeProcedureId: "water_heater",
      activeStepId: null,
      isolationComplete: true,
      caseMode: "final_report",
      llmEmits:
        "Система: Водонагреватель\n" +
        "Прогресс: 5/8\n\n" +
        "Готовлю warranty report по транскрипту.",
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_wh_fr",
          message: "продолжай",
        }),
      }),
    );
    const stream = await response.text();
    expect(stream).not.toContain("Система:");
    expect(stream).not.toMatch(/Прогресс\s*:/);
    expect(stream).toContain("Готовлю warranty report");
  });
});

// ── Test 2 — mixed-language solenoid evidence detector ──────────────

describe("Cases 104–106 — generic component-isolation matches mixed-language Cyrillic-after-Latin evidence", () => {
  it("matches: 'проверил gas pressure good. проверил gas valve solenoid. solenoid не работает надо менять'", () => {
    const finding = detectGenericComponentIsolation(
      "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
      "water_heater",
    );
    expect(finding).not.toBeNull();
    expect(finding!).toMatch(/component-level isolation/i);
  });

  it("matches: pure RU 'клапан не работает. надо менять'", () => {
    const finding = detectGenericComponentIsolation(
      "проверил клапан, клапан не работает. надо менять.",
      "furnace",
    );
    expect(finding).not.toBeNull();
  });

  it("does NOT match safe diagnostic prose without the failure cue", () => {
    expect(
      detectGenericComponentIsolation(
        "проверил предохранитель, всё в порядке, продолжаю диагностику",
        "water_heater",
      ),
    ).toBeNull();
  });

  it("does NOT match without future-replacement intent", () => {
    expect(
      detectGenericComponentIsolation(
        "проверил клапан. клапан не работает.",
        "water_heater",
      ),
    ).toBeNull();
  });
});

// ── Test 3 — water-heater gas-valve report transitions to final_report ─

describe("Cases 104–106 — water-heater gas-valve report request transitions to final_report", () => {
  it("real-runtime: solenoid evidence + 'напиши репорт' under active water_heater → final_report", async () => {
    seedMocks({
      caseId: "case_wh_valve",
      activeProcedureId: "water_heater",
      activeStepId: "wh_5",
      isolationComplete: false,
      storedMessages: [],
    });
    // Simulate the post-detector context engine result.
    mockProcessContextMessage.mockReturnValueOnce({
      context: {
        caseId: "case_wh_valve",
        submode: "main",
        activeStepId: null,
        activeProcedureId: "water_heater",
        primarySystem: "water_heater",
        isolationComplete: true,
        isolationFinding:
          "Water heater component-level isolation: gas-valve solenoid failed; replacement required.",
        terminalState: {
          phase: "normal",
          faultIdentified: {
            text: "Water heater solenoid failed",
            detectedAt: new Date().toISOString(),
          },
          correctiveAction: null,
          restorationConfirmed: null,
        },
      },
      intent: { type: "MAIN_DIAGNOSTIC" },
      responseInstructions: { action: "offer_completion", constraints: [], antiLoopDirectives: [] },
      stateChanged: true,
      notices: [],
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_wh_valve",
          message:
            "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
        }),
      }),
    );
    const stream = await response.text();
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_wh_valve",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
    // No procedure-step continuation, no generic wall.
    expect(stream).not.toMatch(/Шаг\s+wh_/);
    expect(stream).not.toMatch(/Step\s+wh_/);
    expect(stream).not.toMatch(/Диагностика ещё не завершена/);
    expect(stream).not.toMatch(/12\s*В\s*DC/);
  });
});

// ── Test 4 — START FINAL REPORT after assistant invitation ──────────

describe("Cases 104–106 — START FINAL REPORT after assistant invitation produces report (no isolation gate)", () => {
  it("transitions to final_report; never emits the 'final isolation confirmation' gate", async () => {
    seedMocks({
      caseId: "case_invite",
      activeProcedureId: "water_heater",
      activeStepId: null,
      isolationComplete: false,
      storedMessages: [
        {
          role: "assistant",
          content:
            "Готовы сформировать финальный отчёт? Отправьте START FINAL REPORT, когда будете готовы.",
        },
      ],
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_invite",
          message: "START FINAL REPORT",
        }),
      }),
    );
    const stream = await response.text();
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_invite",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
    // Must NOT emit the new isolation-confirmation gate (Tier 3.5)
    // when the invitation was honoured.
    expect(stream).not.toMatch(/подтверждения изоляции неисправности/);
    expect(stream).not.toMatch(/final isolation confirmation/);
    expect(stream).not.toMatch(/Диагностика ещё не завершена/);
  });
});

// ── Test 5 — dimmer dense report regression (must still pass) ───────

describe("Cases 104–106 — dimmer dense report (Case-103 regression — must remain passing)", () => {
  it("structured-report-headers + 'Сделай отчет' transitions to final_report", async () => {
    seedMocks({
      caseId: "case_dimmer_regression",
      activeProcedureId: null,
      activeStepId: null,
      isolationComplete: false,
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_dimmer_regression",
          message: [
            "заменил выключатель в living room. Не работает. Заменил на новый. Все работает.",
            "Сделай отчет.",
            "",
            "Complaint: Dimmer not working in living room.",
            "Inspection performed: Replaced with known-good switch.",
            "Conclusion: Factory defect.",
            "Parts required: 1 dimmer.",
            "Labor: 0.5 hr.",
          ].join("\n"),
        }),
      }),
    );
    const stream = await response.text();
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_dimmer_regression",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
    expect(stream).not.toMatch(/Диагностика ещё не завершена/);
  });
});
