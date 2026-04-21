/**
 * Runtime Customer-Fidelity Regression Pack — Route Runtime Behavior
 *
 * Coverage for the four next-priority regression targets queued behind
 * the customer-fidelity docs pass (see ROADMAP §7):
 *
 *   1. False final-output invitation before isolation / readiness      (§7.1)
 *   3. Questionnaire-first unresolved report flow is eliminated        (§7.3)
 *   4. Server-owned, legality-gated final-report CTA boundary          (§7.4)
 *
 * Subtype gating fidelity (§7.2) lives in
 * `runtime-customer-fidelity-regressions-subtype.test.ts` — splitting
 * those tests out keeps the real diagnostic-registry available for
 * direct assertions there, while this file can freely mock it for
 * route-level isolation.
 *
 * Doctrine-aligned with:
 *   - docs/CUSTOMER_BEHAVIOR_SPEC.md §2 (Diagnostic Flow Rules)
 *   - docs/CUSTOMER_BEHAVIOR_SPEC.md §5 (Output Surface Behavior)
 *   - docs/CUSTOMER_BEHAVIOR_SPEC.md §6 (Prohibited Premature Outputs)
 *   - ARCHITECTURE_RULES.md A1 (Context Engine single authority)
 *   - ARCHITECTURE_RULES.md G1a / G1b (incomplete isolation continues
 *     diagnostics; no hidden second brain)
 *   - ARCHITECTURE_RULES.md M1b (future CTA is server-owned, legality-
 *     gated, NOT inferred from LLM wording)
 *
 * Tests are deterministic: storage, auth, the registry, the context
 * engine, and the OpenAI client are mocked. No live LLM key is required.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Route-level runtime behavior ──────────────────────────────────────

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

function seedMocks() {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test-mock";

  mockGetCurrentUser.mockResolvedValue({ id: "user_regression" });
  mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
  mockStorage.ensureCase.mockResolvedValue({
    id: "case_regression",
    title: "Regression Case",
    userId: "user_regression",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue([]);
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_r" });
  mockStorage.updateCase.mockResolvedValue({ id: "case_regression" });

  mockGetOrCreateContext.mockReturnValue({
    caseId: "case_regression",
    activeStepId: "wh_5",
    activeProcedureId: "water_heater",
    primarySystem: "water_heater",
    isolationComplete: false,
    terminalState: {
      phase: "normal",
      faultIdentified: null,
      correctiveAction: null,
      restorationConfirmed: null,
    },
  });

  mockProcessContextMessage.mockReturnValue({
    context: {
      caseId: "case_regression",
      submode: "main",
      activeStepId: "wh_5",
      activeProcedureId: "water_heater",
      primarySystem: "water_heater",
      isolationComplete: false,
      isolationFinding: null,
      terminalState: {
        phase: "normal",
        faultIdentified: null,
        correctiveAction: null,
        restorationConfirmed: null,
      },
    },
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
    system: "water_heater",
    procedure: {
      system: "water_heater",
      displayName: "Water Heater (Gas/Combo)",
      complex: true,
      variant: "STANDARD",
      steps: [],
    },
    preCompletedSteps: [],
  });
}

describe("Regression 7.1 — No false final-output invitation before readiness", () => {
  beforeEach(() => seedMocks());

  it("unresolved diagnostic + wording-inferred 'complaint + findings + repair + write report' does NOT emit any report invitation or CTA-equivalent availability", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const message = [
      "Complaint: water heater inoperative.",
      "Findings: fuse was blown.",
      "Corrective action: replaced the fuse.",
      "write warranty report",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_regression", message }),
    }));

    const streamText = await response.text();

    // No mode transition (no CTA-equivalent mode availability event).
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_regression",
      { mode: "final_report" },
    );
    // PR1 (agent-freedom): the bounded LLM is now called with the
    // report-not-ready directive; on validation failure the transcript-
    // grounded diagnostics-not-ready fallback text is emitted. The
    // readiness gate (Context Engine state) still blocks final_report
    // mode and any CTA-equivalent surface availability.
    expect(mockFetch).toHaveBeenCalled();
    // SSE mode envelope stays diagnostic.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // Deterministic diagnostics-not-ready continuation (EN) on fallback path.
    expect(streamText).toContain("Diagnostics are not yet complete");
    // Explicit anti-invitation: no final-report CTA text in assistant tokens.
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*START FINAL REPORT/);
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*write the report/);
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*generate the report/);
    // No output-surface events for final-report surfaces.
    expect(streamText).not.toContain('"surface":"shop_final_report"');
    expect(streamText).not.toContain('"surface":"portal_cause"');
    expect(streamText).not.toContain('"surface":"authorization_ready"');
  });

  it("unresolved diagnostic + bare 'write report' alias does NOT emit any report invitation", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_regression", message: "write report" }),
    }));

    const streamText = await response.text();

    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_regression",
      { mode: "final_report" },
    );
    // PR1 (agent-freedom): LLM is now called with the report-not-ready
    // directive; the server-owned readiness gate still blocks the mode.
    expect(mockFetch).toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).toContain("Diagnostics are not yet complete");
  });
});

describe("Regression 7.3 — Unresolved diagnostics never fall into questionnaire-first report collection", () => {
  beforeEach(() => seedMocks());

  it("START FINAL REPORT in unresolved state returns diagnostics-not-ready, NOT an EN report-field questionnaire", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_regression",
        message: "START FINAL REPORT",
      }),
    }));

    const streamText = await response.text();

    // No questionnaire-style missing-fields prompt (EN labels).
    expect(streamText).not.toContain("the original complaint");
    expect(streamText).not.toContain("what you found");
    expect(streamText).not.toContain("what repair you completed");
    expect(streamText).not.toContain("missing report details");
    // Diagnostics-not-ready deferral (EN).
    expect(streamText).toContain("Diagnostics are not yet complete");
  });

  it("natural RU alias in an unresolved RU session does NOT produce any questionnaire prompt", async () => {
    // Use a real RU-worded message so the language detector resolves RU.
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "case_regression",
        message: "Сделай отчёт по гарантии",
      }),
    }));

    const streamText = await response.text();

    // EN questionnaire labels — forbidden.
    expect(streamText).not.toContain("the original complaint");
    expect(streamText).not.toContain("what you found");
    expect(streamText).not.toContain("what repair you completed");
    // RU questionnaire labels — forbidden.
    expect(streamText).not.toContain("исходную жалобу");
    expect(streamText).not.toContain("что именно было обнаружено");
    expect(streamText).not.toContain("какой ремонт был фактически выполнен");
    // ES questionnaire labels — forbidden.
    expect(streamText).not.toContain("la queja original");
    expect(streamText).not.toContain("qué encontraste exactamente");
    expect(streamText).not.toContain("qué reparación completaste exactamente");

    // Runtime stays in diagnostic mode.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_regression",
      { mode: "final_report" },
    );
    // Deterministic RU diagnostics-not-ready deferral.
    expect(streamText).toContain("Диагностика ещё не завершена");
  });
});

describe("Regression 7.4 — Server-owned, legality-gated final-report CTA boundary", () => {
  beforeEach(() => seedMocks());

  it("no CTA-equivalent availability is emitted when readiness gates are unsatisfied", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_regression", message: "write report" }),
    }));

    const streamText = await response.text();

    // No final-report mode availability event.
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // No output_surface event exposing a final-output surface.
    expect(streamText).not.toMatch(/"type":"output_surface","surface":"(?:shop_final_report|portal_cause|authorization_ready)"/);
    // No CTA-equivalent wording drift.
    expect(streamText).not.toContain("ask me to write the report");
    expect(streamText).not.toContain("If you want the report now");
  });

  it("CTA-equivalent availability is NOT derived from LLM wording — readiness gate is the Context Engine state alone", async () => {
    // This test exercises the route with a message that would previously
    // trip the `repairSummaryIntent.readyForReportRouting` heuristic
    // (complaint + findings + corrective-action + report alias). Under
    // doctrine, that heuristic MUST NOT gate final-output availability.
    const { POST } = await import("@/app/api/chat/route");

    const message = [
      "Complaint: water heater not heating.",
      "Findings: blown fuse confirmed.",
      "Corrective action: replaced the fuse and unit works.",
      "prepare warranty report",
    ].join("\n");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_regression", message }),
    }));

    const streamText = await response.text();

    // Heuristic-driven mode transition must not happen.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith(
      "case_regression",
      { mode: "final_report" },
    );
    // PR1 (agent-freedom): LLM is called with the report-not-ready directive;
    // wording-inferred readiness is still blocked by the server-owned gate.
    expect(mockFetch).toHaveBeenCalled();
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
  });

  it("when runtime readiness IS satisfied (terminal phase), natural alias correctly unlocks the server-owned final-report path", async () => {
    // Positive control: gate is runtime-owned. When the Context Engine
    // reports terminal readiness, the same natural alias correctly
    // unlocks the final-report transition. This proves the gate is
    // gate-based, not blanket-suppressed.
    mockGetOrCreateContext.mockReturnValue({
      caseId: "case_regression",
      activeStepId: null,
      activeProcedureId: "water_heater",
      primarySystem: "water_heater",
      isolationComplete: true,
      terminalState: {
        phase: "terminal",
        faultIdentified: { text: "failed fuse", detectedAt: "now" },
        correctiveAction: { text: "replaced", detectedAt: "now" },
        restorationConfirmed: { text: "works", detectedAt: "now" },
      },
    });

    // Final-report fetch will be made; mock a minimally compliant body.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                "Complaint: heater inoperative.\n" +
                "Diagnostic Procedure: verified fuse failure.\n" +
                "Verified Condition: operates normally after fuse replacement.\n" +
                "Recommended Corrective Action: replace failed fuse.\n" +
                "Estimated Labor: fuse replacement - 0.4 hr. Total labor: 0.4 hr.\n" +
                "Required Parts: fuse.",
            },
          },
        ],
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_regression", message: "write warranty report" }),
    }));

    const streamText = await response.text();

    // Readiness-satisfied case: mode transitions legally.
    expect(mockStorage.updateCase).toHaveBeenCalledWith(
      "case_regression",
      { mode: "final_report" },
    );
    expect(streamText).toContain('"type":"mode","mode":"final_report"');
  });
});
