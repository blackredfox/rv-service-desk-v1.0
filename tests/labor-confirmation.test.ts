import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Orchestration v5 tests (resilience + routing + no labor confirmation).
 */

describe("Orchestration v5 - command router", () => {
  it("detectUserCommand patterns include report, retry, and continue intents", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");

    expect(content).toContain("detectUserCommand");
    expect(content).toMatch(/final\s+report/);
    expect(content).toMatch(/generate\s+report/);
    expect(content).toMatch(/reporte/);
    expect(content).toMatch(/informe/);
    expect(content).toMatch(/retry\s+ai/);
    expect(content).toMatch(/продолжаем/);
  });
});

describe("Orchestration v5 - telemetry scrubber", () => {
  it("scrubTelemetry removes internal telemetry lines", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");

    expect(content).toContain("scrubTelemetry");
    expect(content).toMatch(/TELEMETRY_PREFIXES/);
    expect(content).toMatch(/System:/);
    expect(content).toMatch(/Classification:/);
    expect(content).toMatch(/Status:/);
    expect(content).toMatch(/Step\|Шаг/);
    expect(content).toMatch(/TRANSITION: FINAL_REPORT/);
  });
});

describe("Orchestration v5 - no labor_confirmation mode", () => {
  it("core files contain no labor_confirmation references", () => {
    const root = process.cwd();
    const files = [
      join(root, "src", "app", "api", "chat", "route.ts"),
      join(root, "src", "lib", "prompt-composer.ts"),
      join(root, "src", "lib", "context-engine", "types.ts"),
      join(root, "src", "lib", "mode-validators.ts"),
    ];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toContain("labor_confirmation");
    }
  });
});

describe("Orchestration v5 - model allowlist", () => {
  it("uses allowlist fallback and resilience helpers", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");
    expect(content).toMatch(/getModelAllowlist/);
    expect(content).toMatch(/callOpenAIWithFallback/);
    expect(content).toMatch(/gpt-5\.1/);
    expect(content).toMatch(/gpt-4\.1/);
    expect(content).toMatch(/o4-mini/);
  });
});

describe("Final report format", () => {
  it("lists Required Parts before Estimated Labor (labor last)", () => {
    const content = readFileSync(join(process.cwd(), "prompts", "modes", "MODE_PROMPT_FINAL_REPORT.txt"), "utf-8");
    const partsIndex = content.indexOf("Required Parts:");
    const laborIndex = content.indexOf("Estimated Labor:");
    expect(partsIndex).toBeGreaterThan(-1);
    expect(laborIndex).toBeGreaterThan(-1);
    expect(partsIndex).toBeLessThan(laborIndex);
  });
});
