import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildPrimaryFallbackResponse,
} from "@/lib/chat/response-validation-service";
import {
  resolveExplicitModeChange,
  resolveOutputSurface,
} from "@/lib/chat/chat-mode-resolver";
import {
  detectApprovedFinalReportIntent,
  detectReportRevisionIntent,
} from "@/lib/chat/report-intent";

const pureBoundaryModules = [
  "src/lib/chat/chat-request-preparer.ts",
  "src/lib/chat/chat-mode-resolver.ts",
  "src/lib/chat/prompt-context-builder.ts",
  "src/lib/chat/response-validation-service.ts",
  "src/lib/chat/final-report-flow-service.ts",
  "src/lib/chat/openai-execution-service.ts",
  "src/lib/chat/input-normalization.ts",
  "src/lib/chat/report-intent.ts",
  "src/lib/chat/repair-summary-intent.ts",
  "src/lib/chat/step-guidance-intent.ts",
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

  it("mode resolver refuses semantic completion inference and leaves natural report aliases to the route gate", () => {
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
    expect(explicitNaturalLanguage.changed).toBe(false);
    expect(explicitNaturalLanguage.nextMode).toBe("diagnostic");
    expect(explicitRussian.changed).toBe(false);
    expect(explicitRussian.nextMode).toBe("diagnostic");
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
      outputSurface: "diagnostic",
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

  it("output-surface resolution stays bounded to mode plus explicit surface hint", () => {
    expect(resolveOutputSurface({ mode: "diagnostic" })).toBe("diagnostic");
    expect(resolveOutputSurface({ mode: "authorization" })).toBe("authorization_ready");
    expect(resolveOutputSurface({ mode: "final_report" })).toBe("shop_final_report");
    expect(
      resolveOutputSurface({ mode: "final_report", requestedSurface: "portal_cause" }),
    ).toBe("portal_cause");
  });

  it("report intent helpers classify only bounded report signals and expose no flow decisions", () => {
    const reportIntent = detectApprovedFinalReportIntent("сделай воранти репорт");
    const reportEditIntent = detectReportRevisionIntent({
      message: "change total labor to 0.5 hr",
      hasExistingReport: true,
    });

    expect(reportIntent).toEqual({
      matched: true,
      matchedText: expect.any(String),
      reportKind: "warranty",
      requestedSurface: "shop_final_report",
    });
    expect(reportEditIntent).toEqual({
      matched: true,
      matchedText: expect.any(String),
      reportKind: undefined,
      requestedSurface: "shop_final_report",
      isLineEdit: false,
    });

    expect(reportIntent).not.toHaveProperty("nextStep");
    expect(reportIntent).not.toHaveProperty("mode");
    expect(reportEditIntent).not.toHaveProperty("branch");
    expect(reportEditIntent).not.toHaveProperty("completionAction");
  });
});