import { describe, expect, it } from "vitest";

import {
  RVSD_EXPLICIT_TRANSITION_RULE,
  checkExplicitTransitionDoctrine,
  rvsdContractCheck,
} from "@/lib/eval/rvsd-contract-check";
import { RVSD_CONTRACT_FIXTURES } from "../fixtures/rvsd-contract-check";

describe("rvsd-contract-check v1", () => {
  it("passes a valid diagnostic contract sample", () => {
    const result = rvsdContractCheck({
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticValid,
      dialogueLanguage: "EN",
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checks.modeClassValid).toBe(true);
    expect(result.checks.structureValid).toBe(true);
  });

  it("flags diagnostic drift into final report structure", () => {
    const result = rvsdContractCheck({
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticFinalReportDrift,
      dialogueLanguage: "EN",
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_DIAGNOSTIC_DRIFT");
    expect(result.checks.modeClassValid).toBe(false);
  });

  it("flags diagnostic premature completion and explicit-transition violations", () => {
    const result = rvsdContractCheck({
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticPrematureCompletion,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_PREMATURE_COMPLETION");
    expect(result.violations).toContain("CONTRACT_EXPLICIT_TRANSITION_REQUIRED");
    expect(result.checks.prematureCompletionBlocked).toBe(false);
    expect(result.checks.transitionRuleValid).toBe(false);
  });

  it("passes a valid final report sample", () => {
    const result = rvsdContractCheck({
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportValid,
      dialogueLanguage: "RU",
      includeTranslation: true,
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checks.structureValid).toBe(true);
    expect(result.checks.languagePolicyValid).toBe(true);
  });

  it("flags missing required final report headers", () => {
    const result = rvsdContractCheck({
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportMissingHeader,
      dialogueLanguage: "RU",
      includeTranslation: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_FINAL_REPORT_STRUCTURE");
    expect(result.checks.structureValid).toBe(false);
  });

  it("flags final report translation-policy mismatch", () => {
    const result = rvsdContractCheck({
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportLanguageMismatch,
      dialogueLanguage: "RU",
      includeTranslation: true,
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_FINAL_REPORT_LANGUAGE_POLICY");
    expect(result.checks.languagePolicyValid).toBe(false);
  });

  it("flags authorization drift into final report structure", () => {
    const result = rvsdContractCheck({
      mode: "authorization",
      responseText: RVSD_CONTRACT_FIXTURES.authorizationDrift,
      dialogueLanguage: "EN",
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_AUTHORIZATION_DRIFT");
    expect(result.checks.modeClassValid).toBe(false);
  });

  it("exposes the explicit transition doctrine as a deterministic helper", () => {
    const result = checkExplicitTransitionDoctrine({
      responseText: RVSD_CONTRACT_FIXTURES.transitionDoctrineNegative,
      explicitTransitionCommandGiven: false,
    });

    expect(RVSD_EXPLICIT_TRANSITION_RULE).toContain("semantic completion alone");
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["CONTRACT_EXPLICIT_TRANSITION_REQUIRED"]);
  });

  it("returns a stable result shape", () => {
    const result = rvsdContractCheck({
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticValid,
      dialogueLanguage: "EN",
    });

    expect(result).toEqual(
      expect.objectContaining({
        passed: expect.any(Boolean),
        violations: expect.any(Array),
        checks: expect.objectContaining({
          modeClassValid: expect.any(Boolean),
          structureValid: expect.any(Boolean),
          languagePolicyValid: expect.any(Boolean),
          transitionRuleValid: expect.any(Boolean),
          prematureCompletionBlocked: expect.any(Boolean),
        }),
        summary: expect.any(String),
      }),
    );
  });
});