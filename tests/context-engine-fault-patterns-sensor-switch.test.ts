/**
 * Context Engine — Sensor / Switch-class FAULT_PATTERNS
 *
 * Narrow recognition gap-closure for common real-technician fault
 * phrases about sensor / switch-class components that were previously
 * missed by FAULT_PATTERNS (so the engine never transitioned to
 * fault_candidate, which in turn prevented downstream documentation-
 * refinement and restoration-check behavior from firing).
 *
 * This test file verifies only the narrow gap-closure:
 *
 *   - explicit sensor/switch-class fault phrases → fault_candidate
 *     (when the engine's other rules are satisfied — specifically
 *     MIN_STEPS_FOR_COMPLETION).
 *   - unrelated vague wording does NOT over-trigger fault_candidate.
 *   - final-report legality is unchanged (fault_candidate is NOT
 *     terminal; downstream runtime gate and restoration check are
 *     still required to reach terminal / final_report).
 *
 * Doctrine preserved:
 *   - Context Engine remains the only flow authority.
 *   - No wording-inferred final-report readiness.
 *   - No change to completion doctrine / MIN_STEPS_FOR_COMPLETION.
 *   - No change to RESTORATION_PATTERNS or SIMPLE_RESTORATION_PATTERNS.
 *   - No new broad fault recognition — state words (bad / defective /
 *     faulty) are admitted ONLY when paired with the narrow
 *     sensor/switch-class component list.
 */

import { describe, it, expect } from "vitest";
import {
  processMessage,
  getOrCreateContext,
  updateContext,
  clearContext,
} from "@/lib/context-engine/context-engine";
import { initializeCase, markStepCompleted, clearRegistry } from "@/lib/diagnostic-registry";
import { DEFAULT_CONFIG } from "@/lib/context-engine/types";

// ── Helper ────────────────────────────────────────────────────────────

/**
 * Seed a case with enough diagnostic work done that the engine's
 * MIN_STEPS_FOR_COMPLETION gate (= 1) is satisfied. This PR does NOT
 * relax that gate — it only broadens FAULT_PATTERNS recognition.
 */
function seedReadyForFaultEval(caseId: string): void {
  clearContext(caseId);
  clearRegistry(caseId);
  initializeCase(caseId, "water heater not working");
  ["wh_1", "wh_2", "wh_3"].forEach((s) => markStepCompleted(caseId, s));

  const ctx = getOrCreateContext(caseId);
  ctx.completedSteps.add("wh_1");
  ctx.completedSteps.add("wh_2");
  ctx.completedSteps.add("wh_3");
  ctx.primarySystem = "water_heater";
  ctx.activeProcedureId = "water_heater";
  updateContext(ctx);
}

// ── Positive cases (English) ──────────────────────────────────────────

describe("FAULT_PATTERNS gap-closure — English sensor / switch-class phrases", () => {
  it("'flame sensor is bad' → fault_candidate (component + is + state word)", () => {
    const caseId = `fp_en_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);

    const r = processMessage(caseId, "flame sensor is bad", DEFAULT_CONFIG);

    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.terminalState.faultIdentified).not.toBeNull();
    expect(r.context.terminalState.faultIdentified?.text).toContain("flame sensor is bad");
    // MUST NOT force terminal — fault alone never reaches terminal.
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'bad flame sensor' → fault_candidate (state word + component)", () => {
    const caseId = `fp_en_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "found a bad flame sensor", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'thermocouple failed' → fault_candidate", () => {
    const caseId = `fp_en_3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "the thermocouple failed", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'bad thermocouple' → fault_candidate", () => {
    const caseId = `fp_en_4_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "this is a bad thermocouple", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'switch is defective' → fault_candidate", () => {
    const caseId = `fp_en_5_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "the switch is defective", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'defective switch' → fault_candidate", () => {
    const caseId = `fp_en_6_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "defective switch confirmed", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'thermistor failed' → fault_candidate", () => {
    const caseId = `fp_en_7_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "the thermistor failed open", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'sensor is bad' (bare sensor, no component qualifier) → fault_candidate", () => {
    const caseId = `fp_en_8_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "sensor is bad", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });
});

// ── Positive cases (Russian) ──────────────────────────────────────────

describe("FAULT_PATTERNS gap-closure — Russian sensor / switch-class phrases", () => {
  it("'датчик пламени неисправен' → fault_candidate", () => {
    const caseId = `fp_ru_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "датчик пламени неисправен", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'неисправный датчик' → fault_candidate", () => {
    const caseId = `fp_ru_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "неисправный датчик обнаружен", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'термопара сгорела' → fault_candidate", () => {
    const caseId = `fp_ru_3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "термопара сгорела", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'сломан переключатель' → fault_candidate", () => {
    const caseId = `fp_ru_4_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "сломан переключатель", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });
});

// ── Positive cases (Spanish) ──────────────────────────────────────────

describe("FAULT_PATTERNS gap-closure — Spanish sensor / switch-class phrases", () => {
  it("'sensor de llama defectuoso' → fault_candidate", () => {
    const caseId = `fp_es_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "sensor de llama defectuoso", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'termopar dañado' → fault_candidate", () => {
    const caseId = `fp_es_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "el termopar está dañado", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });

  it("'interruptor malo' → fault_candidate", () => {
    const caseId = `fp_es_3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "interruptor malo", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
  });
});

// ── Negative cases — no over-triggering ──────────────────────────────

describe("FAULT_PATTERNS gap-closure — unrelated / vague wording does NOT over-trigger", () => {
  it("'bad day'  → does NOT trigger fault_candidate (no sensor/switch noun)", () => {
    const caseId = `fp_neg_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "having a bad day with this unit", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
    expect(r.context.terminalState.faultIdentified).toBeNull();
  });

  it("'bad reading' → does NOT trigger fault_candidate (reading is not a component)", () => {
    const caseId = `fp_neg_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "got a bad reading on the meter", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
    expect(r.context.terminalState.faultIdentified).toBeNull();
  });

  it("'checked the sensor, looks ok' → does NOT trigger fault_candidate (no state word)", () => {
    const caseId = `fp_neg_3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "checked the flame sensor, looks ok", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
  });

  it("'sensor reading 5V' → does NOT trigger fault_candidate (measurement, not fault)", () => {
    const caseId = `fp_neg_4_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "thermocouple reading 5V on the meter", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
  });

  it("'switch to battery mode' → does NOT trigger fault_candidate (noun overlap, no fault state)", () => {
    const caseId = `fp_neg_5_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "switch to battery mode", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
  });

  it("'had a bad experience earlier' → does NOT trigger fault_candidate (no component)", () => {
    const caseId = `fp_neg_6_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);
    const r = processMessage(caseId, "had a bad experience earlier", DEFAULT_CONFIG);
    expect(r.context.terminalState.phase).toBe("normal");
  });
});

// ── Legality invariants — no broader completion doctrine change ──────

describe("FAULT_PATTERNS gap-closure — legality invariants preserved", () => {
  it("sensor-class fault alone does NOT reach terminal (restoration check still required)", () => {
    const caseId = `fp_legal_1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);

    // Fault phrase alone → fault_candidate, never terminal.
    const r = processMessage(caseId, "flame sensor is bad", DEFAULT_CONFIG);

    expect(r.context.terminalState.phase).toBe("fault_candidate");
    expect(r.context.isolationComplete).toBe(false);
    // Engine still asks the restoration check — downstream runtime gate.
    expect(r.responseInstructions.action).toBe("ask_restoration_check");
  });

  it("sensor-class fault → multi-turn → restoration confirmation → terminal (normal path, not short-circuited)", () => {
    const caseId = `fp_legal_2_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);

    // Turn 1: fault_candidate.
    const r1 = processMessage(caseId, "the thermocouple failed", DEFAULT_CONFIG);
    expect(r1.context.terminalState.phase).toBe("fault_candidate");
    expect(r1.context.isolationComplete).toBe(false);

    // Turn 2: restoration confirmation via existing
    // SIMPLE_RESTORATION_PATTERNS (unchanged by this PR).
    const r2 = processMessage(caseId, "replaced the thermocouple, heater works now", DEFAULT_CONFIG);
    expect(r2.context.terminalState.phase).toBe("terminal");
    expect(r2.context.isolationComplete).toBe(true);
  });

  it("MIN_STEPS_FOR_COMPLETION gate is preserved — sensor fault on turn 0 (no steps completed) does NOT reach fault_candidate", () => {
    // This PR does NOT touch MIN_STEPS_FOR_COMPLETION. The engine's
    // existing minimum-diagnostic-work guard still blocks fault
    // evaluation when totalDone < 1.
    const caseId = `fp_legal_3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    clearContext(caseId);
    clearRegistry(caseId);
    initializeCase(caseId, "water heater not working");
    // Deliberately do NOT seed any completed steps.
    const ctx = getOrCreateContext(caseId);
    ctx.primarySystem = "water_heater";
    ctx.activeProcedureId = "water_heater";
    updateContext(ctx);

    const r = processMessage(caseId, "flame sensor is bad", DEFAULT_CONFIG);

    // Engine stays in normal phase because MIN_STEPS gate blocks.
    expect(r.context.terminalState.phase).toBe("normal");
    expect(r.context.terminalState.faultIdentified).toBeNull();
  });

  it("RESTORATION_PATTERNS are unchanged — 'replaced sensor, works now' still reaches terminal directly (when eligible)", () => {
    // Full restoration (repair verb + operational confirmation) in ONE
    // message still reaches terminal directly via the existing
    // RESTORATION_PATTERNS path — unchanged by this PR.
    const caseId = `fp_legal_4_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    seedReadyForFaultEval(caseId);

    const r = processMessage(
      caseId,
      "replaced the flame sensor and heater works now",
      DEFAULT_CONFIG,
    );

    expect(r.context.terminalState.phase).toBe("terminal");
    expect(r.context.isolationComplete).toBe(true);
  });
});
