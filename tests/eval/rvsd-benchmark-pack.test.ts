import { describe, expect, it } from "vitest";

import { rvsdContractCheck } from "@/lib/eval/rvsd-contract-check";

import {
  RVSD_BENCHMARK_PACK_V1,
  type RVSDBenchmarkCase,
} from "../fixtures/eval/rvsd-benchmark-pack";

function assertBenchmarkCase(benchmarkCase: RVSDBenchmarkCase) {
  const result = rvsdContractCheck(benchmarkCase.input);

  expect(result.passed).toBe(benchmarkCase.expectedPassed);

  for (const violation of benchmarkCase.expectedViolationIncludes ?? []) {
    expect(result.violations).toContain(violation);
  }

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

describe("RVSD benchmark pack v1", () => {
  it("contains 10 high-signal benchmark cases", () => {
    expect(RVSD_BENCHMARK_PACK_V1).toHaveLength(10);
    expect(new Set(RVSD_BENCHMARK_PACK_V1.map((entry) => entry.id)).size).toBe(10);
  });

  it.each(RVSD_BENCHMARK_PACK_V1)("evaluates $id", (benchmarkCase) => {
    assertBenchmarkCase(benchmarkCase);
  });

  it("keeps at least two valid controls in the pack", () => {
    const passingCases = RVSD_BENCHMARK_PACK_V1.filter((entry) => entry.expectedPassed);
    expect(passingCases.map((entry) => entry.id)).toEqual([
      "diagnostic-valid-control",
      "final-report-valid-control",
    ]);
  });
});