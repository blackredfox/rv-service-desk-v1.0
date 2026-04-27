/**
 * Blockers 1 & 2 — repair-status leak and output-surface metadata leak.
 *
 * These tests assert two cross-cutting invariants on the user-visible
 * output that go beyond a single case transcript:
 *
 *   1. Validator/retry status (`[System] Repairing output...`,
 *      `[System] Repairing clarification...`) MUST never appear in the
 *      streamed SSE tokens or in the persisted assistant message.
 *      It is server-side observability only — emitted via `logFlow`
 *      and `logTiming`, never via `emitToken`. Defense in depth: the
 *      diagnostic-output sanitizer also drops `[System] Repairing...`
 *      lines/inlines so an LLM echo can never leak it.
 *
 *   2. The OUTPUT SURFACE (MANDATORY) prompt-fragment header (e.g.
 *      `Active surface: shop_final_report`) MUST never leak into a
 *      final-report body or its translation. The sanitizer drops the
 *      English banner AND its localized auto-translations
 *      (`Активная поверхность: ...` / `Superficie activa: ...`).
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  wrapEmitterWithDiagnosticSanitizer,
} from "@/lib/chat/diagnostic-output-sanitizer";

// ── Blocker 1 — repair-status leak ban ──────────────────────────────

describe("Blocker 1 — `[System] Repairing output/clarification` is stripped from output", () => {
  it("drops a standalone `[System] Repairing output...` line", () => {
    const out = sanitizeText("[System] Repairing output...\n\nNext question.");
    expect(out).not.toContain("Repairing output");
    expect(out).not.toContain("[System]");
    expect(out).toContain("Next question.");
  });

  it("drops a standalone `[System] Repairing clarification...` line", () => {
    const out = sanitizeText("[System] Repairing clarification...\n\nWhat did you measure?");
    expect(out).not.toContain("Repairing clarification");
    expect(out).not.toContain("[System]");
    expect(out).toContain("What did you measure?");
  });

  it("strips `[System] Repairing output...` when concatenated mid-line", () => {
    const out = sanitizeText("Result OK. [System] Repairing output... continuing.");
    expect(out).not.toMatch(/\[System\]\s*Repairing/i);
    expect(out).toContain("Result OK.");
    expect(out).toContain("continuing.");
  });

  it("source-level guarantee — openai-execution-service no longer emits the marker as a token", async () => {
    // Static assertion — scan the source for any remaining
    // `emitToken(... [System] Repairing ...)` invocation. If a future
    // commit reintroduces one, this test fails immediately.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/chat/openai-execution-service.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/emitToken\([^)]*\[System\][^)]*Repairing/);
  });

  it("streaming wrapper drops the banner before it reaches SSE", () => {
    const captured: string[] = [];
    const wrapper = wrapEmitterWithDiagnosticSanitizer((tok) => captured.push(tok));
    wrapper.emit("\n\n[System] Repairing output...\n\n");
    wrapper.emit("Real assistant response.\n");
    wrapper.flush();
    const joined = captured.join("");
    expect(joined).not.toMatch(/\[System\]\s*Repairing/i);
    expect(joined).toContain("Real assistant response.");
  });
});

// ── Blocker 2 — output-surface metadata leak ban ────────────────────

describe("Blocker 2 — `Active surface: shop_final_report` is stripped from final-report bodies", () => {
  it("drops the literal English banner line", () => {
    const out = sanitizeText(
      [
        "OUTPUT SURFACE (MANDATORY):",
        "Active surface: shop_final_report.",
        "Generate the complete Shop Final Report only.",
        "",
        "Complaint: Water pump fails direct-power test.",
      ].join("\n"),
    );
    expect(out).not.toMatch(/Active\s+surface\s*:/i);
    expect(out).not.toMatch(/OUTPUT\s+SURFACE/i);
    // Preserve the legitimate report start.
    expect(out).toContain("Complaint:");
  });

  it("drops the auto-translated Russian banner from a translation block", () => {
    const out = sanitizeText(
      [
        "Complaint: Water pump fails direct-power test.",
        "",
        "--- TRANSLATION ---",
        "",
        "Активная поверхность: shop_final_report.",
        "Жалоба: Насос не работает при прямой подаче 12 В.",
      ].join("\n"),
      { replyLanguage: "RU" },
    );
    expect(out).not.toMatch(/Активная\s+поверхность/iu);
    expect(out).toContain("--- TRANSLATION ---");
    expect(out).toContain("Жалоба:");
    expect(out).toContain("Complaint:");
  });

  it("drops the Spanish auto-translated banner", () => {
    const out = sanitizeText(
      [
        "Complaint: Water pump fails direct-power test.",
        "",
        "Superficie activa: shop_final_report.",
        "Queja: La bomba no funciona con 12V directos.",
      ].join("\n"),
      { replyLanguage: "ES" },
    );
    expect(out).not.toMatch(/Superficie\s+activa/i);
    expect(out).toContain("Queja:");
    expect(out).toContain("Complaint:");
  });

  it("preserves the bilingual report skeleton and section headers", () => {
    const out = sanitizeText(
      [
        "Active surface: shop_final_report.",
        "Complaint: Water pump fails direct-power test.",
        "Diagnostic Procedure: Verified 12V at pump terminals; pump does not run.",
        "Verified Condition: Water pump motor failed direct-power test; replacement required.",
        "Recommended Corrective Action: Replace water pump.",
        "Estimated Labor: 0.5 hr.",
        "Required Parts: SHURflo 4008 fresh-water pump (1).",
        "",
        "--- TRANSLATION ---",
        "",
        "Активная поверхность: shop_final_report.",
        "Жалоба: Насос не работает при прямой подаче 12 В.",
        "Диагностическая процедура: Проверены 12 В на клеммах насоса.",
      ].join("\n"),
      { replyLanguage: "RU" },
    );
    // No internal routing metadata.
    expect(out).not.toMatch(/Active\s+surface/i);
    expect(out).not.toMatch(/Активная\s+поверхность/iu);
    expect(out).not.toContain("shop_final_report");
    // Bilingual format intact.
    expect(out).toContain("Complaint:");
    expect(out).toContain("--- TRANSLATION ---");
    expect(out).toContain("Жалоба:");
    expect(out).toContain("Diagnostic Procedure:");
  });
});

// ── Regression — diagnostic banners still drop ──────────────────────

describe("Blockers 1/2 — regression preservation", () => {
  it("water-heater first-turn banners are still dropped (Case 107 regression)", () => {
    const out = sanitizeText(
      [
        "Система: Водонагреватель",
        "Классификация: Сложное оборудование",
        "Шаг wh_3: Какой уровень в LP-баке?",
      ].join("\n"),
      { replyLanguage: "RU" },
    );
    expect(out).not.toMatch(/Система\s*:/);
    expect(out).not.toMatch(/Классификация\s*:/);
    expect(out).not.toMatch(/Шаг\s+wh_/);
    expect(out).toContain("Какой уровень в LP-баке");
  });

  it("Detected RU · Reply RU language banners still drop", () => {
    const out = sanitizeText("Detected RU · Reply RU\nКакой уровень?", {
      replyLanguage: "RU",
    });
    expect(out).not.toContain("Detected RU");
    expect(out).toContain("Какой уровень");
  });

  it("does not drop a legitimate `Estimated Labor:` final-report header", () => {
    const out = sanitizeText("Estimated Labor: 0.5 hr.");
    expect(out).toContain("Estimated Labor");
  });

  it("does not drop a legitimate `Verified Condition:` header", () => {
    const out = sanitizeText("Verified Condition: motor failed direct-power test.");
    expect(out).toContain("Verified Condition");
  });
});
