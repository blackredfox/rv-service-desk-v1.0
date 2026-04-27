/**
 * Cases 107–110 — water-heater runtime invariants (post-Cases-104–106).
 *
 * Manual acceptance after the previous PR still showed:
 *
 *   1. Case 107 — water-heater first-turn metadata leak in the
 *      PERSISTED assistant message. The streaming SSE was already
 *      sanitized by the previous PR, but `appendAssistantChatMessage`
 *      was saving the raw `full` snapshot, so reloading the case
 *      re-exposed `Система:`, `Классификация:`, `Режим:`, `Статус:`,
 *      `Первый действительный шаг:`. The route now sanitizes `full`
 *      before persistence in diagnostic mode.
 *
 *   2. Cases 108/109 — restored-operation terminal-state regression.
 *      After explicit fuse-replacement evidence ("предохранитель не
 *      работал", "заменил", "теперь водонагреватель исправен", "да,
 *      восстановился") the runtime continued asking diagnostic
 *      checklist questions (wh_5b, wh_5c, wh_9). Context Engine
 *      patterns now recognize each of these phrases as restoration
 *      evidence, dominating step assignment.
 *
 *   3. Case 110 — START FINAL REPORT invitation/gate loop. The
 *      assistant invited the technician to send `START FINAL REPORT`,
 *      the technician complied, the route emitted the isolation gate
 *      (which itself does NOT contain the literal phrase), so the
 *      next `START FINAL REPORT` was rejected by the SAME gate
 *      because `wasFinalReportInvitedRecently` only inspected the
 *      most-recent assistant turn. The helper now treats an earlier
 *      invitation as still pending until a generated final-report
 *      draft has consumed it.
 *
 *   4. Case 110 — repeated `wh_10` step. Technician answered "все
 *      чисто" and the assistant re-emitted the same `wh_10`
 *      question. `isStepAnswered` now recognizes affirmative
 *      "everything-clean" answers in RU/EN/ES.
 *
 * These are ROUTE-LEVEL tests that assert the FINAL user-visible
 * SSE output and the PERSISTED assistant snapshot.
 */

import { describe, expect, it, vi } from "vitest";
import {
  detectGenericComponentIsolation,
} from "@/lib/context-engine/context-engine";
import { sanitizeText } from "@/lib/chat/diagnostic-output-sanitizer";
import { wasFinalReportInvitedRecently } from "@/lib/chat/response-governance-policy";
import { isStepAnswered } from "@/lib/mode-validators";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();
const mockGetOrCreateContext = vi.fn();
const mockInitializeCase = vi.fn();
const mockGetActiveStepMetadata = vi.fn();
const appendMessageSpy = vi.fn();

const mockStorage = {
  getCase: vi.fn(),
  ensureCase: vi.fn(),
  listMessagesForContext: vi.fn(),
  appendMessage: appendMessageSpy,
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
  appendMessageSpy.mockReset();
  process.env.OPENAI_API_KEY = "sk-test-mock";
  mockFetch.mockReset();

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

  mockGetCurrentUser.mockResolvedValue({ id: "user_107_110" });
  mockStorage.getCase.mockResolvedValue({
    case: null,
    messages: opts.storedMessages ?? [],
  });
  mockStorage.ensureCase.mockResolvedValue({
    id: opts.caseId ?? "case_107",
    title: "Cases 107–110",
    userId: "user_107_110",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: opts.caseMode ?? "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue(
    opts.storedMessages ?? [],
  );
  appendMessageSpy.mockResolvedValue({ id: "msg_n" });
  mockStorage.updateCase.mockResolvedValue({ id: opts.caseId ?? "case_107" });

  const baseContext = {
    caseId: opts.caseId ?? "case_107",
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

// ── Case 107 — first-turn metadata leak in PERSISTED message ────────

describe("Case 107 — water-heater first turn — banner labels do NOT leak into the persisted assistant message", () => {
  it("strips banners from `full` before appendAssistantChatMessage, not just from the SSE stream", async () => {
    seedMocks({
      caseId: "case_107_first",
      activeProcedureId: "water_heater",
      activeStepId: "wh_2",
      isolationComplete: false,
      llmEmits:
        "Система: Водонагреватель (газовый/комбинированный)\n" +
        "Классификация: Сложное оборудование\n" +
        "Режим: Руководимая диагностика\n" +
        "Статус: Локализация не завершена\n" +
        "Первый действительный шаг:\n\n" +
        "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_107_first",
          message: "Не работает водонагреватель Suburban",
        }),
      }),
    );
    const stream = await response.text();
    expect(stream).not.toContain("Система:");
    expect(stream).not.toContain("Классификация:");
    expect(stream).not.toContain("Режим:");
    expect(stream).not.toContain("Статус:");
    expect(stream).not.toMatch(/Первый\s+(?:[\wа-яё]+\s+)?шаг\s*:/iu);
    // Legitimate question survives.
    expect(stream).toContain("Какой уровень в LP-баке");

    // Persisted assistant message MUST be stripped too — otherwise
    // case reload re-exposes the banners.
    const assistantSaves = appendMessageSpy.mock.calls.filter(
      (call) => (call[0]?.role ?? call[1]?.role) === "assistant",
    );
    expect(assistantSaves.length).toBeGreaterThan(0);
    for (const call of assistantSaves) {
      const persistedContent =
        (call[0]?.content as string | undefined) ??
        (call[1]?.content as string | undefined) ??
        "";
      expect(persistedContent).not.toMatch(/^\s*Система\s*:/m);
      expect(persistedContent).not.toMatch(/^\s*Классификация\s*:/m);
      expect(persistedContent).not.toMatch(/^\s*Режим\s*:/m);
      expect(persistedContent).not.toMatch(/^\s*Статус\s*:/m);
      expect(persistedContent).not.toMatch(/^\s*Первый\s+(?:[\wа-яё]+\s+)?шаг\s*:/imu);
      expect(persistedContent).not.toMatch(/Шаг\s+wh_/iu);
    }
  });
});

// ── sanitizeText helper unit ────────────────────────────────────────

describe("Case 107 — sanitizeText helper", () => {
  it("strips the full banner block while preserving the legitimate question text", () => {
    const out = sanitizeText(
      [
        "Система: Водонагреватель (газовый/комбинированный)",
        "Классификация: Сложное оборудование",
        "Режим: Руководимая диагностика",
        "Статус: Локализация не завершена",
        "Первый действительный шаг:",
        "",
        "Какой уровень в LP-баке — показание указателя или проверка по весу?",
      ].join("\n"),
      { replyLanguage: "RU" },
    );
    expect(out).not.toMatch(/Система\s*:/);
    expect(out).not.toMatch(/Классификация\s*:/);
    expect(out).not.toMatch(/Режим\s*:/);
    expect(out).not.toMatch(/Статус\s*:/);
    expect(out).not.toMatch(/Первый\s+(?:[\wа-яё]+\s+)?шаг\s*:/iu);
    expect(out).toContain("Какой уровень в LP-баке");
  });

  it("strips inline `Шаг wh_*:` step prefixes from a single-line emission", () => {
    const out = sanitizeText(
      "Принято. Шаг wh_3: Работают ли другие LP-приборы?",
      { replyLanguage: "RU" },
    );
    expect(out).not.toMatch(/Шаг\s+wh_/iu);
    expect(out).toContain("Работают ли другие LP-приборы");
  });
});

// ── Cases 108/109 — restored-operation terminal-state evidence ──────

describe("Cases 108/109 — restored-operation evidence promotes terminal state", () => {
  it("'Заменил. Теперь водонагреватель исправен' triggers restoration recognition (regression baseline)", async () => {
    // Use the public Context Engine through the registry shape.
    const ctx = await import("@/lib/context-engine/context-engine");
    const caseId = "case_109_fuse_a";
    ctx.clearContext(caseId);
    const c0 = ctx.getOrCreateContext(caseId, "water_heater", "complex");
    // Simulate prior diagnostic work so MIN_STEPS_FOR_COMPLETION is met.
    c0.completedSteps.add("wh_1");
    c0.completedSteps.add("wh_2");
    ctx.updateContext(c0);
    const result = ctx.processMessage(
      caseId,
      "Проверил. Предохранитель не работал. Заменил. Теперь водонагреватель исправен.",
    );
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.activeStepId).toBeNull();
    expect(result.context.terminalState.phase).toBe("terminal");
  });

  it("'я заменил предохранитель. Проблема устранена' triggers restoration recognition", async () => {
    const ctx = await import("@/lib/context-engine/context-engine");
    const caseId = "case_109_fuse_b";
    ctx.clearContext(caseId);
    const c0 = ctx.getOrCreateContext(caseId, "water_heater", "complex");
    c0.completedSteps.add("wh_1");
    ctx.updateContext(c0);
    const result = ctx.processMessage(
      caseId,
      "я заменил предохранитель. Проблема устранена.",
    );
    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.activeStepId).toBeNull();
  });

  it("'да, восстановился' AFTER fault_candidate transitions to terminal", async () => {
    const ctx = await import("@/lib/context-engine/context-engine");
    const caseId = "case_109_restored";
    ctx.clearContext(caseId);
    const c0 = ctx.getOrCreateContext(caseId, "water_heater", "complex");
    // Simulate prior fault detection.
    c0.completedSteps.add("wh_1");
    c0.terminalState = {
      phase: "fault_candidate",
      faultIdentified: {
        text: "Предохранитель не работал",
        detectedAt: new Date().toISOString(),
      },
      correctiveAction: null,
      restorationConfirmed: null,
    };
    c0.activeStepId = null;
    ctx.updateContext(c0);
    const result = ctx.processMessage(caseId, "да, восстановился");
    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.activeStepId).toBeNull();
  });

  it("'предохранитель не работал' is recognized as a fault (paired component)", async () => {
    const ctx = await import("@/lib/context-engine/context-engine");
    const caseId = "case_108_fault_baseline";
    ctx.clearContext(caseId);
    const c0 = ctx.getOrCreateContext(caseId, "water_heater", "complex");
    c0.completedSteps.add("wh_1");
    ctx.updateContext(c0);
    const result = ctx.processMessage(
      caseId,
      "проверил питание — предохранитель не работал.",
    );
    // Either fault_candidate (awaits restoration) or terminal — both
    // are acceptable. The forbidden state is `phase === "normal"`,
    // because that means we'd keep asking checklist questions.
    expect(result.context.terminalState.phase).not.toBe("normal");
  });

  it("does NOT misfire on safe diagnostic prose (regression guard)", async () => {
    const ctx = await import("@/lib/context-engine/context-engine");
    const caseId = "case_109_safe";
    ctx.clearContext(caseId);
    const c0 = ctx.getOrCreateContext(caseId, "water_heater", "complex");
    c0.completedSteps.add("wh_1");
    ctx.updateContext(c0);
    const result = ctx.processMessage(
      caseId,
      "проверил предохранитель, всё в порядке, продолжаю диагностику.",
    );
    // No fault claim, no replacement — must remain normal.
    expect(result.context.terminalState.phase).toBe("normal");
  });
});

// ── Case 110 — START FINAL REPORT invitation/gate loop ──────────────

describe("Case 110 — START FINAL REPORT invitation persists through intermediate gate response", () => {
  it("wasFinalReportInvitedRecently returns true even when the latest assistant turn is the gate response", () => {
    expect(
      wasFinalReportInvitedRecently([
        {
          role: "assistant",
          content: "Если хотите отчёт сейчас, отправьте START FINAL REPORT.",
        },
        { role: "user", content: "START FINAL REPORT" },
        {
          role: "assistant",
          content:
            "Понял — отчёт нужен. Чтобы оформить отчёт, мне не хватает только подтверждения изоляции неисправности по текущему случаю.",
        },
      ]),
    ).toBe(true);
  });

  it("route honours an earlier invitation when the technician sends START FINAL REPORT after a gate response", async () => {
    seedMocks({
      caseId: "case_110_invite_loop",
      activeProcedureId: "water_heater",
      activeStepId: null,
      isolationComplete: false,
      storedMessages: [
        {
          role: "assistant",
          content: "Если хотите отчёт сейчас, отправьте START FINAL REPORT.",
        },
        { role: "user", content: "START FINAL REPORT" },
        {
          role: "assistant",
          content:
            "Понял — отчёт нужен. Чтобы оформить отчёт, мне не хватает только подтверждения изоляции неисправности по текущему случаю.",
        },
      ],
    });
    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: "case_110_invite_loop",
          message: "START FINAL REPORT",
        }),
      }),
    );
    const stream = await response.text();
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_110_invite_loop",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
    // Must NOT loop back into the same isolation gate response.
    expect(stream).not.toMatch(/подтверждения изоляции неисправности/);
    expect(stream).not.toMatch(/Диагностика ещё не завершена/);
  });

  it("does NOT honour an invitation that has already been consumed by a generated final-report draft", () => {
    expect(
      wasFinalReportInvitedRecently([
        {
          role: "assistant",
          content: "Если хотите отчёт сейчас, отправьте START FINAL REPORT.",
        },
        { role: "user", content: "START FINAL REPORT" },
        {
          role: "assistant",
          content: [
            "Complaint: Water heater not heating.",
            "Diagnostic Procedure: Verified gas, voltage, fuse.",
            "Verified Condition: Fuse failed.",
            "Recommended Corrective Action: Confirm restoration after restart.",
          ].join("\n"),
        },
      ]),
    ).toBe(false);
  });
});

// ── Case 110 — repeated wh_10 step loop ─────────────────────────────

describe("Case 110 — repeated wh_10 step loop fix (`все чисто` recognized as answered)", () => {
  it("isStepAnswered recognizes 'все чисто' as a valid answer to a visual-inspection question", () => {
    expect(
      isStepAnswered(
        "все чисто",
        "Состояние горелочной трубки и жиклёра: видны ли засорение, коррозия, насекомые или повреждения?",
      ),
    ).toBe(true);
  });

  it("isStepAnswered recognizes English / Spanish equivalents", () => {
    expect(isStepAnswered("all clean", "Burner tube condition?")).toBe(true);
    expect(isStepAnswered("nothing visible", "Burner tube condition?")).toBe(true);
    expect(isStepAnswered("todo limpio", "Estado del tubo del quemador?")).toBe(true);
  });

  it("does NOT misclassify open-ended descriptions as answered", () => {
    // An ambiguous half-sentence without a value/conclusion cue should
    // still NOT be auto-completed.
    expect(
      isStepAnswered("я смотрю на трубку и думаю что", "Burner tube condition?"),
    ).toBe(false);
  });
});

// ── Cases 105/106 regression — must remain passing ──────────────────

describe("Cases 105/106 — regression checks (must remain passing)", () => {
  it("water-heater solenoid evidence + 'напиши репорт' transitions to final_report", async () => {
    seedMocks({
      caseId: "case_solenoid_regression",
      activeProcedureId: "water_heater",
      activeStepId: "wh_5",
      isolationComplete: false,
    });
    mockProcessContextMessage.mockReturnValueOnce({
      context: {
        caseId: "case_solenoid_regression",
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
            text: "solenoid failed",
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
          caseId: "case_solenoid_regression",
          message:
            "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
        }),
      }),
    );
    const stream = await response.text();
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_solenoid_regression",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
  });

  it("dimmer dense report (Case-103) — structured headers + 'Сделай отчет' still transitions", async () => {
    seedMocks({
      caseId: "case_dimmer_107",
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
          caseId: "case_dimmer_107",
          message: [
            "заменил выключатель в living room. Не работает. Заменил. Все работает. Сделай отчет.",
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
      "case_dimmer_107",
      expect.objectContaining({ mode: "final_report" }),
    );
    expect(stream).toContain('"type":"mode","mode":"final_report"');
  });

  it("generic component-isolation detector still matches mixed-language solenoid evidence", () => {
    const finding = detectGenericComponentIsolation(
      "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
      "water_heater",
    );
    expect(finding).not.toBeNull();
  });
});
