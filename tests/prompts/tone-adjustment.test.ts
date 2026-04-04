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

  function expectNoWarmDefaultAcknowledgment(content: string) {
    expect(content).not.toMatch(/warm acknowledgment|acknowledge.*warmly|encouraging feedback/i);
  }

  function expectProfessionalToneContract(content: string) {
    expect(content).toMatch(/professional/i);
    expect(content).toMatch(/concise|neutral/i);
    expect(content).toMatch(/do not say|prefer silence|filler/i);
  }

  it("SYSTEM_PROMPT_BASE: no default 'Thank you' instruction", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    // Contract: no default warm/encouraging acknowledgment behavior
    expectNoWarmDefaultAcknowledgment(content);
    expect(content).toContain("Do NOT say");
  });

  it("SYSTEM_PROMPT_BASE: has professional tone instructions", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expectProfessionalToneContract(content);
  });

  it("MODE_PROMPT_DIAGNOSTIC: no 'Thank you' default", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expectNoWarmDefaultAcknowledgment(content);
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

    expect(content).toMatch(/one short/i);
    expect(content).toMatch(/"\w+\."/);
  });

  it("MODE_PROMPT_DIAGNOSTIC: has human-like reply guidance for colleague tone", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    // Contract: human-like diagnostic replies section exists
    expect(content).toContain("HUMAN-LIKE DIAGNOSTIC REPLIES");
    expect(content).toMatch(/senior technician partner/i);
    expect(content).toMatch(/colleague-like/i);
  });

  it("MODE_PROMPT_DIAGNOSTIC: human-like guidance is soft, not rigid", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    // Contract: preferred pattern, not mandatory template
    expect(content).toMatch(/preferred pattern/i);
    expect(content).toMatch(/not.*rigid/i);
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

    expect(content).toMatch(/never.*repeat.*technician/i);
  });

  it("SYSTEM_PROMPT_BASE: prohibits filler phrases", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toMatch(/never.*filler/i);
  });

  it("SYSTEM_PROMPT_BASE: prohibits inventing facts", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toMatch(/never.*invent.*assume facts/i);
  });
});