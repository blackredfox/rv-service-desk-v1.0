/**
 * Regression tests for LP tank/valve step loop bug.
 *
 * Root cause: context-engine never synced activeProcedureId from the registry,
 * so activeStepId was never assigned, and the LLM drove the diagnostic flow.
 *
 * Fix: processMessage step 0 syncs activeProcedureId from the registry
 * using registryProcedure.system (not .id, which doesn't exist on the type).
 */

import { describe, it, expect } from "vitest";

describe("LP step loop regression", () => {
  it("газовый Suburban → Баллон полный → LP tank/valve step does NOT repeat", async () => {
    const { processMessage, clearContext } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");

    clearRegistry("lp_reg_1");
    clearContext("lp_reg_1");

    // Turn 1: report the problem
    initializeCase("lp_reg_1", "не работает водонагреватель");
    const r1 = processMessage("lp_reg_1", "не работает водонагреватель", DEFAULT_CONFIG);
    expect(r1.context.activeStepId).toBe("wh_1");

    // Turn 2: heater type → completes wh_1, advances to wh_2 (LP tank/valve)
    initializeCase("lp_reg_1", "газовый Suburban");
    const r2 = processMessage("lp_reg_1", "газовый Suburban", DEFAULT_CONFIG);
    expect(r2.context.completedSteps.has("wh_1")).toBe(true);
    expect(r2.context.activeStepId).toBe("wh_2");

    // Turn 3: answer LP tank question → completes wh_2, advances to wh_3
    initializeCase("lp_reg_1", "Баллон полный. Клапан полностью открыт");
    const r3 = processMessage("lp_reg_1", "Баллон полный. Клапан полностью открыт", DEFAULT_CONFIG);
    expect(r3.context.completedSteps.has("wh_2")).toBe(true);
    // LP tank/valve step must NOT be repeated
    expect(r3.context.activeStepId).not.toBe("wh_1");
    expect(r3.context.activeStepId).not.toBe("wh_2");
    expect(r3.context.activeStepId).toBe("wh_3");
  });

  it("after answering LP appliances (wh_3), system does NOT return to LP tank step", async () => {
    const { processMessage, clearContext } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");

    clearRegistry("lp_reg_2");
    clearContext("lp_reg_2");

    // Turn 1: report
    initializeCase("lp_reg_2", "не работает водонагреватель");
    processMessage("lp_reg_2", "не работает водонагреватель", DEFAULT_CONFIG);

    // Turn 2: heater type
    initializeCase("lp_reg_2", "газовый Suburban");
    processMessage("lp_reg_2", "газовый Suburban", DEFAULT_CONFIG);

    // Turn 3: LP tank full, valve open
    initializeCase("lp_reg_2", "Баллон полный. Клапан полностью открыт");
    processMessage("lp_reg_2", "Баллон полный. Клапан полностью открыт", DEFAULT_CONFIG);

    // Turn 4: other LP appliances work → yes
    initializeCase("lp_reg_2", "да, плита работает");
    const r4 = processMessage("lp_reg_2", "да, плита работает", DEFAULT_CONFIG);
    expect(r4.context.completedSteps.has("wh_3")).toBe(true);
    // Must be on wh_4 or later — never back to wh_1 or wh_2
    expect(r4.context.activeStepId).not.toBe("wh_1");
    expect(r4.context.activeStepId).not.toBe("wh_2");
    expect(r4.context.activeStepId).not.toBe("wh_3");
    // wh_4 has prerequisite ["wh_2"] which is met
    expect(r4.context.activeStepId).toBe("wh_4");
  });
});
