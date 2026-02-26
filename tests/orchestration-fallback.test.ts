import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Orchestration v5 - checklist fallback and pending report", () => {
  it("stores pendingReportRequest in case metadata", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");
    expect(content).toMatch(/pendingReportRequest/);
    expect(content).toMatch(/setPendingReportRequest/);
    expect(content).toMatch(/clearPendingReportRequest/);
    expect(content).toMatch(/updateCaseMetadata/);
  });

  it("includes checklist fallback helper", () => {
    const content = readFileSync(join(process.cwd(), "src", "app", "api", "chat", "route.ts"), "utf-8");
    expect(content).toMatch(/buildChecklistResponse/);
    expect(content).toMatch(/fallback:\s*"checklist"/);
  });
});

describe("UI fallback banner and retry", () => {
  it("renders LLM status banner and Retry AI button", () => {
    const content = readFileSync(join(process.cwd(), "src", "components", "chat-panel.tsx"), "utf-8");
    expect(content).toMatch(/llm-status-banner/);
    expect(content).toMatch(/retry-ai-button/);
    expect(content).toMatch(/Retry AI/);
  });
});
