import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for tone adjustment in prompt files.
 *
 * Verifies:
 * - SYSTEM_PROMPT_BASE.txt: no over-polite patterns
 * - MODE_PROMPT_DIAGNOSTIC.txt: no "Thank you" defaults, has registry rules
 * - Professional, neutral communication style enforced
 */

describe("Tone Adjustment - Prompt Files", () => {
  beforeEach(() => { vi.resetModules(); });

  it("SYSTEM_PROMPT_BASE: no default 'Thank you' instruction", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    expect(content).not.toContain("Thank you for the information");
    expect(content).not.toContain("warmly");
    expect(content).not.toContain("Great question");
  });

  it("SYSTEM_PROMPT_BASE: has professional tone instructions", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    expect(content).toContain("Professional and concise");
    expect(content).toContain("Do NOT say");
    expect(content).toContain("Prefer silence over politeness");
  });

  it("MODE_PROMPT_DIAGNOSTIC: no 'Thank you' default", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8");

    expect(content).not.toContain("Warm acknowledgment");
    expect(content).not.toContain("acknowledge it warmly");
    expect(content).not.toContain("Provide encouraging feedback");
  });

  it("MODE_PROMPT_DIAGNOSTIC: has registry rules", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8");

    expect(content).toContain("DIAGNOSTIC REGISTRY RULES");
    expect(content).toContain("ALREADY ANSWERED");
    expect(content).toContain("UNABLE TO VERIFY");
    expect(content).toContain("NEVER repeat a question");
  });

  it("MODE_PROMPT_DIAGNOSTIC: has pivot rules", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8");

    expect(content).toContain("PIVOT RULES");
    expect(content).toContain("KEY FINDING");
    expect(content).toContain("IMMEDIATELY");
  });

  it("MODE_PROMPT_DIAGNOSTIC: allows at most one-word acknowledgment", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"), "utf-8");

    expect(content).toContain("ONE short");
    expect(content).toContain('"Noted."');
    expect(content).toContain('"Understood."');
  });
});

describe("Tone Adjustment - Behavior", () => {
  it("SYSTEM_PROMPT_BASE: prohibits repeating technician statements", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    expect(content).toContain("Never repeat what the technician just said");
  });

  it("SYSTEM_PROMPT_BASE: prohibits filler phrases", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    expect(content).toContain("Never use filler phrases");
  });

  it("SYSTEM_PROMPT_BASE: prohibits inventing facts", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"), "utf-8");

    expect(content).toContain("NEVER invent or assume facts");
  });
});
