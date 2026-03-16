import { describe, it, expect } from "vitest";
import { validateDiagnosticOutput } from "@/lib/mode-validators";

describe("Isolation Declaration Detection", () => {
  it("should block 'Изоляция завершена' in diagnostic output", () => {
    const result = validateDiagnosticOutput("Понял. Изоляция завершена. Условия выполнены.");
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });

  it("should block 'isolation complete' in English", () => {
    const result = validateDiagnosticOutput("Noted. The isolation is complete based on this finding.");
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });

  it("should block 'conditions met' in English", () => {
    const result = validateDiagnosticOutput("Good. Conditions are met for final report.");
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });

  it("should block '[TRANSITION: FINAL_REPORT]' marker", () => {
    const result = validateDiagnosticOutput("Finding noted. [TRANSITION: FINAL_REPORT]");
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("TRANSITION_MARKER_BLOCKED"))).toBe(true);
  });

  it("should allow normal diagnostic question without isolation language", () => {
    const result = validateDiagnosticOutput("Noted. What is the voltage reading at the pump terminals?");
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("should block Russian 'условия выполнены'", () => {
    const result = validateDiagnosticOutput("Принял. Условия выполнены для формирования отчёта.");
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });
});
