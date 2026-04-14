/**
 * Focused regression tests for:
 *   A. Object-first system identification (jack, water pump)
 *   B. Dirty-input normalization / resilience
 *   C. Ask-only-missing report extraction
 *   D. False terminal / premature report prompting prevention
 *
 * Anchored to Case-44..51 acceptance pairs from the problem statement.
 */

import { describe, expect, it, beforeEach } from "vitest";

// ── A. Object-first routing tests ──────────────────────────────────

describe("Object-first system identification (detectSystem)", () => {
  let detectSystem: (msg: string) => string | null;

  beforeEach(async () => {
    const mod = await import("@/lib/diagnostic-procedures");
    detectSystem = mod.detectSystem;
  });

  // Pair 1 — Jack routing (Case-46 / Case-49)
  it("routes 'передний Jack не работает. 3500-LB electric tongue jack - Lippert' to tongue_jack, NOT converter", () => {
    const system = detectSystem("передний Jack не работает. 3500-LB electric tongue jack - Lippert");
    expect(system).toBe("tongue_jack");
    expect(system).not.toBe("inverter_converter");
  });

  it("routes 'front jack not working' to tongue_jack", () => {
    expect(detectSystem("front jack not working")).toBe("tongue_jack");
  });

  it("routes 'electric tongue jack Lippert' to tongue_jack", () => {
    expect(detectSystem("electric tongue jack Lippert")).toBe("tongue_jack");
  });

  it("routes 'electric jack' to tongue_jack, not inverter_converter", () => {
    const system = detectSystem("electric jack does not extend");
    expect(system).toBe("tongue_jack");
    expect(system).not.toBe("inverter_converter");
  });

  it("routes '3500-lb electric tongue jack' to tongue_jack", () => {
    expect(detectSystem("3500-lb electric tongue jack")).toBe("tongue_jack");
  });

  it("routes RU 'передний домкрат не работает' to tongue_jack", () => {
    expect(detectSystem("передний домкрат не работает")).toBe("tongue_jack");
  });

  // Pair 3 — Water pump routing (Case-44 / Case-51)
  it("routes 'water pump' to water_pump", () => {
    expect(detectSystem("water pump not working")).toBe("water_pump");
  });

  it("routes RU 'водяной насос не работает' to water_pump", () => {
    expect(detectSystem("водяной насос не работает")).toBe("water_pump");
  });

  it("routes typo RU 'водяноя насос' to water_pump after normalization would fix the typo, but also raw", () => {
    // The pattern /водяно\S*\s*насос/ should match "водяноя насос"
    expect(detectSystem("водяноя насос не работает")).toBe("water_pump");
  });

  it("routes 'насос воды не работает' (reversed word order) to water_pump", () => {
    expect(detectSystem("насос воды не работает")).toBe("water_pump");
  });

  // Negative: ensure converter/inverter still works for real converter complaints
  it("still routes 'converter not working' to inverter_converter", () => {
    expect(detectSystem("converter not working")).toBe("inverter_converter");
  });

  it("still routes 'inverter fault' to inverter_converter", () => {
    expect(detectSystem("inverter fault")).toBe("inverter_converter");
  });
});

// ── B. Dirty-input normalization tests ─────────────────────────────

describe("Dirty-input normalization", () => {
  let normalizeRoutingInput: (msg: string) => { normalizedMessage: string };

  beforeEach(async () => {
    const mod = await import("@/lib/chat/input-normalization");
    normalizeRoutingInput = mod.normalizeRoutingInput;
  });

  it("normalizes 'водяноя' typo to 'водяной'", () => {
    const result = normalizeRoutingInput("водяноя насос не работает");
    expect(result.normalizedMessage).toContain("водяной");
  });

  it("normalizes extra whitespace and punctuation", () => {
    const result = normalizeRoutingInput("water   pump!!!   not   working...");
    expect(result.normalizedMessage).toBe("water pump! not working.");
  });

  it("handles mixed RU/EN tokens", () => {
    const result = normalizeRoutingInput("водяной pump не работает");
    expect(result.normalizedMessage).toContain("водяной");
    expect(result.normalizedMessage).toContain("pump");
  });
});

// ── B2. Recovery after wrong initial routing ─────────────────────────

describe("Recovery after restated complaint (detectSystem)", () => {
  let detectSystem: (msg: string) => string | null;

  beforeEach(async () => {
    const mod = await import("@/lib/diagnostic-procedures");
    detectSystem = mod.detectSystem;
  });

  it("correctly routes restated water pump complaint even with noisy initial input", () => {
    // Simulates restated clear complaint after noisy initial message
    expect(detectSystem("водяной насос")).toBe("water_pump");
  });

  it("routes clear water pump restatement in English", () => {
    expect(detectSystem("the water pump is not working")).toBe("water_pump");
  });

  it("routes clear jack restatement after misrouting", () => {
    expect(detectSystem("tongue jack Lippert not working")).toBe("tongue_jack");
  });
});

// ── C. Ask-only-missing report extraction ──────────────────────────

describe("Ask-only-missing (assessRepairSummaryIntent)", () => {
  let assessRepairSummaryIntent: typeof import("@/lib/chat/repair-summary-intent").assessRepairSummaryIntent;

  beforeEach(async () => {
    const mod = await import("@/lib/chat/repair-summary-intent");
    assessRepairSummaryIntent = mod.assessRepairSummaryIntent;
  });

  // Pair 2 — Water pump report-ready single-message (Case-45 / Case-50)
  it("detects report-ready when technician provides complaint + findings + corrective conclusion in one RU message", () => {
    const message = [
      "водяной насос не работает.",
      "проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу.",
      "насос не рабочий и требует замены.",
      "0.5 часа.",
      "напиши warranty report",
    ].join(" ");

    const result = assessRepairSummaryIntent({
      message,
      hasReportRequest: true,
      priorUserMessages: [],
      hasActiveDiagnosticContext: true,
    });

    expect(result.hasComplaint).toBe(true);
    expect(result.hasFindings).toBe(true);
    expect(result.hasCorrectiveAction).toBe(true);
    expect(result.readyForReportRouting).toBe(true);
    expect(result.shouldAskClarification).toBe(false);
    expect(result.missingFields).toHaveLength(0);
  });

  it("detects report-ready for EN water pump dense message", () => {
    const message = [
      "Water pump not working.",
      "Checked voltage at pump terminals, 12V present.",
      "Connected direct power to pump, pump is dead.",
      "Pump needs replacement.",
      "0.5 hours labor.",
      "Write warranty report",
    ].join(" ");

    const result = assessRepairSummaryIntent({
      message,
      hasReportRequest: true,
      priorUserMessages: [],
      hasActiveDiagnosticContext: true,
    });

    expect(result.hasComplaint).toBe(true);
    expect(result.hasFindings).toBe(true);
    expect(result.hasCorrectiveAction).toBe(true);
    expect(result.readyForReportRouting).toBe(true);
  });

  it("still asks for missing corrective_action when only complaint + findings present", () => {
    const result = assessRepairSummaryIntent({
      message: "водяной насос не работает. проверил ток, есть 12 волт. напиши warranty report",
      hasReportRequest: true,
      priorUserMessages: [],
      hasActiveDiagnosticContext: true,
    });

    expect(result.hasComplaint).toBe(true);
    expect(result.hasFindings).toBe(true);
    expect(result.hasCorrectiveAction).toBe(false);
    expect(result.readyForReportRouting).toBe(false);
    expect(result.shouldAskClarification).toBe(true);
    expect(result.missingFields).toContain("corrective_action");
  });

  it("extracts from prior messages when current message is just the report request", () => {
    const result = assessRepairSummaryIntent({
      message: "напиши warranty report",
      hasReportRequest: true,
      priorUserMessages: [
        "водяной насос не работает",
        "проверил ток, подключил напрямую, насос не рабочий",
        "насос требует замены",
      ],
      hasActiveDiagnosticContext: true,
    });

    expect(result.hasComplaint).toBe(true);
    expect(result.hasFindings).toBe(true);
    expect(result.hasCorrectiveAction).toBe(true);
    expect(result.readyForReportRouting).toBe(true);
  });
});

// ── D. False terminal / premature report prompting prevention ──────

describe("False terminal prevention (updateTerminalState)", () => {
  let createContext: typeof import("@/lib/context-engine/context-engine").createContext;
  let processMessage: typeof import("@/lib/context-engine/context-engine").processMessage;
  let getOrCreateContext: typeof import("@/lib/context-engine/context-engine").getOrCreateContext;
  let clearContext: typeof import("@/lib/context-engine/context-engine").clearContext;

  beforeEach(async () => {
    const mod = await import("@/lib/context-engine/context-engine");
    createContext = mod.createContext;
    processMessage = mod.processMessage;
    getOrCreateContext = mod.getOrCreateContext;
    clearContext = mod.clearContext;
    clearContext("test_false_terminal");
  });

  // Pair 4 — Roof AC false terminal (Case-47 / Case-48)
  it("does NOT trigger fault_candidate when compressor starts then shuts off (unresolved)", () => {
    const ctx = createContext("test_false_terminal", "roof_ac", "complex");
    ctx.completedSteps.add("ac_1");
    ctx.completedSteps.add("ac_2");

    // Simulate: compressor tries to start but shuts off — this is unresolved, not a confirmed fault
    const result = processMessage(
      "test_false_terminal",
      "compressor starts then shuts off after a few seconds",
    );

    expect(result.context.terminalState.phase).toBe("normal");
    expect(result.context.terminalState.faultIdentified).toBeNull();
  });

  it("does NOT trigger fault_candidate when RU description is intermittent behavior", () => {
    const ctx = createContext("test_false_terminal", "roof_ac", "complex");
    ctx.completedSteps.add("ac_1");

    const result = processMessage(
      "test_false_terminal",
      "компрессор запускается и сразу выключается",
    );

    expect(result.context.terminalState.phase).toBe("normal");
    expect(result.context.terminalState.faultIdentified).toBeNull();
  });

  it("still allows fault_candidate for a confirmed dead component (no unresolved signal)", () => {
    const ctx = createContext("test_false_terminal", "water_pump", "non_complex");
    ctx.completedSteps.add("wp_1");
    ctx.completedSteps.add("wp_2");

    // Confirmed dead pump — this IS a fault, no unresolved signal
    const result = processMessage(
      "test_false_terminal",
      "the pump motor is dead, completely seized",
    );

    expect(result.context.terminalState.phase).toBe("fault_candidate");
    expect(result.context.terminalState.faultIdentified).not.toBeNull();
  });

  it("does NOT push terminal state when diagnostic path has unresolved late-stage evidence", () => {
    const ctx = createContext("test_false_terminal", "roof_ac", "complex");
    ctx.completedSteps.add("ac_1");
    ctx.completedSteps.add("ac_2");
    ctx.completedSteps.add("ac_3");
    ctx.completedSteps.add("ac_4");

    // Late-stage: "capacitor looks bulged" would normally trigger fault_candidate
    // but if combined with "compressor tries then fails", it's unresolved
    const result = processMessage(
      "test_false_terminal",
      "capacitor looks bulged but compressor tries to start then shuts off",
    );

    // The unresolved signal should prevent fault_candidate
    expect(result.context.terminalState.phase).toBe("normal");
  });
});

// ── E. Irrelevant attachment contamination ─────────────────────────

describe("Irrelevant attachment must not hijack routing", () => {
  let detectSystem: (msg: string) => string | null;

  beforeEach(async () => {
    const mod = await import("@/lib/diagnostic-procedures");
    detectSystem = mod.detectSystem;
  });

  it("routes based on text complaint even when message mentions irrelevant image content", () => {
    // Technician complains about water pump but also mentions an unrelated photo
    const msg = "водяной насос не работает. Вот фото другого ремонта что мы делали";
    expect(detectSystem(msg)).toBe("water_pump");
  });

  it("routes jack complaint correctly even with noise about converter in photo caption", () => {
    const msg = "передний Jack не работает. 3500-LB electric tongue jack - Lippert. (photo shows converter label)";
    expect(detectSystem(msg)).toBe("tongue_jack");
  });
});
