/**
 * Report-Ready / Documentation-Surface Recognition — Regression Pack
 *
 * Covers the acceptance blockers around how the runtime responds when
 * the technician explicitly requests a documentation surface (warranty
 * report, final report, authorization request, portal cause, etc.) but
 * the Context Engine's readiness gate is not yet satisfied.
 *
 * Doctrine preserved (must not regress):
 *   - docs/CUSTOMER_BEHAVIOR_SPEC.md §2 (unresolved diagnostics continue
 *     diagnostics) and §5–§6 (output-surface legality, prohibited
 *     premature outputs)
 *   - ARCHITECTURE_RULES A1 (Context Engine single flow authority)
 *   - ARCHITECTURE_RULES B3 (no questionnaire-first fake report
 *     collection for unresolved diagnostics)
 *   - ARCHITECTURE_RULES G1a / G1b (incomplete isolation continues
 *     diagnostics; no hidden second brain)
 *   - ROADMAP §7.1 / §7.3 (PR1 invariants preserved: no wording-
 *     inferred readiness; no questionnaire-first fallback)
 *
 * Expected behavior (what this PR introduces):
 *   When hasBoundedReportRequest is true and runtime readiness is not
 *   satisfied, the deferral response MUST:
 *     (a) acknowledge the requested documentation surface by name,
 *     (b) state that diagnostics are not yet complete,
 *     (c) quote the Context-Engine-authoritative next step verbatim
 *         when one is available (degenerate safely to a generic
 *         continuation when not),
 *     (d) NOT ask any report-field questionnaire questions
 *         (complaint / findings / repair / labor / parts),
 *     (e) NOT unlock any mode transition,
 *     (f) NOT emit any final-output surface event,
 *     (g) NOT invent facts or claim transcript evidence is verified.
 *
 * Tests use deterministic mocked storage / auth / engine / registry
 * fixtures. No live LLM is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetCurrentUser = vi.fn();
const mockProcessContextMessage = vi.fn();
const mockGetOrCreateContext = vi.fn();
const mockGetActiveStepMetadata = vi.fn();
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
  getActiveStepMetadata: (...args: unknown[]) => mockGetActiveStepMetadata(...args),
  forceStepComplete: vi.fn(),
  isProcedureFullyComplete: vi.fn(() => false),
  markStepCompleted: vi.fn(),
  markStepUnable: vi.fn(),
  getNextStepId: vi.fn(() => null),
  processResponseForBranch: vi.fn(() => ({ branchEntered: null, lockedOut: [] })),
  getBranchState: vi.fn(() => ({ activeBranchId: null, decisionPath: [], lockedOutBranches: [] })),
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

type SeedArgs = {
  language?: "EN" | "RU" | "ES";
  activeStepId?: string | null;
  activeProcedureId?: string | null;
  activeStepQuestion?: string | null;
  activeProcedureName?: string | null;
  isolationComplete?: boolean;
  terminalPhase?: "normal" | "fault_candidate" | "terminal";
};

function seedMocks(args: SeedArgs = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  mockFetch.mockReset();
  process.env.OPENAI_API_KEY = "sk-test-mock";

  const language = args.language ?? "EN";

  mockGetCurrentUser.mockResolvedValue({ id: "user_rr" });
  mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
  mockStorage.ensureCase.mockResolvedValue({
    id: "case_rr",
    title: "Report-Ready Case",
    userId: "user_rr",
    inputLanguage: language,
    languageSource: "AUTO",
    mode: "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue([]);
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_rr" });
  mockStorage.updateCase.mockResolvedValue({ id: "case_rr" });

  const engineContext = {
    caseId: "case_rr",
    activeStepId: args.activeStepId ?? null,
    activeProcedureId: args.activeProcedureId ?? null,
    primarySystem: args.activeProcedureId ?? null,
    isolationComplete: args.isolationComplete ?? false,
    isolationFinding: null,
    terminalState: {
      phase: args.terminalPhase ?? "normal",
      faultIdentified: null,
      correctiveAction: null,
      restorationConfirmed: null,
    },
  };

  mockGetOrCreateContext.mockReturnValue(engineContext);
  mockProcessContextMessage.mockReturnValue({
    context: engineContext,
    intent: { type: "MAIN_DIAGNOSTIC" },
    responseInstructions: {
      action: "ask_step",
      constraints: [],
      antiLoopDirectives: [],
    },
    stateChanged: false,
    notices: [],
  });

  if (args.activeStepId && args.activeStepQuestion) {
    mockGetActiveStepMetadata.mockReturnValue({
      id: args.activeStepId,
      question: args.activeStepQuestion,
      howToCheck: null,
      procedureName: args.activeProcedureName ?? "Water Heater (Gas/Combo)",
      progress: { completed: 2, total: 12 },
    });
  } else {
    mockGetActiveStepMetadata.mockReturnValue(null);
  }

  mockInitializeCase.mockReturnValue({
    system: args.activeProcedureId ?? "water_heater",
    procedure: {
      system: args.activeProcedureId ?? "water_heater",
      displayName: args.activeProcedureName ?? "Water Heater (Gas/Combo)",
      complex: true,
      variant: "STANDARD",
      steps: [],
    },
    preCompletedSteps: [],
  });
}

// ── A. Water pump report request — dead-end failure mode ──────────────

describe("Report-ready surface recognition — water pump (A)", () => {
  beforeEach(() => {
    seedMocks({
      language: "EN",
      activeStepId: "wp_3",
      activeProcedureId: "water_pump",
      activeStepQuestion: "Measure direct 12V at the pump terminals while commanded ON. What does your meter read?",
      activeProcedureName: "Water Pump",
    });
  });

  it("explicit warranty-report request with unresolved engine state emits a surface-aware deferral, not a generic one-liner", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_rr",
        message: "write warranty report",
      }),
    }));

    const streamText = await response.text();

    // (a) Surface-aware acknowledgment — explicit mention of the
    // requested surface by its correct human label.
    expect(streamText).toMatch(/warranty report/i);

    // (b) Still communicates that diagnostics are not yet complete.
    expect(streamText).toContain("diagnostics are not yet complete");

    // (c) Quotes the Context-Engine-authoritative next step verbatim.
    expect(streamText).toContain(
      "Measure direct 12V at the pump terminals while commanded ON. What does your meter read?",
    );

    // (d) No questionnaire-first report-field collection.
    expect(streamText).not.toContain("what was the complaint");
    expect(streamText).not.toContain("what did you find");
    expect(streamText).not.toContain("what repair you");
    expect(streamText).not.toContain("what labor");
    expect(streamText).not.toContain("what parts");

    // (e) No mode transition triggered by wording alone.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });

    // (f) Case remains in diagnostic mode in the SSE envelope.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');

    // (g) No LLM call for final-report generation.
    expect(mockFetch).not.toHaveBeenCalled();

    // NOT the old dead-end one-liner.
    expect(streamText).not.toContain("Let\u2019s continue with the current step before generating the report.");
  });

  it("alternate aliases (\"prepare the report\", \"generate the warranty report\") produce the same surface-aware deferral", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_rr",
        message: "START FINAL REPORT",
      }),
    }));

    const streamText = await response.text();

    expect(streamText).toMatch(/(final|warranty|retail)\s+report/i);
    expect(streamText).toContain("diagnostics are not yet complete");
    expect(streamText).toContain(
      "Measure direct 12V at the pump terminals while commanded ON. What does your meter read?",
    );
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
  });
});

// ── B. Dimmer documentation request — no irrelevant pivot ─────────────

describe("Report-ready surface recognition — dimmer (B)", () => {
  beforeEach(() => {
    seedMocks({
      language: "EN",
      activeStepId: "dm_4",
      activeProcedureId: "lighting_dimmer",
      activeStepQuestion: "Check the dimmer's input voltage with the load disconnected. What voltage do you read?",
      activeProcedureName: "Lighting Dimmer",
    });
  });

  it("explicit report request does not pivot into irrelevant serial-number / operational-plan questioning", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_rr",
        message: "please generate the warranty report",
      }),
    }));

    const streamText = await response.text();

    // Surface acknowledged.
    expect(streamText).toMatch(/warranty report/i);
    expect(streamText).toContain("diagnostics are not yet complete");

    // Next step references ONLY the engine-authoritative step.
    expect(streamText).toContain(
      "Check the dimmer's input voltage with the load disconnected. What voltage do you read?",
    );

    // No irrelevant pivots — must NOT ask for serial numbers, model
    // numbers, or operational plans as "missing report details".
    expect(streamText).not.toMatch(/serial\s+number/i);
    expect(streamText).not.toMatch(/model\s+number/i);
    expect(streamText).not.toMatch(/date\s+code/i);
    expect(streamText).not.toMatch(/operational\s+plan/i);

    // No mode transition, no fetch.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── C. Water heater report loop — repeated START FINAL REPORT ─────────

describe("Report-ready surface recognition — water heater loop (C)", () => {
  beforeEach(() => {
    seedMocks({
      language: "EN",
      activeStepId: "wh_9",
      activeProcedureId: "water_heater",
      activeStepQuestion: "Check continuity across the flame sensor with the unit cold. What does your meter read?",
      activeProcedureName: "Water Heater (Gas/Combo)",
    });
  });

  it("repeated START FINAL REPORT interactions produce targeted, engine-grounded deferrals (no repetitive one-liner loop)", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const run = async (message: string) => {
      const r = await POST(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: "case_rr", message }),
      }));
      return r.text();
    };

    const first = await run("START FINAL REPORT");
    const second = await run("START FINAL REPORT");
    const third = await run("write warranty report");

    for (const streamText of [first, second, third]) {
      // Each turn is surface-aware.
      expect(streamText).toMatch(/(?:final|warranty|retail)\s+report/i);
      // Each turn references the engine-authoritative active step.
      expect(streamText).toContain(
        "Check continuity across the flame sensor with the unit cold. What does your meter read?",
      );
      // Each turn stays diagnostic.
      expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
      expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
      // No questionnaire-first collection.
      expect(streamText).not.toContain("what was the complaint");
      expect(streamText).not.toContain("what did you find");
      expect(streamText).not.toContain("what repair you");
    }

    // Mode never transitions across all three repetitions.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
    // No LLM call across all three repetitions.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── D. Multilingual coverage — Russian and Spanish ────────────────────

describe("Report-ready surface recognition — multilingual (D)", () => {
  it("RU session: explicit report alias produces RU surface-aware deferral with engine-quoted next step", async () => {
    seedMocks({
      language: "RU",
      activeStepId: "wh_5",
      activeProcedureId: "water_heater",
      activeStepQuestion: "Проверьте предохранитель водонагревателя. Что показывает мультиметр?",
      activeProcedureName: "Водонагреватель (газ/комби)",
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_rr", message: "сделай гарантийный отчёт" }),
    }));

    const streamText = await response.text();

    // RU surface label and deferral phrasing.
    expect(streamText).toMatch(/гарантийный отчёт/);
    expect(streamText).toContain("диагностика ещё не завершена");

    // Engine-quoted step in RU.
    expect(streamText).toContain("Проверьте предохранитель водонагревателя. Что показывает мультиметр?");

    // No RU questionnaire labels.
    expect(streamText).not.toContain("исходную жалобу");
    expect(streamText).not.toContain("что именно было обнаружено");
    expect(streamText).not.toContain("какой ремонт был фактически выполнен");

    // No mode transition, no fetch.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ES session: explicit report alias produces ES surface-aware deferral with engine-quoted next step", async () => {
    seedMocks({
      language: "ES",
      activeStepId: "wh_5",
      activeProcedureId: "water_heater",
      activeStepQuestion: "Verifica el fusible del calentador de agua. ¿Qué lectura muestra el multímetro?",
      activeProcedureName: "Calentador de agua (gas/combo)",
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_rr", message: "genera el reporte de garantía" }),
    }));

    const streamText = await response.text();

    expect(streamText).toMatch(/reporte de garantía/i);
    expect(streamText).toContain("el diagnóstico aún no está completo");
    expect(streamText).toContain("Verifica el fusible del calentador de agua. ¿Qué lectura muestra el multímetro?");

    // No ES questionnaire labels.
    expect(streamText).not.toContain("la queja original");
    expect(streamText).not.toContain("qué encontraste exactamente");
    expect(streamText).not.toContain("qué reparación completaste exactamente");

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── E. Degenerate engine state — no active step available ─────────────

describe("Report-ready surface recognition — degenerate engine state (E)", () => {
  beforeEach(() => {
    // No active step metadata, no active procedure identified.
    seedMocks({
      language: "EN",
      activeStepId: null,
      activeProcedureId: null,
      activeStepQuestion: null,
      activeProcedureName: null,
    });
  });

  it("falls back safely to a generic surface-aware continuation when no active step is known", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_rr", message: "write the warranty report" }),
    }));

    const streamText = await response.text();

    // Surface still acknowledged.
    expect(streamText).toMatch(/warranty report/i);
    expect(streamText).toContain("diagnostics are not yet complete");

    // Generic continuation line.
    expect(streamText).toMatch(/continue diagnostics so the report can be assembled from verified evidence/i);

    // Still no mode transition, no fetch.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_rr", { mode: "final_report" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── F. Legality preservation — wording alone never unlocks readiness ──

describe("Report-ready surface recognition — legality invariants (F)", () => {
  beforeEach(() => {
    seedMocks({
      language: "EN",
      activeStepId: "wp_3",
      activeProcedureId: "water_pump",
      activeStepQuestion: "Measure direct 12V at the pump terminals. What does your meter read?",
      activeProcedureName: "Water Pump",
      // Engine explicitly reports NOT ready.
      isolationComplete: false,
      terminalPhase: "normal",
    });
  });

  it("deferral response does NOT invent an output-surface event for the requested surface", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_rr", message: "please prepare warranty report" }),
    }));

    const streamText = await response.text();

    // Output surface event MUST remain "diagnostic", not any final surface.
    expect(streamText).toContain('"type":"output_surface","surface":"diagnostic"');
    expect(streamText).not.toMatch(
      /"type":"output_surface","surface":"(?:shop_final_report|portal_cause|authorization_ready)"/,
    );
  });

  it("deferral response does NOT claim transcript evidence is verified, and does NOT invent complaint/findings/repair facts", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_rr",
        message: "Complaint: pump dead. Found 12V at pump. Replaced pump. Please write warranty report.",
      }),
    }));

    const streamText = await response.text();

    // The deferral MUST NOT echo back claimed transcript facts as
    // "verified" or "recorded" evidence. Only the engine-authoritative
    // step question may be quoted.
    expect(streamText).not.toMatch(/verified\s+complaint/i);
    expect(streamText).not.toMatch(/recorded\s+finding/i);
    expect(streamText).not.toMatch(/confirmed\s+repair/i);

    // No questionnaire-first collection.
    expect(streamText).not.toContain("what was the complaint");
    expect(streamText).not.toContain("what did you find");
    expect(streamText).not.toContain("what repair you");
  });
});
