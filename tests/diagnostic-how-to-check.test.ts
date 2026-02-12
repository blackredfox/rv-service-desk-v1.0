import { describe, it, expect, beforeEach } from "vitest";
import {
  initializeCase,
  processUserMessage,
  buildRegistryContext,
  clearRegistry,
  getRegistryEntry,
  markStepAsked,
  isStepAlreadyAsked,
  detectHowToCheck,
} from "@/lib/diagnostic-registry";
import { getProcedure, getStepHowToCheck } from "@/lib/diagnostic-procedures";

// ── How-to-check detection ──────────────────────────────────────────

describe("how-to-check detection", () => {
  it.each([
    "how to check?",
    "How do I test that?",
    "how can I measure voltage",
    "how should I verify the ground",
    "как проверить",
    "как мне протестировать",
    "cómo puedo verificar",
    "explain how to do that",
    "tell me how",
  ])('detects "%s" as how-to-check', (msg) => {
    expect(detectHowToCheck(msg)).toBe(true);
  });

  it.each([
    "fuse is blown",
    "12.6 volts",
    "yes ground is good",
    "already checked",
    "I can't check that",
  ])('does NOT detect "%s" as how-to-check', (msg) => {
    expect(detectHowToCheck(msg)).toBe(false);
  });
});

// ── How-to-check handling (step not closed) ─────────────────────────

describe("how-to-check handling in processUserMessage", () => {
  beforeEach(() => clearRegistry("htc-case"));

  it("returns howToCheckRequested=true and does NOT close any step", () => {
    initializeCase("htc-case", "awning won't extend");
    const result = processUserMessage("htc-case", "how to check?");

    expect(result.howToCheckRequested).toBe(true);
    expect(result.completedStepIds).toEqual([]);
    expect(result.unableStepIds).toEqual([]);
    expect(result.newAnswered).toEqual([]);
  });

  it("includes HOW-TO-CHECK INSTRUCTION in registry context", () => {
    initializeCase("htc-case", "awning won't extend");
    processUserMessage("htc-case", "how to check?");
    const ctx = buildRegistryContext("htc-case");

    expect(ctx).toContain("HOW-TO-CHECK INSTRUCTION");
    expect(ctx).toContain("Do NOT close this step");
    expect(ctx).toContain("re-ask the SAME step");
  });

  it("clears howToCheckRequested on the next normal message", () => {
    initializeCase("htc-case", "awning won't extend");
    processUserMessage("htc-case", "how to check?");

    // Now send a real answer
    const result2 = processUserMessage("htc-case", "battery is 12.6V");
    expect(result2.howToCheckRequested).toBe(false);

    const ctx2 = buildRegistryContext("htc-case");
    expect(ctx2).not.toContain("HOW-TO-CHECK INSTRUCTION");
  });
});

// ── getStepHowToCheck ───────────────────────────────────────────────

describe("getStepHowToCheck", () => {
  it("returns instruction for a valid step", () => {
    const proc = getProcedure("awning");
    expect(proc).not.toBeNull();
    const instruction = getStepHowToCheck(proc!, "awn_2");
    expect(instruction).toBeTruthy();
    expect(instruction).toContain("fuse");
  });

  it("returns null for step without instruction", () => {
    const proc = getProcedure("water_pump");
    expect(proc).not.toBeNull();
    // water_pump steps may not have howToCheck
    const step = proc!.steps[0];
    if (!step.howToCheck) {
      expect(getStepHowToCheck(proc!, step.id)).toBeNull();
    }
  });
});

// ── No duplicate steps (de-dupe guard) ──────────────────────────────

describe("step de-dupe guard", () => {
  beforeEach(() => clearRegistry("dedup-case"));

  it("markStepAsked returns true for first ask, false for duplicate", () => {
    initializeCase("dedup-case", "awning won't extend");
    expect(markStepAsked("dedup-case", "awn_1")).toBe(true);
    expect(markStepAsked("dedup-case", "awn_1")).toBe(false); // duplicate
  });

  it("isStepAlreadyAsked tracks correctly", () => {
    initializeCase("dedup-case", "awning won't extend");
    expect(isStepAlreadyAsked("dedup-case", "awn_1")).toBe(false);
    markStepAsked("dedup-case", "awn_1");
    expect(isStepAlreadyAsked("dedup-case", "awn_1")).toBe(true);
    expect(isStepAlreadyAsked("dedup-case", "awn_2")).toBe(false);
  });
});

// ── Awning procedure order ──────────────────────────────────────────

describe("awning procedure order", () => {
  it("exists and has correct step ordering", () => {
    const proc = getProcedure("awning");
    expect(proc).not.toBeNull();
    expect(proc!.displayName).toBe("Electric Awning (12V)");

    const ids = proc!.steps.map((s) => s.id);
    expect(ids).toEqual(["awn_1", "awn_2", "awn_3", "awn_4", "awn_5", "awn_6"]);
  });

  it("asks supply and fuse BEFORE motor direct power test", () => {
    const proc = getProcedure("awning")!;
    const supplyIdx = proc.steps.findIndex((s) => s.id === "awn_1");
    const fuseIdx = proc.steps.findIndex((s) => s.id === "awn_2");
    const directPowerIdx = proc.steps.findIndex((s) => s.id === "awn_6");

    expect(supplyIdx).toBeLessThan(directPowerIdx);
    expect(fuseIdx).toBeLessThan(directPowerIdx);
  });

  it("motor direct test (awn_6) requires motor voltage (awn_5) as prerequisite", () => {
    const proc = getProcedure("awning")!;
    const directPower = proc.steps.find((s) => s.id === "awn_6");
    expect(directPower!.prerequisites).toContain("awn_5");
  });

  it("awning fuse step is asked before switch step", () => {
    const proc = getProcedure("awning")!;
    const fuseStep = proc.steps.find((s) => s.id === "awn_2")!;
    const switchStep = proc.steps.find((s) => s.id === "awn_3")!;

    // Switch step requires fuse to be completed first
    expect(switchStep.prerequisites).toContain("awn_2");
    // Fuse step has no prerequisites
    expect(fuseStep.prerequisites).toEqual([]);
  });
});

// ── Electrical 12V procedure order ──────────────────────────────────

describe("electrical_12v procedure order", () => {
  it("has supply and fuse/CB steps before direct power test", () => {
    const proc = getProcedure("electrical_12v")!;
    const supplyIdx = proc.steps.findIndex((s) => s.id === "e12_1");
    const fuseIdx = proc.steps.findIndex((s) => s.id === "e12_2");
    const directPowerIdx = proc.steps.findIndex((s) => s.id === "e12_6");

    expect(supplyIdx).toBeLessThan(directPowerIdx);
    expect(fuseIdx).toBeLessThan(directPowerIdx);
  });

  it("direct power test requires voltage step as prerequisite", () => {
    const proc = getProcedure("electrical_12v")!;
    const directPower = proc.steps.find((s) => s.id === "e12_6");
    expect(directPower!.prerequisites).toContain("e12_5");
  });
});

// ── Portal-Cause correctness (fuse blown ≠ replace motor) ───────────

describe("portal-cause correctness", () => {
  beforeEach(() => clearRegistry("cause-case"));

  it("when fuse is blown, context does NOT skip to motor steps", () => {
    initializeCase("cause-case", "awning won't extend");

    // Report battery ok
    processUserMessage("cause-case", "battery is 12.6V, supply is present");
    // Report fuse blown
    processUserMessage("cause-case", "fuse is blown, no continuity");

    const ctx = buildRegistryContext("cause-case");

    // Fuse step should be marked as done
    expect(ctx).toContain("[DONE]");
    // The next step should NOT be the direct motor power test (awn_6)
    // because switch (awn_3) depends on fuse (awn_2 already done)
    // and motor voltage (awn_5) depends on switch+ground
    // With a blown fuse, the technician needs to fix it first
    expect(ctx).not.toContain("NEXT REQUIRED STEP: awn_6");
  });

  it("key finding 'blown fuse' triggers pivot (immediate isolation)", () => {
    initializeCase("cause-case", "awning won't extend");
    const result = processUserMessage("cause-case", "fuse is blown, no power downstream");

    // Key finding should be detected
    expect(result.keyFinding).toBeTruthy();
  });
});
