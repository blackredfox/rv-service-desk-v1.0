import { describe, expect, it } from "vitest";

describe("Spanish detection + language fallback", () => {
  it("detects Spanish for uppercase RV diagnostic sentence", async () => {
    const { detectLanguage } = await import("@/lib/lang");

    const result = detectLanguage("LA BOMBA DE AGUA NO FUNCIONA");

    expect(result.language).toBe("ES");
    expect(result.reason).toContain("spanish");
  });

  it("forces Spanish output for explicit requests", async () => {
    const { detectForcedOutputLanguage } = await import("@/lib/lang");

    expect(detectForcedOutputLanguage("habla espanol")).toBe("ES");
    expect(detectForcedOutputLanguage("habla español")).toBe("ES");
    expect(detectForcedOutputLanguage("spanish")).toBe("ES");
  });

  it("returns neutral language chooser fallback when language is unknown", async () => {
    const { getSafeFallback } = await import("@/lib/mode-validators");

    expect(getSafeFallback("diagnostic", "AUTO")).toBe(
      "Please choose language: English / Русский / Español"
    );
  });
});
