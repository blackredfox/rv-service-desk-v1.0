import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildPrimaryFallbackResponse,
} from "@/lib/chat/response-validation-service";
import {
  resolveExplicitModeChange,
} from "@/lib/chat/chat-mode-resolver";

const pureBoundaryModules = [
  "src/lib/chat/chat-request-preparer.ts",
  "src/lib/chat/chat-mode-resolver.ts",
  "src/lib/chat/prompt-context-builder.ts",
  "src/lib/chat/response-validation-service.ts",
  "src/lib/chat/final-report-flow-service.ts",
  "src/lib/chat/openai-execution-service.ts",
];

describe("No Hidden Authority — Route Decomposition", () => {
  it.each(pureBoundaryModules)(
    "%s does not import diagnostic authority modules",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");

      expect(source).not.toMatch(/@\/lib\/context-engine/);
      expect(source).not.toMatch(/@\/lib\/diagnostic-registry/);
      expect(source).not.toMatch(/processContextMessage/);
      expect(source).not.toMatch(/getNextStepId/);
      expect(source).not.toMatch(/processResponseForBranch/);
    },
  );

  it("mode resolver refuses semantic completion inference but accepts explicit report commands", () => {
    const semantic = resolveExplicitModeChange(
      "diagnostic",
      "I think the repair is complete, the heater works now.",
    );

    const explicitNaturalLanguage = resolveExplicitModeChange(
      "diagnostic",
      "Write report",
    );

    const explicitRussian = resolveExplicitModeChange(
      "diagnostic",
      "Напиши отчет",
    );

    const explicit = resolveExplicitModeChange(
      "diagnostic",
      "START FINAL REPORT",
    );

    expect(semantic.changed).toBe(false);
    expect(explicitNaturalLanguage.changed).toBe(true);
    expect(explicitNaturalLanguage.nextMode).toBe("final_report");
    expect(explicitRussian.changed).toBe(true);
    expect(explicitRussian.nextMode).toBe("final_report");
    expect(explicit.changed).toBe(true);
    expect(explicit.nextMode).toBe("final_report");
  });

  it("fallback rendering only mirrors supplied authoritative step metadata", () => {
    const fallback = buildPrimaryFallbackResponse({
      validation: {
        valid: false,
        violations: ["STEP_COMPLIANCE: wrong step rendered"],
      },
      mode: "diagnostic",
      outputLanguage: "EN",
      langPolicy: { mode: "AUTO", primaryOutput: "EN", includeTranslation: false },
      activeStepMetadata: {
        id: "wh_3",
        question: "Is 12V present at the water heater control input?",
        procedureName: "Water Heater",
        progress: { completed: 2, total: 6 },
      },
      activeStepId: "wh_9",
    });

    expect(fallback).toContain("Step wh_3");
    expect(fallback).toContain("Is 12V present at the water heater control input?");
    expect(fallback).not.toContain("Step wh_9");
  });

  it("route remains the boundary that invokes Context Engine directly", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8",
    );

    expect(source).toMatch(/processContextMessage\(/);
    expect(source).toMatch(/currentMode === "diagnostic"/);
  });
});