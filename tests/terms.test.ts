import { describe, expect, it, beforeEach, vi } from "vitest";
import { loadTermsAcceptance, storeTermsAcceptance } from "../src/lib/terms";

describe("terms acceptance localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("stores and loads acceptance with version and acceptedAt", () => {
    storeTermsAcceptance("v9.9");
    const loaded = loadTermsAcceptance();

    expect(loaded).not.toBeNull();
    expect(loaded?.accepted).toBe(true);
    expect(loaded?.version).toBe("v9.9");
    expect(typeof loaded?.acceptedAt).toBe("string");
    expect(new Date(loaded!.acceptedAt).toString()).not.toBe("Invalid Date");
  });

  it("returns null when nothing stored", () => {
    expect(loadTermsAcceptance()).toBeNull();
  });
});
