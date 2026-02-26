import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Orchestration v4 tests (replaces labor confirmation coverage).
 * Ensures report routing, telemetry scrubbing, model constant, and no labor_confirmation mode.
 */

describe("Orchestration v4 - command router", () => {
  beforeEach(() => { vi.resetModules(); });

  it("detectUserCommand handles report and continue", async () => {
    const { detectUserCommand } = await import("@/app/api/chat/route");

    expect(detectUserCommand("write report please")).toBe("REPORT_REQUEST");
    expect(detectUserCommand("напиши репорт по этому")).toBe("REPORT_REQUEST");
    expect(detectUserCommand("сделай отчет по диагностике")).toBe("REPORT_REQUEST");
    expect(detectUserCommand("продолжаем диагностику")).toBe("CONTINUE_DIAGNOSTICS");
    expect(detectUserCommand("давай дальше")).toBe("CONTINUE_DIAGNOSTICS");
  });
});

describe("Orchestration v4 - telemetry scrubber", () => {
  beforeEach(() => { vi.resetModules(); });

  it("removes internal telemetry lines", async () => {
    const { scrubTelemetry } = await import("@/app/api/chat/route");
    const input = [
      "System: Water Pump",
      "Status: Isolation not complete",
      "Step wp_1: Verify pump noise",
      "Actual question?",
    ].join("\n");

    expect(scrubTelemetry(input)).toBe("Actual question?");
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
