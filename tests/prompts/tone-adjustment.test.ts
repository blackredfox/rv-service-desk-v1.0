import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for tone adjustment in prompt files.
 *
 * Verifies:
 * - SYSTEM_PROMPT_BASE.txt: no over-polite patterns
 * - MODE_PROMPT_DIAGNOSTIC.txt: no "Thank you" defaults, has semantic diagnostic-boundary rules
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

  it("MODE_PROMPT_DIAGNOSTIC: has semantic procedure and runtime-boundary rules", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toContain("server-bounded, not server-scripted");
    expect(content).toMatch(/active diagnostic procedure|runtime context/i);
    expect(content).toMatch(/do not invent steps|do not.*reorder the procedure|do not.*switch systems/i);
    expect(content).toMatch(/do not repeat a question already marked complete or closed by runtime/i);
  });

  it("MODE_PROMPT_DIAGNOSTIC: preserves grounded diagnostic wording instead of scripted labels", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toMatch(/factual and grounded/i);
    expect(content).toMatch(/do not invent or overstate conclusions/i);
    expect(content).toMatch(/do not turn grounded diagnostic replies into bureaucratic approval language/i);
    expect(content).toMatch(/metadata.*not mandatory spoken headers/i);
  });

  it("MODE_PROMPT_DIAGNOSTIC: enforces server-owned transition boundaries", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toMatch(/never switch modes on your own/i);
    expect(content).toMatch(/server-approved explicit command or approved alias path already resolved by runtime/i);
    expect(content).toMatch(/do not generate a final report or portal cause from diagnostic mode/i);
  });

  it("MODE_PROMPT_DIAGNOSTIC: keeps concise acknowledgment behavior", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/modes/MODE_PROMPT_DIAGNOSTIC.txt"),
      "utf-8",
    );

    expect(content).toMatch(/use at most one short acknowledgment/i);
    expect(content).toMatch(/no filler|no motivational chatter|no status-screen bureaucracy/i);
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

  it("SYSTEM_PROMPT_BASE: preserves manufacturer-consistent path fidelity", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(
      join(process.cwd(), "prompts/system/SYSTEM_PROMPT_BASE.txt"),
      "utf-8",
    );

    expect(content).toMatch(/manufacturer-specific equipment identity/i);
    expect(content).toMatch(/manufacturer-consistent diagnostic path/i);
  });
});