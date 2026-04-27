/**
 * Cases 114–118 — live UAT route-class fixes.
 *
 * Verifies final user-visible route output for:
 * - inspection report intent bypassing diagnostic gates;
 * - repeated inspection report request after a prior gate;
 * - slide & jack service guidance as maintenance how-to;
 * - step-cover actuator component evidence report readiness;
 * - existing component-isolation report behavior remaining open.
 */

import { describe, expect, it, vi } from "vitest";

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
  initializeCase: (...args: unknown[]) => mockInitializeCase(...args),
  buildRegistryContext: vi.fn(() => ""),
  getActiveStepQuestion: vi.fn(() => null),
  getActiveStepMetadata: (...args: unknown[]) => mockGetActiveStepMetadata(...args),
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

function sseFor(text: string): string {
  return text
    .split("")
    .map((ch) => `data: ${JSON.stringify({ choices: [{ delta: { content: ch }, finish_reason: null }] })}\n\n`)
    .join("") +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    "data: [DONE]\n\n";
}

function seedMocks(opts: {
  caseId?: string;
  activeProcedureId?: string | null;
  activeStepId?: string | null;
  isolationComplete?: boolean;
  storedMessages?: { role: string; content: string }[];
  llmEmits?: string;
} = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test-mock";
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(
    new Response(sseFor(opts.llmEmits ?? "OK"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
  );

  const caseId = opts.caseId ?? "case_live_uat";
  mockGetCurrentUser.mockResolvedValue({ id: "user_live_uat" });
  mockStorage.getCase.mockResolvedValue({ case: null, messages: opts.storedMessages ?? [] });
  mockStorage.ensureCase.mockResolvedValue({
    id: caseId,
    title: "Live UAT",
    userId: "user_live_uat",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue(opts.storedMessages ?? []);
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_live_uat" });
  mockStorage.updateCase.mockResolvedValue({ id: caseId });

  const baseContext = {
    caseId,
    activeStepId: opts.activeStepId ?? null,
    activeProcedureId: opts.activeProcedureId ?? null,
    primarySystem: opts.activeProcedureId ?? null,
    isolationComplete: opts.isolationComplete ?? false,
    isolationFinding: null,
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
      ? { system: opts.activeProcedureId, displayName: opts.activeProcedureId, complex: false, variant: "STANDARD", steps: [] }
      : null,
    preCompletedSteps: [],
  });
  mockGetActiveStepMetadata.mockReturnValue(
    opts.activeStepId
      ? { id: opts.activeStepId, question: "Check fuse / switch / ground?", howToCheck: "", progress: { completed: 1, total: 3 } }
      : null,
  );
}

async function postChat(caseId: string, message: string): Promise<string> {
  const { POST } = await import("@/app/api/chat/route");
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, message }),
    }),
  );
  return response.text();
}

const inspectionMessage = [
  "Новый чат. 15 Point Visual Inspection",
  "1.Tires & Wheels",
  "2.Brakes",
  "3.Lights & Electrical",
  "4.Battery System",
  "5.Propane System",
  "6.Hitch & Towing",
  "7.Suspension & Chassis",
  "8.Exterior Seals & Roof",
  "9.Water system",
  "10.Heating & Cooling",
  "11.Smoke & CO Detectors",
  "12.Fire Extinguisher",
  "13.Awning & Slide outs",
  "14.Interior Safety",
  "15.Emergency Exits.",
  "Проверил. Нашел что wheel horn работает только в режиме Air horn а в обычном режиме нет сигнала (нужна доп диаг), задние верзнии два running light not working ( нужна диагностика), d/s противотуманна фара имеет трещину ( замена по желанию клиента), d/s and p/s turn signals cameras не отображают кантинку чисто. Я протер их но это не помогло. Пологаю подлежат замене если клиент захочет. 7 spot ceiling lights are not working ( заказ и замена по желанию клиента), bedroom d/s slide toper провисает не натянут как положено, выглядит как он наматывается неправильно или же пружина ослабла. Нужна доп диагностика. Emergency stuff is expired. Сделай отчет с перечислением этих проблем по итогам инспекции",
].join("\n");

describe("Cases 117/118 — inspection report route", () => {
  it("generates a customer inspection report without diagnostic gate or LP question", async () => {
    seedMocks({
      caseId: "case_117_inspection",
      llmEmits: "Inspection report: 15-point visual inspection performed. Wheel horn standard mode no signal — further diagnostic required. Rear upper running lights not working — further diagnostic required. Fog light lens cracked — replacement with customer approval. Emergency equipment expired. Labor 1.0 hr.",
    });

    const stream = await postChat("case_117_inspection", inspectionMessage);
    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_117_inspection", expect.objectContaining({ mode: "final_report" }));
    expect(stream).toContain("15-point visual inspection performed");
    expect(stream).toContain("further diagnostic required");
    expect(stream).toContain("customer approval");
    expect(stream).not.toContain("остался один шаг");
    expect(stream).not.toContain("Gas leak detector");
  });

  it("honours repeated 'I already wrote it, make report for client' after prior inspection findings", async () => {
    seedMocks({
      caseId: "case_118_repeat",
      storedMessages: [
        { role: "user", content: inspectionMessage },
        { role: "assistant", content: "Понял — отчёт нужен. Остался один шаг." },
      ],
      activeProcedureId: "lp_gas",
      activeStepId: "lpg_3",
      llmEmits: "Customer inspection report generated from listed inspection findings. Further diagnostic required where stated. Replacement by customer approval where stated.",
    });

    const stream = await postChat("case_118_repeat", "Я все написал выше. Просто сделай отчет для клиента.");
    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_118_repeat", expect.objectContaining({ mode: "final_report" }));
    expect(stream).toContain("Customer inspection report");
    expect(stream).not.toContain("остался один шаг");
    expect(stream).not.toContain("Gas leak detector");
  });
});

describe("Case 116 — slide & jack service guidance", () => {
  it("answers as safe maintenance how-to, not active diagnostic continuation", async () => {
    seedMocks({ caseId: "case_116_service" });
    const stream = await postChat(
      "case_116_service",
      "I need slide&jack service. Объясни мне как это сделать правильно в первый раз",
    );

    expect(stream).toContain("service/maintenance");
    expect(stream).toContain("slide & jack service");
    expect(stream).toContain("Не работайте под coach");
    expect(stream).not.toContain("Уточните, пожалуйста, последний результат");
    expect(stream).not.toContain("текущего диагностического");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("Cases 114/115 — step cover actuator component evidence", () => {
  it("routes actuator replacement evidence + report request to final_report without generic electrical loop", async () => {
    seedMocks({
      caseId: "case_115_step_cover",
      activeProcedureId: "electrical_12v",
      activeStepId: "el_ground",
      storedMessages: [
        { role: "user", content: "ASHLEY POSS EXT WARR CS STEP COVER DOES NOT COME OUT WHEN TRAVELING TO COVER THE STEPS. Это alegro bus. Tiffin. Слышу гудение мотора но cover не открывается." },
        { role: "user", content: "Нет доступа к мотору. Cover застрял и не выдвигается." },
        { role: "user", content: "Не двигается. Есть гудение но не двигается. Нет микродвижения." },
        { role: "user", content: "Доступ к механизму идет под генератором и проблема в step cover actuator." },
        { role: "user", content: "Не могу измерить без снятия актуатора. Надо заказать запчасть а потом сразу снять и заменить." },
        { role: "user", content: "Power есть. Сломан штифт" },
        { role: "user", content: "Да все работает. Нужно менять актуатор" },
      ],
      llmEmits: "Report: complaint step cover does not extend. Tiffin Allegro Bus. Motor hums but cover does not move. Access under generator. Broken pin / actuator failure; order and replace step cover actuator, then verify operation.",
    });

    const stream = await postChat("case_115_step_cover", "Напиши репорт");
    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_115_step_cover", expect.objectContaining({ mode: "final_report" }));
    expect(stream).toContain("step cover does not extend");
    expect(stream).toContain("Broken pin");
    expect(stream).toContain("replace step cover actuator");
    expect(stream).not.toContain("Check the circuit breaker or fuse");
    expect(stream).not.toContain("Verify ground continuity");
    expect(stream).not.toContain("Диагностика ещё не завершена");
  });
});

describe("Preserve existing component report readiness", () => {
  it("keeps mixed-language water-heater solenoid evidence report-ready", async () => {
    seedMocks({
      caseId: "case_preserve_solenoid",
      activeProcedureId: "water_heater",
      activeStepId: "wh_5",
      llmEmits: "Final report: water heater gas-valve solenoid failed; replacement required.",
    });

    const stream = await postChat(
      "case_preserve_solenoid",
      "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
    );

    expect(mockStorage.updateCase).toHaveBeenCalledWith("case_preserve_solenoid", expect.objectContaining({ mode: "final_report" }));
    expect(stream).toContain("solenoid failed");
    expect(stream).not.toContain("Диагностика ещё не завершена");
  });
});