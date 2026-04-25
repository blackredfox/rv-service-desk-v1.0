/**
 * Case-88 manual-acceptance revision.
 *
 * Three product axes verified here (technician-facing response governance
 * for the dense water-pump warranty-report scenario):
 *
 *   1. Sanitizer coverage — when the LLM rephrases the procedure-context
 *      banner into a human-readable header (e.g. "Water Pump — Пошаговая
 *      диагностика") OR concatenates a step-id prefix with raw English
 *      registry text in a RU/ES reply (e.g. "Шаг wp_2: Measure voltage at
 *      the pump motor terminals…"), the sanitizer MUST drop the leakage.
 *
 *   2. Server-owned water-pump direct-power isolation — when the active
 *      procedure is `water_pump` AND the technician's transcript includes
 *      both "12V applied directly to the pump" AND "pump does not run"
 *      cues, the Context Engine flips `isolationComplete = true` with a
 *      synthesized finding. This is bypass-safe: it bypasses
 *      MIN_STEPS_FOR_COMPLETION because the direct-power test IS itself
 *      the diagnostic conclusion for a pump.
 *
 *   3. The detection is narrow — neither cue alone, nor the cues for an
 *      unrelated active procedure, must trigger isolation.
 *
 * Tests are deterministic and DO NOT call a real LLM.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  sanitizeLine,
  wrapEmitterWithDiagnosticSanitizer,
} from "@/lib/chat/diagnostic-output-sanitizer";
import {
  detectWaterPumpDirectPowerIsolation,
  processMessage,
  getOrCreateContext,
  clearContext,
  updateContext,
} from "@/lib/context-engine/context-engine";
import {
  initializeCase,
  clearRegistry,
} from "@/lib/diagnostic-registry";
import { DEFAULT_CONFIG } from "@/lib/context-engine/types";

// ── Sanitizer coverage ────────────────────────────────────────────────

describe("Case-88 sanitizer coverage", () => {
  it("drops `<Procedure name> — Пошаговая диагностика` header banner (RU)", () => {
    expect(sanitizeLine("Water Pump — Пошаговая диагностика")).toBeNull();
    expect(sanitizeLine("Water Heater — Пошаговая диагностика")).toBeNull();
    expect(
      sanitizeLine("Bomba de agua — Пошаговая диагностика"),
    ).toBeNull();
  });

  it("drops English / Spanish equivalents of the procedure header banner", () => {
    expect(sanitizeLine("Water Pump — Step-by-step diagnostics")).toBeNull();
    expect(sanitizeLine("Water Pump - step by step diagnostic")).toBeNull();
    expect(
      sanitizeLine("Bomba de agua — Diagnóstico paso a paso"),
    ).toBeNull();
  });

  it("drops `Шаг wp_2: <english text>` when reply language is RU (Case-88)", () => {
    const out = sanitizeLine(
      "Шаг wp_2: Measure voltage at the pump motor terminals with faucet open. Is 12V DC present? Exact reading?",
      { replyLanguage: "RU" },
    );
    expect(out).toBeNull();
  });

  it("drops `Step wp_2: <english text>` ONLY when reply language is RU/ES (no drop in EN)", () => {
    const en = sanitizeLine(
      "Step wp_2: Measure voltage at the pump motor terminals with faucet open.",
      { replyLanguage: "EN" },
    );
    expect(en).not.toBeNull();
    expect(en).toContain("Measure voltage");
    expect(en).not.toMatch(/Step\s+wp_2:/i);
  });

  it("keeps `Шаг wp_2: <russian text>` when residual is in RU", () => {
    const out = sanitizeLine(
      "Шаг wp_2: Измерьте напряжение на клеммах насоса.",
      { replyLanguage: "RU" },
    );
    expect(out).not.toBeNull();
    expect(out).toContain("Измерьте напряжение");
    expect(out).not.toMatch(/Шаг\s+wp_2/);
  });

  it("drops `Paso wp_2: <english text>` when reply language is ES", () => {
    const out = sanitizeLine(
      "Paso wp_2: Measure voltage at the pump motor terminals.",
      { replyLanguage: "ES" },
    );
    expect(out).toBeNull();
  });

  it("preserves natural diagnostic prose in RU (no over-sanitization)", () => {
    const out = sanitizeLine(
      "Понял — отчёт нужен. Готовлю warranty-report по вашим данным.",
      { replyLanguage: "RU" },
    );
    expect(out).toBe(
      "Понял — отчёт нужен. Готовлю warranty-report по вашим данным.",
    );
  });

  it("streaming sanitizer drops the full Case-88 leakage block in one pass", () => {
    const collected: string[] = [];
    const emitter = wrapEmitterWithDiagnosticSanitizer(
      (t) => collected.push(t),
      { replyLanguage: "RU" },
    );
    const banner = [
      "Detected RU · Reply RU",
      "Water Pump — Пошаговая диагностика",
      "Прогресс: 1/5 шагов завершено",
      "",
      "Шаг wp_2: Measure voltage at the pump motor terminals with faucet open. Is 12V DC present? Exact reading?",
      "",
    ].join("\n");
    emitter.emit(banner);
    emitter.flush();
    const body = collected.join("");

    // Case-88 specific assertions
    expect(body).not.toContain("Detected RU");
    expect(body).not.toContain("Water Pump — Пошаговая диагностика");
    expect(body).not.toContain("Прогресс");
    expect(body).not.toMatch(/Шаг\s+wp_2/);
    expect(body).not.toContain("Measure voltage");
    expect(body).not.toContain("faucet open");
    expect(body).not.toContain("Exact reading");
  });
});

// ── Direct-power detection (pure helper) ──────────────────────────────

describe("Case-88 detectWaterPumpDirectPowerIsolation", () => {
  it("returns finding for the canonical RU Case-88 phrasing", () => {
    const message =
      "водяной насос не работает. проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor";
    const finding = detectWaterPumpDirectPowerIsolation(message);
    expect(finding).not.toBeNull();
    expect(finding!).toContain("Water pump failed direct-power test");
  });

  it("returns finding for the EN equivalent", () => {
    const message =
      "Water pump not working. Confirmed 12V at terminals. Applied 12V directly to the pump — pump does not run. Pump is bad. Please write warranty report.";
    const finding = detectWaterPumpDirectPowerIsolation(message);
    expect(finding).not.toBeNull();
  });

  it("returns finding for the ES equivalent", () => {
    const message =
      "La bomba de agua no funciona. Apliqué 12V directamente a la bomba y la bomba no arranca. Hay que reemplazarla. Prepara el informe de garantía.";
    const finding = detectWaterPumpDirectPowerIsolation(message);
    expect(finding).not.toBeNull();
  });

  it("returns null when only direct-power cue is present (no pump-no-run)", () => {
    const message =
      "подключил 12 волт напрямую к насосу. напиши warranty report.";
    expect(detectWaterPumpDirectPowerIsolation(message)).toBeNull();
  });

  it("returns null when only pump-no-run cue is present (no direct-power)", () => {
    const message = "насос не работает. напиши warranty report.";
    expect(detectWaterPumpDirectPowerIsolation(message)).toBeNull();
  });

  it("returns null on unrelated diagnostic prose", () => {
    expect(
      detectWaterPumpDirectPowerIsolation(
        "проверил предохранитель, всё в порядке, продолжаю диагностику",
      ),
    ).toBeNull();
  });
});

// ── Context Engine integration ────────────────────────────────────────

describe("Case-88 Context Engine — water-pump direct-power isolation", () => {
  const caseId = "case-88-test";

  beforeEach(() => {
    clearContext(caseId);
    clearRegistry(caseId);
  });

  it("sets isolationComplete=true when direct-power evidence + pump-no-run + active water_pump", () => {
    initializeCase(caseId, "водяной насос не работает");
    const ctx = getOrCreateContext(caseId);
    ctx.activeProcedureId = "water_pump";
    ctx.primarySystem = "water_pump";
    updateContext(ctx);

    const message =
      "проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor";
    const result = processMessage(caseId, message, DEFAULT_CONFIG);

    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.isolationFinding).toContain(
      "Water pump failed direct-power test",
    );
    // P1.7 enforcement: no active step assigned in non-normal/isolated state.
    expect(result.context.activeStepId).toBeNull();
  });

  it("does NOT set isolationComplete for unrelated active procedure", () => {
    initializeCase(caseId, "водонагреватель не работает");
    const ctx = getOrCreateContext(caseId);
    ctx.activeProcedureId = "water_heater";
    ctx.primarySystem = "water_heater";
    updateContext(ctx);

    const message =
      "подключил 12 волт напрямую к насосу. насос не рабочий";
    const result = processMessage(caseId, message, DEFAULT_CONFIG);
    expect(result.context.isolationComplete).toBe(false);
  });

  it("does NOT set isolationComplete on first turn for plain water-pump complaint without direct-power evidence", () => {
    initializeCase(caseId, "водяной насос не работает");
    const ctx = getOrCreateContext(caseId);
    ctx.activeProcedureId = "water_pump";
    ctx.primarySystem = "water_pump";
    updateContext(ctx);

    const result = processMessage(
      caseId,
      "водяной насос не работает",
      DEFAULT_CONFIG,
    );
    expect(result.context.isolationComplete).toBe(false);
  });

  it("regression — once isolated, the engine does NOT re-assign wp_2 as activeStepId", () => {
    initializeCase(caseId, "водяной насос не работает");
    const ctx = getOrCreateContext(caseId);
    ctx.activeProcedureId = "water_pump";
    ctx.primarySystem = "water_pump";
    updateContext(ctx);

    const isolatingMessage =
      "проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor";
    processMessage(caseId, isolatingMessage, DEFAULT_CONFIG);

    // Subsequent technician follow-up — must not reset activeStepId to wp_2.
    const followup = processMessage(
      caseId,
      "Результат: насос не рабочий и требует замены",
      DEFAULT_CONFIG,
    );
    expect(followup.context.isolationComplete).toBe(true);
    expect(followup.context.activeStepId).toBeNull();
  });
});
