/**
 * P1.7 — Terminal-State Behavior Contract Tests
 *
 * Proves the hard runtime law:
 *   fault identified + corrective action performed + operation restored
 *   = branch closed + completion offer + no further questions
 *
 * These are integration-style tests that verify the full terminal-state behavior
 * contract end-to-end through the context engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  processMessage,
  createContext,
  getOrCreateContext,
  updateContext,
  clearContext,
} from "@/lib/context-engine/context-engine";
import { initializeCase, markStepCompleted, clearRegistry } from "@/lib/diagnostic-registry";
import { DEFAULT_CONFIG } from "@/lib/context-engine/types";

// ── Helpers ────────────────────────────────────────────────────────────

function buildCase(messages: string[], system = "water heater not working"): string {
  const caseId = `p17_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  clearContext(caseId);
  clearRegistry(caseId);
  initializeCase(caseId, system);

  // Seed completed steps so MIN_STEPS threshold is met
  ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"].forEach((s) => markStepCompleted(caseId, s));

  // Sync to context engine
  const ctx = getOrCreateContext(caseId);
  ctx.completedSteps.add("wh_1");
  ctx.completedSteps.add("wh_2");
  ctx.completedSteps.add("wh_3");
  ctx.completedSteps.add("wh_4");
  ctx.completedSteps.add("wh_5");
  ctx.primarySystem = "water_heater";
  ctx.activeProcedureId = "water_heater";
  updateContext(ctx);

  // Process each message in sequence
  for (const msg of messages) {
    processMessage(caseId, msg, DEFAULT_CONFIG);
  }

  return caseId;
}

// ── 1. Verified Restoration Terminal State ──────────────────────────────
describe("P1.7 — Verified restoration terminal state", () => {
  it("single-message restoration (repair + works) → terminal immediately", () => {
    const caseId = buildCase([]);
    const result = processMessage(
      caseId,
      "replaced wiring - heater works now",
      DEFAULT_CONFIG
    );

    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.activeStepId).toBeNull();
    expect(result.context.isolationFinding).toContain("Verified restoration");
    expect(result.responseInstructions.action).toBe("offer_completion");
    expect(result.context.mode).toBe("diagnostic"); // no auto-transition
  });

  it("multi-turn: fault → restoration → terminal", () => {
    const caseId = buildCase([]);

    // Turn 1: Fault identification
    const r1 = processMessage(caseId, "короткое замыкание в проводке", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("fault_candidate");
    expect(r1.context.terminalState.faultIdentified).not.toBeNull();
    expect(r1.context.isolationComplete).toBe(false);
    expect(r1.context.activeStepId).toBeNull();
    expect(r1.responseInstructions.action).toBe("ask_restoration_check");

    // Turn 2: Restoration confirmation
    const r2 = processMessage(caseId, "я заменил проводку - водонагреватель работает", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationComplete).toBe(true);
    expect(r2.context.activeStepId).toBeNull();
    expect(r2.responseInstructions.action).toBe("offer_completion");
    expect(r2.context.mode).toBe("diagnostic");
  });

  it("multi-turn: fault → simple 'да' confirmation → terminal", () => {
    const caseId = buildCase([]);

    // Turn 1: Fault
    const r1 = processMessage(caseId, "обрыв проводки между панелью и модулем", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("fault_candidate");

    // Turn 2: Simple confirmation (technician responding to restoration check)
    const r2 = processMessage(caseId, "да", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationComplete).toBe(true);
    expect(r2.context.activeStepId).toBeNull();
  });

  it("multi-turn: fault → 'works' → terminal", () => {
    const caseId = buildCase([]);

    processMessage(caseId, "short circuit in wiring", DEFAULT_CONFIG);
    const r2 = processMessage(caseId, "works fine now", DEFAULT_CONFIG);

    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationComplete).toBe(true);
  });

  it("Russian: full flow 'заменил проводку - водонагреватель работает' → terminal", () => {
    const caseId = buildCase([]);
    const result = processMessage(
      caseId,
      "заменил проводку - водонагреватель работает",
      DEFAULT_CONFIG
    );

    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.isolationFinding).toContain("Verified restoration");
  });

  it("Spanish: 'después de reparar funciona bien' → terminal", () => {
    const caseId = buildCase([]);
    const result = processMessage(
      caseId,
      "después de reparar el cable funciona bien ahora",
      DEFAULT_CONFIG
    );

    expect(result.context.terminalState.phase).toBe("terminal");
    expect(result.context.isolationComplete).toBe(true);
  });
});

// ── 2. Strong Fault Candidate Behavior ──────────────────────────────────
describe("P1.7 — Strong fault candidate + restoration check", () => {
  it("fault alone → fault_candidate, NOT terminal", () => {
    const caseId = buildCase([]);
    const result = processMessage(caseId, "the relay board is burnt", DEFAULT_CONFIG);

    expect(result.context.terminalState.phase).toBe("fault_candidate");
    expect(result.context.terminalState.faultIdentified).not.toBeNull();
    expect(result.context.isolationComplete).toBe(false);
    expect(result.context.activeStepId).toBeNull();
    // Must ask restoration check, not diagnostic question
    expect(result.responseInstructions.action).toBe("ask_restoration_check");
  });

  it("Russian fault: 'сгорел мотор' → fault_candidate with restoration check", () => {
    const caseId = buildCase([]);
    const result = processMessage(
      caseId,
      "сгорел мотор — двигатель полностью вышел из строя",
      DEFAULT_CONFIG
    );

    expect(result.context.terminalState.phase).toBe("fault_candidate");
    expect(result.context.isolationComplete).toBe(false);
    expect(result.responseInstructions.action).toBe("ask_restoration_check");
  });

  it("fault_candidate: negative response 'нет, не работает' does NOT trigger terminal", () => {
    const caseId = buildCase([]);

    processMessage(caseId, "короткое замыкание в проводке", DEFAULT_CONFIG);
    const r2 = processMessage(caseId, "нет, не работает", DEFAULT_CONFIG);

    expect(r2.context.terminalState.phase).toBe("fault_candidate"); // stays candidate
    expect(r2.context.isolationComplete).toBe(false);
  });

  it("fault_candidate: 'not working' does NOT trigger terminal", () => {
    const caseId = buildCase([]);

    processMessage(caseId, "wiring break confirmed", DEFAULT_CONFIG);
    const r2 = processMessage(caseId, "still not working", DEFAULT_CONFIG);

    expect(r2.context.terminalState.phase).toBe("fault_candidate");
    expect(r2.context.isolationComplete).toBe(false);
  });

  it("fault_candidate: eventual restoration after negative → terminal", () => {
    const caseId = buildCase([]);

    // Fault
    processMessage(caseId, "short circuit in wiring", DEFAULT_CONFIG);
    // Negative
    processMessage(caseId, "not working yet", DEFAULT_CONFIG);
    // Restoration
    const r3 = processMessage(caseId, "replaced wiring, now works", DEFAULT_CONFIG);

    expect(r3.context.terminalState.phase).toBe("terminal");
    expect(r3.context.isolationComplete).toBe(true);
  });
});

// ── 3. Terminal State Dominance ─────────────────────────────────────────
describe("P1.7 — Terminal state dominance", () => {
  it("terminal state survives subsequent messages — no step reassignment", () => {
    const caseId = buildCase([]);

    // Reach terminal
    processMessage(caseId, "replaced faulty relay, system now running", DEFAULT_CONFIG);
    const r1 = processMessage(caseId, "ok", DEFAULT_CONFIG);

    expect(r1.context.terminalState.phase).toBe("terminal");
    expect(r1.context.activeStepId).toBeNull();
    expect(r1.context.isolationComplete).toBe(true);

    // Send more messages — terminal must persist
    const r2 = processMessage(caseId, "what about the pump?", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.activeStepId).toBeNull();
    expect(r2.context.isolationComplete).toBe(true);
  });

  it("terminal state cannot be overwritten by additional completion signals", () => {
    const caseId = buildCase([]);

    const r1 = processMessage(caseId, "replaced wiring - heater works", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("terminal");
    const finding1 = r1.context.isolationFinding;

    const r2 = processMessage(caseId, "also replaced the valve, pump works too", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationFinding).toBe(finding1); // first finding wins
  });

  it("fault_candidate: activeStepId stays null (no step expansion)", () => {
    const caseId = buildCase([]);

    const r = processMessage(caseId, "короткое замыкание в проводке", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.activeStepId).toBeNull();

    // Follow-up message — still no step
    const r2 = processMessage(caseId, "checking...", DEFAULT_CONFIG);
    expect(r2.context.activeStepId).toBeNull();
  });

  it("mode remains 'diagnostic' throughout terminal flow", () => {
    const caseId = buildCase([]);

    const r1 = processMessage(caseId, "short circuit", DEFAULT_CONFIG);
    expect(r1.context.mode).toBe("diagnostic");

    const r2 = processMessage(caseId, "fixed it, works now", DEFAULT_CONFIG);
    expect(r2.context.mode).toBe("diagnostic");
    expect(r2.context.terminalState.phase).toBe("terminal");
  });
});

// ── 4. Explicit Report Command Still Required ──────────────────────────
describe("P1.7 — Explicit START FINAL REPORT still required", () => {
  it("terminal state does NOT auto-transition to final_report mode", () => {
    const caseId = buildCase([]);

    processMessage(caseId, "replaced wiring - heater works", DEFAULT_CONFIG);
    const r = processMessage(caseId, "ok thanks", DEFAULT_CONFIG);

    expect(r.context.terminalState.phase).toBe("terminal");
    expect(r.context.mode).toBe("diagnostic"); // NOT final_report
    expect(r.context.mode).not.toBe("final_report");
  });

  it("completion offer includes START FINAL REPORT instruction", () => {
    const caseId = buildCase([]);
    const result = processMessage(
      caseId,
      "replaced wiring - heater works",
      DEFAULT_CONFIG
    );

    expect(result.responseInstructions.action).toBe("offer_completion");
    const constraintsText = result.responseInstructions.constraints.join(" ");
    expect(constraintsText).toContain("START FINAL REPORT");
  });
});

// ── 5. Water Heater End-to-End Regression ──────────────────────────────
describe("P1.7 — Water heater end-to-end (TestCase12 regression)", () => {
  it("full flow: no 12V → wiring fault → wiring replaced → heater works → terminal", () => {
    const caseId = `p17_e2e_${Date.now()}`;
    clearContext(caseId);
    clearRegistry(caseId);
    initializeCase(caseId, "водонагреватель не работает");

    // Seed minimum steps
    ["wh_1", "wh_2"].forEach(s => markStepCompleted(caseId, s));
    const ctx = getOrCreateContext(caseId);
    ctx.completedSteps.add("wh_1");
    ctx.completedSteps.add("wh_2");
    ctx.primarySystem = "water_heater";
    ctx.activeProcedureId = "water_heater";
    updateContext(ctx);

    // Turn 1: Technician reports no 12V (just a diagnostic answer, not a fault)
    const r1 = processMessage(caseId, "нет 12 вольт на разъёме", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("normal");

    // Turn 2: Technician finds wiring fault
    const r2 = processMessage(
      caseId,
      "короткое замыкание в проводке между модулем розжига и электродом",
      DEFAULT_CONFIG
    );
    expect(r2.context.terminalState.phase).toBe("fault_candidate");
    expect(r2.context.activeStepId).toBeNull();
    expect(r2.context.isolationComplete).toBe(false);

    // Turn 3: Technician reports repair + restoration
    const r3 = processMessage(
      caseId,
      "я заменил проводку - водонагреватель работает",
      DEFAULT_CONFIG
    );
    expect(r3.context.terminalState.phase).toBe("terminal");
    expect(r3.context.isolationComplete).toBe(true);
    expect(r3.context.activeStepId).toBeNull();
    expect(r3.context.isolationFinding).toBeTruthy();
    expect(r3.responseInstructions.action).toBe("offer_completion");
    expect(r3.context.mode).toBe("diagnostic");

    // Turn 4: Follow-up — no more questions
    const r4 = processMessage(caseId, "ok", DEFAULT_CONFIG);
    expect(r4.context.terminalState.phase).toBe("terminal");
    expect(r4.context.activeStepId).toBeNull();
    expect(r4.context.isolationComplete).toBe(true);
  });

  it("English flow: short circuit → replaced wiring → heater works → terminal", () => {
    const caseId = buildCase([]);

    // Fault
    const r1 = processMessage(caseId, "found short circuit in the wiring harness", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("fault_candidate");

    // Restoration
    const r2 = processMessage(caseId, "replaced the wiring, heater works fine now", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationComplete).toBe(true);
    expect(r2.context.activeStepId).toBeNull();
    expect(r2.responseInstructions.action).toBe("offer_completion");
  });
});

// ── 6. No Completion Before Minimum Steps ──────────────────────────────
describe("P1.7 — Minimum steps guard", () => {
  it("does NOT trigger terminal state with zero completed steps", () => {
    const caseId = `p17_min_${Date.now()}`;
    clearContext(caseId);
    clearRegistry(caseId);
    initializeCase(caseId, "water heater test");
    // DO NOT seed any completed steps

    const result = processMessage(
      caseId,
      "replaced wiring - heater works now",
      DEFAULT_CONFIG
    );

    expect(result.context.terminalState.phase).toBe("normal");
    expect(result.context.isolationComplete).toBe(false);
  });
});
