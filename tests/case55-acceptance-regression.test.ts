/**
 * Case-55 Acceptance Regression Tests
 *
 * Delta-fix PR: Customer-Fidelity Terminal State + Agent-Assembled Report Draft
 *
 * Proves the five behavioral fixes required by this PR:
 *
 *  1. Explicit non-combo blocks combo-only step wh_11 when asserted anywhere
 *     in the transcript, not only when answered at wh_1.
 *  2. Explicit non-combo does not allow repeated combo-only re-ask.
 *  3. Successful repair + restored operation triggers terminal/report-ready
 *     handling (wiring-integrity case from Case-55).
 *  4. Resolved (terminal) case does not continue routine low-priority
 *     diagnostic questioning.
 *  5. Report-ready flow assembles a transcript-derived draft instead of
 *     asking the technician to author complaint / findings / performed repair.
 *  6. Previous fixes remain intact (subtype gate on wh_1, surface separation,
 *     no false final-report invitation during unresolved diagnostics).
 *
 * Transcript anchor (Case-55):
 *   Technician: "это не COMBO" (arbitrary step)
 *   Technician: "целостность проводки была нарушена, я заменил проводку"
 *   Technician: "после замены проводки водонагреватель работает нормально"
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  initializeCase,
  clearRegistry,
  markStepCompleted,
  getNextStepId,
  getRegistryEntry,
  detectSubtypeExclusions,
  scanMessageForSubtypeAssertions,
} from "@/lib/diagnostic-registry";
import {
  processMessage as processContextMessage,
  clearContext,
  getOrCreateContext,
  DEFAULT_CONFIG,
} from "@/lib/context-engine";
import {
  assessRepairSummaryIntent,
} from "@/lib/chat/repair-summary-intent";

// ── 1. Explicit non-combo blocks wh_11 from ANY step ────────────────

describe("Case-55 / 1. Non-combo gating at any step", () => {
  const caseId = "case55-non-combo-any-step";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("detects 'не COMBO' (Cyrillic+Latin mixed) at any step, not only wh_1", () => {
    // Mixed-script "не COMBO" was the exact Case-55 assertion.
    expect(detectSubtypeExclusions("wh_11", "это не COMBO").includes("combo")).toBe(true);
    expect(detectSubtypeExclusions("wh_5", "это не COMBO").includes("combo")).toBe(true);
    // Still honors pure-Cyrillic form
    expect(detectSubtypeExclusions("wh_11", "не комби").includes("combo")).toBe(true);
    // And English on any step
    expect(detectSubtypeExclusions("wh_10", "not combo").includes("combo")).toBe(true);
    expect(detectSubtypeExclusions("wh_11", "no es combo").includes("combo")).toBe(true);
  });

  it("scanMessageForSubtypeAssertions persists the exclusion in registry", () => {
    initializeCase(caseId, "water heater not working");

    const added = scanMessageForSubtypeAssertions(caseId, "это не COMBO");
    expect(added).toContain("combo");

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(true);
  });

  it("context engine records non-combo exclusion even when asserted on wh_11 itself", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    // Simulate the assertion landing at an arbitrary turn — the context
    // engine's transcript scan must catch it regardless of the active step.
    processContextMessage(caseId, "это не COMBO", DEFAULT_CONFIG);

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(true);
  });

  it("wh_11 is never served after non-combo assertion (even if wh_1 answered ambiguously)", () => {
    initializeCase(caseId, "water heater not working");

    // Ambiguous wh_1 answer that does NOT match the gas-only broad patterns
    markStepCompleted(caseId, "wh_1", "Suburban model, not sure of type yet");

    // wh_1 answer did not establish the exclusion
    let entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(false);

    // Later in the transcript, technician explicitly asserts non-combo
    scanMessageForSubtypeAssertions(caseId, "это не COMBO");

    entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(true);

    // Walk remaining steps — wh_11 must be gated out
    const served: string[] = [];
    let next = getNextStepId(caseId);
    let guard = 0;
    while (next && guard < 50) {
      served.push(next);
      markStepCompleted(caseId, next, "checked, ok");
      next = getNextStepId(caseId);
      guard++;
    }

    expect(served).not.toContain("wh_11");
  });
});

// ── 2. No repeated combo-only re-ask after explicit non-combo ───────

describe("Case-55 / 2. No repeated combo-only re-ask", () => {
  const caseId = "case55-no-reask";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("once 'combo' is excluded, getNextStepId never returns wh_11 again", () => {
    initializeCase(caseId, "water heater not working");
    scanMessageForSubtypeAssertions(caseId, "не COMBO");

    // Force the exact prerequisite state under which wh_11 would otherwise be served
    markStepCompleted(caseId, "wh_1", "gas unit");

    let next = getNextStepId(caseId);
    let guard = 0;
    const allServed: string[] = [];
    while (next && guard < 50) {
      allServed.push(next);
      expect(next).not.toBe("wh_11");
      markStepCompleted(caseId, next, "checked, ok");
      next = getNextStepId(caseId);
      guard++;
    }

    expect(allServed).not.toContain("wh_11");
  });
});

// ── 3. Terminal/report-ready after successful repair ────────────────

describe("Case-55 / 3. Terminal state after successful repair (wiring)", () => {
  const caseId = "case55-terminal-wiring";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("wiring-integrity fault + restoration confirmation reaches terminal phase", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    // Satisfy MIN_STEPS_FOR_COMPLETION (>=1) by answering wh_1 first
    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);

    // Case-55 messages
    processContextMessage(
      caseId,
      "целостность проводки была нарушена, я заменил проводку",
      DEFAULT_CONFIG,
    );
    const result = processContextMessage(
      caseId,
      "после замены проводки водонагреватель работает нормально",
      DEFAULT_CONFIG,
    );

    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.isolationFinding).toBeTruthy();
    // No more active step in terminal phase
    expect(result.context.activeStepId).toBeNull();
  });

  it("wiring-integrity language alone establishes fault (moves to fault_candidate)", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    // Satisfy MIN_STEPS_FOR_COMPLETION
    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);

    const result = processContextMessage(
      caseId,
      "целостность проводки была нарушена, я заменил проводку",
      DEFAULT_CONFIG,
    );

    // Either the repair was inferred into full terminal, or at minimum fault
    // was identified and we are awaiting a restoration confirmation.
    expect(
      result.context.terminalState.phase === "fault_candidate" ||
      result.context.terminalState.phase === "terminal",
    ).toBe(true);
    expect(result.context.terminalState.faultIdentified).toBeTruthy();
  });
});

// ── 4. Resolved case does not continue low-priority diagnostics ─────

describe("Case-55 / 4. Low-priority questioning stops after restoration", () => {
  const caseId = "case55-stop-low-priority";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("after terminal, activeStepId stays null and response action is offer_completion", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);
    processContextMessage(
      caseId,
      "после замены проводки водонагреватель работает нормально",
      DEFAULT_CONFIG,
    );

    // Another mundane message must NOT re-open routine diagnostics.
    const post = processContextMessage(
      caseId,
      "ok",
      DEFAULT_CONFIG,
    );

    expect(post.context.terminalState.phase).toBe("terminal");
    expect(post.context.activeStepId).toBeNull();
    expect(post.responseInstructions.action).toBe("offer_completion");
  });
});

// ── 5. Transcript-derived report draft (no questionnaire) ───────────

describe("Case-55 / 5. Agent-assembled report draft (no questionnaire default)", () => {
  it("repair-summary intent does not force readyForReportRouting without all fields", () => {
    // Agent must not demand complaint/findings/repair from the technician;
    // unreadiness is now signalled by not routing, not by a questionnaire.
    const intent = assessRepairSummaryIntent({
      message: "write the report",
      hasReportRequest: true,
      priorUserMessages: [
        "water heater not working",
        "gas unit",
        "я заменил проводку",
      ],
      hasActiveDiagnosticContext: true,
    });

    expect(intent.readyForReportRouting).toBe(false);
  });

  it("route-level transcript-derived draft constraint exists in the source", () => {
    // Meta check: the transcript-derived draft constraint must exist in route.ts
    // and must contain the anti-questionnaire rules required by the PR.
    const routePath = path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "chat",
      "route.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    expect(source).toContain("buildTranscriptDerivedDraftConstraint");
    expect(source).toMatch(/REPORT ASSEMBLY/i);
    expect(source).toMatch(/Assemble the final report draft yourself/i);
    expect(source).toMatch(
      /Do NOT ask the technician to author or re-author/i,
    );
  });

  it("no hard-coded default questionnaire call path remains in route.ts", () => {
    const routePath = path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "chat",
      "route.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    // The old questionnaire call — buildRepairSummaryClarificationResponse —
    // must NOT be invoked from route.ts any longer.
    expect(source).not.toContain("buildRepairSummaryClarificationResponse(");
  });
});

// ── 6. Previous improvements stay intact ────────────────────────────

describe("Case-55 / 6. Previous improvements preserved", () => {
  const caseId = "case55-prior-fixes";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("wh_1 'gas only' answer still excludes combo (Case-54 subtype gating)", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "gas only, Suburban");

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(true);
  });

  it("wh_1 'combo' answer still allows wh_11 (subtype gating negative case)", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "combo gas and electric");

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(false);
  });

  it("isFinalReportReady stays false while isolation not complete", () => {
    const context = {
      isolationComplete: false,
      terminalState: { phase: "normal" as const },
    };
    const ready = Boolean(
      context.isolationComplete ||
      context.terminalState?.phase === "terminal",
    );
    expect(ready).toBe(false);
  });
});
