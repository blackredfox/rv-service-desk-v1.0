/**
 * PR1 (agent-freedom) — Systemic boundary regression pack
 *
 * Proves the narrow systemic shift of PR1
 * (fix/diagnostic-boundaries-not-server-scripting):
 *
 *   1. Grounded-reply survival
 *      A legal, grounded LLM diagnostic reply is NOT rewritten into
 *      default status-terminal prose when the runtime state is consistent
 *      with what the model produced.
 *
 *   2. Unresolved diagnostics stay diagnostic
 *      A report request during unresolved diagnostics no longer bypasses
 *      the LLM with a canned server line; the route injects a bounded
 *      directive, lets the model author the decline, and keeps the
 *      deterministic diagnostics-not-ready text as the validation fallback.
 *
 *   3. Transcript-grounded completion offer preserves the finding
 *      On validation failure the completion-offer turn falls back to the
 *      transcript-grounded authoritative offer (fuse stays fuse, not valve),
 *      instead of the generic status-terminal step fallback.
 *
 *   4. No cross-system drift
 *      The report/readiness interaction never switches the active
 *      object/system.
 *
 * These properties are enforced by:
 *   - src/app/api/chat/route.ts          (bypass removed, directives injected)
 *   - src/lib/chat/output-policy.ts      (fallbacks + directive builder)
 *   - src/lib/chat/openai-execution-service.ts (hint threaded)
 *   - src/lib/chat/response-validation-service.ts (hint-aware fallback)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────

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

  mockGetCurrentUser.mockResolvedValue({ id: "user_pr1" });
  mockStorage.getCase.mockResolvedValue({ case: null, messages: [] });
  mockStorage.ensureCase.mockResolvedValue({
    id: "case_pr1",
    title: "PR1 Case",
    userId: "user_pr1",
    inputLanguage: "AUTO",
    languageSource: "AUTO",
    mode: "diagnostic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockStorage.listMessagesForContext.mockResolvedValue([]);
  mockStorage.appendMessage.mockResolvedValue({ id: "msg_pr1" });
  mockStorage.updateCase.mockResolvedValue({ id: "case_pr1" });

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

function seedActiveDiagnosticContext() {
  mockGetOrCreateContext.mockReturnValue({
    caseId: "case_pr1",
    activeStepId: "wh_5",
    activeProcedureId: "water_heater",
    primarySystem: "water_heater",
    isolationComplete: false,
    terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
  });

  mockProcessContextMessage.mockReturnValue({
    context: {
      caseId: "case_pr1",
      submode: "main",
      activeStepId: "wh_5",
      activeProcedureId: "water_heater",
      primarySystem: "water_heater",
      isolationComplete: false,
      isolationFinding: null,
      terminalState: { phase: "normal", faultIdentified: null, correctiveAction: null, restorationConfirmed: null },
    },
    intent: { type: "MAIN_DIAGNOSTIC" },
    responseInstructions: { action: "ask_step", constraints: [], antiLoopDirectives: [] },
    stateChanged: false,
    notices: [],
  });
}

function seedCompletionOfferContext() {
  mockGetOrCreateContext.mockReturnValue({
    caseId: "case_pr1",
    activeStepId: null,
    activeProcedureId: "water_heater",
    primarySystem: "water_heater",
    isolationComplete: true,
    isolationFinding: "Failed in-line fuse in water heater 12V supply; replaced and heater operates normally.",
    terminalState: {
      phase: "terminal",
      faultIdentified: { text: "Failed fuse", detectedAt: "now" },
      correctiveAction: { text: "Replaced fuse", detectedAt: "now" },
      restorationConfirmed: { text: "Works", detectedAt: "now" },
    },
  });

  mockProcessContextMessage.mockReturnValue({
    context: {
      caseId: "case_pr1",
      submode: "main",
      activeStepId: null,
      activeProcedureId: "water_heater",
      primarySystem: "water_heater",
      isolationComplete: true,
      isolationFinding: "Failed in-line fuse in water heater 12V supply; replaced and heater operates normally.",
      terminalState: {
        phase: "terminal",
        faultIdentified: { text: "Failed fuse", detectedAt: "now" },
        correctiveAction: { text: "Replaced fuse", detectedAt: "now" },
        restorationConfirmed: { text: "Works", detectedAt: "now" },
      },
    },
    intent: { type: "MAIN_DIAGNOSTIC" },
    responseInstructions: { action: "offer_completion", constraints: [], antiLoopDirectives: [] },
    stateChanged: true,
    notices: [],
  });
}

function buildStreamedFetchResponse(content: string) {
  return {
    ok: true,
    body: null,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────

describe("PR1 agent-freedom — systemic boundary", () => {
  beforeEach(() => seedMocks());

  // 1. Grounded-reply survival
  it("grounded legal diagnostic reply survives without being rewritten into default status-terminal prose", async () => {
    seedActiveDiagnosticContext();

    // A naturally phrased, legal diagnostic reply — one question, in EN,
    // no final-report headers, no isolation-complete declaration.
    const groundedReply =
      "Thanks — that symptom narrows it down. Check the 12V feed at the water heater board and tell me what you read, does it show full battery voltage?";

    mockFetch.mockResolvedValueOnce(buildStreamedFetchResponse(groundedReply));

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_pr1", message: "unit stopped heating yesterday" }),
    }));

    const streamText = await response.text();

    // LLM was actually called (no server bypass on ordinary diagnostic turn).
    expect(mockFetch).toHaveBeenCalled();
    // Grounded token content survives unchanged in the stream.
    expect(streamText).toContain(groundedReply);
    // No server-authored status-terminal fallback was injected on top.
    expect(streamText).not.toContain("Guided Diagnostics");
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*Progress:\s*\d+\/\d+/);
    // No validation_fallback envelope was emitted.
    expect(streamText).not.toContain('"type":"validation_fallback"');
    // Mode stays diagnostic.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
  });

  // 2. Unresolved diagnostics stay diagnostic (no questionnaire-first fallback)
  it("unresolved diagnostic + report request: LLM is called under a bounded directive, no mode transition, no questionnaire", async () => {
    seedActiveDiagnosticContext();

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_pr1", message: "write warranty report" }),
    }));

    const streamText = await response.text();

    // The bypass is gone — LLM IS called with the bounded directive.
    expect(mockFetch).toHaveBeenCalled();
    // Server-owned legality holds: mode stays diagnostic.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_pr1", { mode: "final_report" });
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).not.toContain('"type":"mode","mode":"final_report"');
    // No questionnaire-first fallback ever authors "what is the complaint /
    // what did you find / what repair you completed" prompts.
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*the original complaint/);
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*what you found/);
    expect(streamText).not.toMatch(/"type":"token","token":"[^"]*what repair you completed/);
    // Final-report surfaces are never exposed during unresolved diagnostics.
    expect(streamText).not.toContain('"surface":"shop_final_report"');
    expect(streamText).not.toContain('"surface":"portal_cause"');
    expect(streamText).not.toContain('"surface":"authorization_ready"');
  });

  // 3. Transcript-grounded completion offer (fuse stays fuse on fallback path)
  it("completion-offer turn falls back to transcript-grounded authoritative offer when LLM output is invalid (fuse-case fact integrity)", async () => {
    seedCompletionOfferContext();

    // Force the LLM to emit final-report-shaped output — which is drift;
    // validation must reject it and the hint-driven fallback must pick
    // the transcript-grounded authoritative offer (fuse wording preserved).
    const driftedReply = [
      "Complaint: Heater inoperative.",
      "Diagnostic Procedure: Verified.",
      "Verified Condition: Operates normally.",
      "Recommended Corrective Action: Repair complete.",
      "Estimated Labor: 1.0 hr. Total labor: 1.0 hr.",
      "Required Parts: None.",
    ].join("\n");

    mockFetch.mockResolvedValue(buildStreamedFetchResponse(driftedReply));

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_pr1", message: "Problem is resolved — replaced the fuse." }),
    }));

    const streamText = await response.text();

    // LLM was called (no server bypass on completion offer).
    expect(mockFetch).toHaveBeenCalled();
    // Validation caught the final-report-shape drift and triggered the
    // PR1 hint-driven fallback (completion-offer branch).
    expect(streamText).toContain('"type":"validation_fallback"');
    // Transcript-grounded authoritative completion offer was emitted with
    // fuse-case wording preserved — the hint fallback picked it because
    // the engine's isolationFinding references the fuse.
    expect(streamText).toMatch(/"type":"token","token":"Noted\.[^"]*fuse/i);
    expect(streamText).toContain("START FINAL REPORT");
    // Case mode stays diagnostic until the technician explicitly commands the transition.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_pr1", { mode: "final_report" });
  });

  // 4. No cross-system drift during report/readiness interaction
  it("report request during unresolved diagnostics does not switch the active system/object", async () => {
    seedActiveDiagnosticContext();

    mockFetch.mockResolvedValue(buildStreamedFetchResponse("Will do."));

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "case_pr1", message: "prepare warranty report" }),
    }));

    const streamText = await response.text();

    // No flow-authority drift — the route never re-initialized the case
    // into a different system as part of handling the report request.
    expect(mockInitializeCase).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/front\s+jack|converter|inverter|furnace|ac\b/i),
    );
    // Mode and surface are still diagnostic.
    expect(streamText).toContain('"type":"mode","mode":"diagnostic"');
    expect(streamText).toContain('"type":"output_surface","surface":"diagnostic"');
    // Mode transition to final_report did not happen.
    expect(mockStorage.updateCase).not.toHaveBeenCalledWith("case_pr1", { mode: "final_report" });
  });
});
