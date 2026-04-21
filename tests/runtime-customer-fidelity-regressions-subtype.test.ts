/**
 * Runtime Customer-Fidelity Regression Pack — Subtype Gating
 *
 * Coverage for ROADMAP §7.2 (subtype gating fidelity).
 *
 * These tests exercise the real diagnostic-registry — the mocked route
 * tests live in `runtime-customer-fidelity-regressions.test.ts` so
 * mocking does not collide with direct engine assertions here.
 *
 * Doctrine:
 *   - docs/CUSTOMER_BEHAVIOR_SPEC.md §4 (manufacturer / subtype priority)
 *   - ARCHITECTURE_RULES P1 (procedure is law — prerequisites enforced)
 *   - ROADMAP §7.2 (non-combo unit must not trigger combo-only steps)
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  initializeCase,
  clearRegistry,
  markStepCompleted,
  getNextStepId,
  getRegistryEntry,
  detectSubtypeExclusions,
  scanMessageForSubtypeAssertions,
} from "@/lib/diagnostic-registry";

describe("Regression 7.2 — Subtype gating fidelity (direct registry)", () => {
  const caseId = "runtime-regression-subtype";

  beforeEach(() => {
    clearRegistry(caseId);
  });

  it("implicit non-combo gas identification at wh_1 blocks combo-only wh_11 (Suburban gas unit)", () => {
    initializeCase(caseId, "water heater not heating");
    markStepCompleted(caseId, "wh_1", "Suburban SW10GE, gas");

    const entry = getRegistryEntry(caseId);
    expect(entry).toBeDefined();
    expect(entry!.subtypeExclusions.has("combo")).toBe(true);

    const served: string[] = [];
    let nextId = getNextStepId(caseId);
    let guard = 0;
    while (nextId && guard < 60) {
      served.push(nextId);
      markStepCompleted(caseId, nextId, "checked, ok");
      nextId = getNextStepId(caseId);
      guard++;
    }

    expect(served).not.toContain("wh_11");
  });

  it("implicit non-combo gas identification at wh_1 blocks wh_11 (Atwood gas phrasing)", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "Atwood gas water heater, model G6A-8E");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(true);

    const served: string[] = [];
    let nextId = getNextStepId(caseId);
    let guard = 0;
    while (nextId && guard < 60) {
      served.push(nextId);
      markStepCompleted(caseId, nextId, "checked, ok");
      nextId = getNextStepId(caseId);
      guard++;
    }
    expect(served).not.toContain("wh_11");
  });

  it("combo identification at wh_1 does NOT trigger the non-combo inference", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "combo gas and electric, Suburban");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(false);
  });

  it("'both' at wh_1 does NOT trigger the non-combo inference", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "it's both — gas and electric, Dometic");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(false);
  });

  it("electric-mentioning identification at wh_1 does NOT trigger the non-combo inference", () => {
    initializeCase(caseId, "water heater problem");
    markStepCompleted(caseId, "wh_1", "has an electric element, Suburban combo");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(false);
  });

  it("Russian implicit gas identification at wh_1 blocks wh_11", () => {
    initializeCase(caseId, "водонагреватель не работает");
    markStepCompleted(caseId, "wh_1", "Suburban, газовый");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(true);
  });

  it("explicit transcript-wide 'not combo' scan is still honored on any step", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "Suburban model SW10");

    const added = scanMessageForSubtypeAssertions(caseId, "это не COMBO, только gas");
    expect(added).toContain("combo");

    const entry = getRegistryEntry(caseId);
    expect(entry!.subtypeExclusions.has("combo")).toBe(true);
  });

  it("implicit gas inference is narrow: only fires on wh_1, never on other steps", () => {
    expect(detectSubtypeExclusions("wh_5", "Suburban gas water heater")).toEqual([]);
    expect(detectSubtypeExclusions("wh_6", "gas odor present")).toEqual([]);
    // On wh_1, implicit gas inference fires.
    expect(detectSubtypeExclusions("wh_1", "Suburban gas water heater")).toContain("combo");
  });
});
