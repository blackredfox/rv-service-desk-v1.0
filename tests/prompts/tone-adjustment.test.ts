import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for tone adjustment in prompt files.
 *
 * Verifies:
 * - SYSTEM_PROMPT_BASE.txt: no over-polite patterns
 * - MODE_PROMPT_DIAGNOSTIC.txt: no "Thank you" defaults, has registry rules
 * - Professional, neutral communication style enforced
 * - Prompt checks use contract-shape assertions where exact historical wording
 *   is not required by the active contract
 */

describe("Tone Adjustment - Prompt Files", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("SYSTEM_PROMPT_BASE: no default 'Thank you' instruction", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    // Should not instruct the agent to say "Thank you for the information" as a default behavior
    expect(content).not.toContain("Acknowledge technician's responses warmly");
    expect(content).not.toContain("acknowledge it warmly");
    // "Great question" may appear as an example of what NOT to say — that's fine
    expect(content).toContain("Do NOT say");
  });

  it("SYSTEM_PROMPT_BASE: has professional tone instructions", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toContain("Professional and concise");
    expect(content).toContain("Do NOT say");
    expect(content).toContain("Prefer silence over politeness");
  });

  it("MODE_PROMPT_DIAGNOSTIC: no 'Thank you' default", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).not.toContain("Warm acknowledgment");
    expect(content).not.toContain("acknowledge it warmly");
    expect(content).not.toContain("Provide encouraging feedback");
  });

  it("MODE_PROMPT_DIAGNOSTIC: has procedure and registry rules", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toContain("PROCEDURE IS LAW");
    expect(content).toContain("DIAGNOSTIC REGISTRY RULES");
    expect(content).toContain("NEVER repeat a question");
  });

  it("MODE_PROMPT_DIAGNOSTIC: has key findings rules (acknowledge but continue)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toContain("KEY FINDINGS");


    // Contract-shape assertions:
    // 1) key findings must be acknowledged
    // 2) diagnostics must continue rather than terminate on a single finding
    expect(content).toMatch(/acknowledge/i);
    expect(content).toMatch(/continue/i);

    // Guard against accidental termination semantics
    expect(content).toMatch(/does NOT end diagnostics|CONTINUE diagnostics|CONTINUE with remaining diagnostic steps/i);
  });

  it("MODE_PROMPT_DIAGNOSTIC: enforces explicit-only mode transitions", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toContain("MODE TRANSITION RULES (EXPLICIT ONLY)");
    expect(content).toContain("CANNOT automatically switch to final_report mode");
    expect(content).toContain("START FINAL REPORT");
    expect(content).not.toContain("[TRANSITION: FINAL_REPORT]");
  });

  it("MODE_PROMPT_DIAGNOSTIC: allows at most one-word acknowledgment", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toContain("ONE short");
    expect(content).toContain('"Noted."');
    expect(content).toContain('"Understood."');
  });
});

describe("Tone Adjustment - Behavior", () => {
  it("SYSTEM_PROMPT_BASE: prohibits repeating technician statements", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toContain("Never repeat what the technician just said");
  });

  it("SYSTEM_PROMPT_BASE: prohibits filler phrases", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toContain("Never use filler phrases");
  });

  it("SYSTEM_PROMPT_BASE: prohibits inventing facts", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toContain("NEVER invent or assume facts");
  });
});