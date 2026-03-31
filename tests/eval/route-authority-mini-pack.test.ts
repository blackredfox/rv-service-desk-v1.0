/**
 * Route Authority Mini-Pack v1 — Test File
 *
 * Offline, deterministic tests for the highest-risk RVSD authority boundaries.
 *
 * Focus areas:
 * - server vs LLM authority conflict
 * - completion/terminal-state continuation
 * - semantic completion without explicit transition
 * - stale/fake final-report authority
 * - hidden step progression
 *
 * Reuses rvsdContractCheck. Does not duplicate checker logic.
 */

import { describe, expect, it } from "vitest";

import { rvsdContractCheck } from "@/lib/eval/rvsd-contract-check";

import {
  ROUTE_AUTHORITY_MINI_PACK_V1,
  type RouteAuthorityCase,
} from "../fixtures/eval/route-authority-mini-pack";

// ── Test Harness ─────────────────────────────────────────────────────────

function assertAuthorityCase(authorityCase: RouteAuthorityCase) {
  const result = rvsdContractCheck(authorityCase.input);

  expect(result.passed).toBe(authorityCase.expectedPassed);

  for (const violation of authorityCase.expectedViolationIncludes ?? []) {
    expect(result.violations).toContain(violation);
  }

  // Verify stable result shape
  expect(result.summary).toEqual(expect.any(String));
  expect(result.checks).toEqual(
    expect.objectContaining({
      modeClassValid: expect.any(Boolean),
      structureValid: expect.any(Boolean),
      languagePolicyValid: expect.any(Boolean),
      transitionRuleValid: expect.any(Boolean),
      prematureCompletionBlocked: expect.any(Boolean),
    }),
  );
}

// ── Main Test Suite ──────────────────────────────────────────────────────

describe("Route Authority Mini-Pack v1", () => {
  it("contains 6 authority-focused cases", () => {
    expect(ROUTE_AUTHORITY_MINI_PACK_V1).toHaveLength(6);
    expect(new Set(ROUTE_AUTHORITY_MINI_PACK_V1.map((entry) => entry.id)).size).toBe(6);
  });

  it.each(ROUTE_AUTHORITY_MINI_PACK_V1)("evaluates $id", (authorityCase) => {
    assertAuthorityCase(authorityCase);
  });

  it("has exactly one valid control case", () => {
    const passingCases = ROUTE_AUTHORITY_MINI_PACK_V1.filter(
      (entry) => entry.expectedPassed,
    );
    expect(passingCases).toHaveLength(1);
    expect(passingCases[0].id).toBe("terminal-completion-offer-valid");
  });

  it("covers all critical authority boundary violations", () => {
    const violationTypes = new Set<string>();
    for (const c of ROUTE_AUTHORITY_MINI_PACK_V1) {
      for (const v of c.expectedViolationIncludes ?? []) {
        violationTypes.add(v);
      }
    }

    // Must cover these authority-related violations
    expect(violationTypes).toContain("CONTRACT_PREMATURE_COMPLETION");
    expect(violationTypes).toContain("CONTRACT_EXPLICIT_TRANSITION_REQUIRED");
    expect(violationTypes).toContain("CONTRACT_DIAGNOSTIC_DRIFT");
    expect(violationTypes).toContain("CONTRACT_FINAL_REPORT_STRUCTURE");
    expect(violationTypes).toContain("CONTRACT_QUESTION_SHAPE");
  });
});

// ── Individual Case Documentation ────────────────────────────────────────

describe("Route Authority Mini-Pack v1 — Case Documentation", () => {
  it("terminal-completion-offer-valid: authority-safe completion transition", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "terminal-completion-offer-valid",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(true);
    expect(result.checks.modeClassValid).toBe(true);
    expect(result.checks.transitionRuleValid).toBe(true);
    expect(result.checks.prematureCompletionBlocked).toBe(true);
  });

  it("terminal-state-illegal-follow-up: detects continuation after terminal state", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "terminal-state-illegal-follow-up",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_PREMATURE_COMPLETION");
    // Response says "Isolation complete" — premature completion signal
  });

  it("semantic-completion-without-command: blocks implicit transition", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "semantic-completion-without-command",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_EXPLICIT_TRANSITION_REQUIRED");
    expect(result.checks.transitionRuleValid).toBe(false);
  });

  it("premature-final-report-generation: blocks report structure in diagnostic mode", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "premature-final-report-generation",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_DIAGNOSTIC_DRIFT");
    expect(result.checks.modeClassValid).toBe(false);
  });

  it("stale-final-report-missing-header: detects invalid report structure", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "stale-final-report-missing-header",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(false);
    expect(result.violations).toContain("CONTRACT_FINAL_REPORT_STRUCTURE");
    expect(result.checks.structureValid).toBe(false);
  });

  it("clarification-statement-only: blocks hidden step progression", () => {
    const c = ROUTE_AUTHORITY_MINI_PACK_V1.find(
      (x) => x.id === "clarification-statement-only",
    )!;
    const result = rvsdContractCheck(c.input);

    expect(result.passed).toBe(false);
    // Response lacks a question — hidden progression via statement block
    expect(result.violations).toContain("CONTRACT_QUESTION_SHAPE");
  });
});
