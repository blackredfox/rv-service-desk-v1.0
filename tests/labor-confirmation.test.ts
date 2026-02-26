import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Orchestration v4 tests (replaces labor confirmation coverage).
 * Ensures report routing, telemetry scrubbing, model constant, and no labor_confirmation mode.
 */

describe("Orchestration v4 - command router", () => {
  it("detectUserCommand patterns include report and continue intents", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");

    expect(content).toContain("detectUserCommand");
    expect(content).toMatch(/computeCauseAllowed/);
    expect(content).toMatch(/isolationComplete/);
    expect(content).toMatch(/isolationFinding/);
    expect(content).toMatch(/submode\s*!==\s*\"clarification\"/);
    expect(content).toMatch(/hasProcedure/);
    expect(content).toMatch(/write\\s\+report/);
    expect(content).toMatch(/generate\\s\+report/);
    expect(content).toMatch(/напиши\\s\+репорт/);
    expect(content).toMatch(/сделай\\s\+отч/);
    expect(content).toMatch(/продолжаем/);
    expect(content).toMatch(/continue\\s\+diagnostic/);
  });
});

describe("Orchestration v4 - telemetry scrubber", () => {
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

describe("Orchestration v4 - no labor_confirmation mode", () => {
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

describe("Orchestration v4 - model constant", () => {
  it("uses OPENAI_MODEL constant for all OpenAI calls", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");
    expect(content).toContain('const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-latest"');
    expect(content).toMatch(/model:\s*OPENAI_MODEL/g);
    expect(content).not.toMatch(/model:\s*"gpt-/);
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
