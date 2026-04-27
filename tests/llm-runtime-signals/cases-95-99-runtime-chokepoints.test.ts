/**
 * Cases 95–99 manual-acceptance generalization — runtime chokepoint
 * fixes (NOT helper-only).
 *
 * The previous PR added centralized `response-governance-policy`
 * helpers, but the actual user-visible runtime still leaked through
 * three concrete chokepoints:
 *
 *   1. `buildAuthoritativeStepFallback` (the safe-fallback emitted
 *      when the LLM primary response fails strict diagnostic-mode
 *      validation) was the source of the `<Procedure> — Пошаговая
 *      диагностика / Прогресс / Шаг wh_2:` banner block. It is now
 *      neutralized at source — it emits ONLY the localized step
 *      question with a neutral intro line, no metadata.
 *
 *   2. The diagnostic-output sanitizer's RU "Первый шаг:" pattern
 *      did not match `Первый действительный шаг:` (Case-97). The
 *      pattern is now flexible: `Первый\s+(?:[\wа-яё]+\s+){0,2}шаг`
 *      so it also matches localized variants like
 *      `Первый необходимый шаг`. Same flex applied to EN/ES.
 *
 *   3. `buildSpecificReportGateResponse` Tier 4 generic wall
 *      ("Diagnostics not complete") fires too eagerly. Tier 3.5 now
 *      emits a procedure-aware acknowledgement when an active
 *      procedure exists but the registry can't point at a specific
 *      step (e.g. all-steps-complete + isolation-not-yet-flipped).
 *
 * These tests are deterministic and DO NOT call a real LLM. They lock
 * the actual functions invoked by the runtime route AT THE EMIT
 * SOURCE, so the technician-facing output cannot regress.
 */

import { describe, it, expect } from "vitest";
import {
  buildAuthoritativeStepFallback,
} from "@/lib/chat/output-policy";
import {
  sanitizeLine,
  wrapEmitterWithDiagnosticSanitizer,
} from "@/lib/chat/diagnostic-output-sanitizer";

// ── Chokepoint 1 — `buildAuthoritativeStepFallback` ──────────────────

describe("Cases 95–99 — buildAuthoritativeStepFallback no longer leaks metadata", () => {
  const stepMetadata = {
    id: "wh_2",
    question:
      "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
    procedureName: "Водонагреватель (газовый/комбинированный)",
    progress: { completed: 1, total: 24 },
  };

  it("RU fallback contains the question but NO procedure-banner / progress / step-id", () => {
    const out = buildAuthoritativeStepFallback(stepMetadata, "wh_2", "RU");
    expect(out).toContain("Какой уровень в LP-баке");
    expect(out).not.toMatch(/—\s*Пошаговая\s+диагностика/);
    expect(out).not.toMatch(/Прогресс\s*:/);
    expect(out).not.toMatch(/Шаг\s+wh_2/);
    expect(out).not.toMatch(/^Шаг\b/);
  });

  it("EN fallback contains the question but NO Step <id>: prefix or banner", () => {
    const meta = {
      id: "wp_2",
      question: "What voltage do you measure at the water pump input?",
      procedureName: "Water Pump",
      progress: { completed: 1, total: 5 },
    };
    const out = buildAuthoritativeStepFallback(meta, "wp_2", "EN");
    expect(out).toContain("What voltage do you measure at the water pump input?");
    expect(out).not.toMatch(/Step\s+wp_2/);
    expect(out).not.toMatch(/—\s*Guided Diagnostics/);
    expect(out).not.toMatch(/Progress\s*:/);
  });

  it("ES fallback contains the question but NO Paso <id>: prefix or banner", () => {
    const meta = {
      id: "wp_2",
      question: "¿Qué voltaje mides en la entrada de la bomba de agua?",
      procedureName: "Bomba de agua",
      progress: { completed: 1, total: 5 },
    };
    const out = buildAuthoritativeStepFallback(meta, "wp_2", "ES");
    expect(out).toContain("¿Qué voltaje mides en la entrada de la bomba de agua?");
    expect(out).not.toMatch(/Paso\s+wp_2/);
    expect(out).not.toMatch(/—\s*Diagn[óo]stico\s+guiado/i);
    expect(out).not.toMatch(/Progreso\s*:/);
  });

  it("when stepMetadata is null, the fallback is a neutral localized prompt without any step id", () => {
    expect(buildAuthoritativeStepFallback(null, "wh_2", "RU")).not.toMatch(/wh_2/);
    expect(buildAuthoritativeStepFallback(null, "wh_2", "RU")).not.toMatch(/Шаг/);
    expect(buildAuthoritativeStepFallback(null, "wh_2", "EN")).not.toMatch(/wh_2/);
    expect(buildAuthoritativeStepFallback(null, "wh_2", "EN")).not.toMatch(/Step\s+\S/);
  });
});

// ── Chokepoint 2 — sanitizer pattern flexibility ─────────────────────

describe("Cases 95–99 — sanitizer drops 'Первый действительный шаг:' (and EN/ES variants)", () => {
  it("drops `Первый действительный шаг:` (Case-97 leakage)", () => {
    expect(sanitizeLine("Первый действительный шаг:")).toBeNull();
    expect(sanitizeLine("Первый действительный шаг: проверка предохранителя")).toBeNull();
    expect(sanitizeLine("Первый необходимый шаг: проверьте подачу")).toBeNull();
  });

  it("still drops the original `Первый шаг:` (no regression)", () => {
    expect(sanitizeLine("Первый шаг: проверьте предохранитель")).toBeNull();
  });

  it("drops EN/ES equivalents `First actionable step:` / `Primer paso necesario:`", () => {
    expect(sanitizeLine("First actionable step: check the fuse")).toBeNull();
    expect(sanitizeLine("First required step: verify the fuse")).toBeNull();
    expect(sanitizeLine("Primer paso necesario: verifica el fusible")).toBeNull();
    expect(sanitizeLine("Primero paso adecuado: revisa el voltaje")).toBeNull();
  });

  it("streaming sanitizer drops the full Case-97 leakage block in one pass", () => {
    const collected: string[] = [];
    const emitter = wrapEmitterWithDiagnosticSanitizer(
      (t) => collected.push(t),
      { replyLanguage: "RU" },
    );
    emitter.emit(
      [
        "Detected RU · Reply RU",
        "Система: Водонагреватель (газовый/комбинированный)",
        "Классификация: LP-газовая система (комплексная)",
        "Режим: Пошаговая диагностика",
        "Статус: Локализация неисправности не завершена",
        "Первый действительный шаг:",
        "",
        "Принято.",
        "",
        "Шаг wh_2: Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
      ].join("\n"),
    );
    emitter.flush();
    const body = collected.join("");
    // Banners / labels gone
    expect(body).not.toContain("Detected RU");
    expect(body).not.toContain("Система:");
    expect(body).not.toContain("Классификация:");
    expect(body).not.toContain("Режим:");
    expect(body).not.toContain("Статус:");
    expect(body).not.toContain("Первый действительный шаг:");
    expect(body).not.toMatch(/Шаг\s+wh_2/);
    // Legitimate prose + question survive
    expect(body).toContain("Принято.");
    expect(body).toContain("Какой уровень в LP-баке");
  });
});

// ── Chokepoint 3 — buildSpecificReportGateResponse Tier 3.5 ──────────

describe("Cases 95–99 — report-gate Tier 3.5 (active procedure, no specific step)", () => {
  it("emits a procedure-aware acknowledgement instead of the generic wall (RU)", async () => {
    const route = await import("@/app/api/chat/route");
    // Force Tier 4 path (no sidecar, no readyForReportRouting, no
    // active step prompt) BUT with an active procedure label.
    // Use a deliberately fresh helper invocation through __test__
    // shape — the fn is called with `activeProcedureLabel: "lp_gas"`.
    //
    // We exercise the function via the buildSpecificReportGateResponse
    // re-export below. The key assertion: NOT the legacy wall.
    const resp = route.__test__.buildSpecificReportGateResponse({
      language: "RU",
      sidecarSignals: null,
      repairSummary: { readyForReportRouting: false } as never,
      activeProcedureLabel: "lp_gas",
      activeStepPrompt: null,
      history: null,
    });
    expect(resp).not.toMatch(/Диагностика ещё не завершена/);
    expect(resp).not.toMatch(/продолжим с текущего шага/);
    expect(resp).toMatch(/изоляции неисправности|итоговым результатом/i);
  });

  it("emits a procedure-aware acknowledgement instead of the generic wall (EN)", async () => {
    const route = await import("@/app/api/chat/route");
    const resp = route.__test__.buildSpecificReportGateResponse({
      language: "EN",
      sidecarSignals: null,
      repairSummary: { readyForReportRouting: false } as never,
      activeProcedureLabel: "water_heater",
      activeStepPrompt: null,
      history: null,
    });
    expect(resp).not.toMatch(/Diagnostics are not yet complete/);
    expect(resp).toMatch(/final isolation confirmation|share the final/i);
  });

  it("emits a procedure-aware acknowledgement instead of the generic wall (ES)", async () => {
    const route = await import("@/app/api/chat/route");
    const resp = route.__test__.buildSpecificReportGateResponse({
      language: "ES",
      sidecarSignals: null,
      repairSummary: { readyForReportRouting: false } as never,
      activeProcedureLabel: "lp_gas",
      activeStepPrompt: null,
      history: null,
    });
    expect(resp).not.toMatch(/El diagnóstico aún no está completo/);
    expect(resp).toMatch(/aislamiento|resultado final/i);
  });

  it("Tier 4 absolute generic wall fires ONLY when no active procedure AND no recent invitation", async () => {
    const route = await import("@/app/api/chat/route");
    const resp = route.__test__.buildSpecificReportGateResponse({
      language: "RU",
      sidecarSignals: null,
      repairSummary: { readyForReportRouting: false } as never,
      activeProcedureLabel: null,
      activeStepPrompt: null,
      history: null,
    });
    expect(resp).toMatch(/Диагностика ещё не завершена/);
  });

  it("post-invitation invariant beats Tier 4 even when no active procedure", async () => {
    const route = await import("@/app/api/chat/route");
    const resp = route.__test__.buildSpecificReportGateResponse({
      language: "RU",
      sidecarSignals: null,
      repairSummary: { readyForReportRouting: false } as never,
      activeProcedureLabel: null,
      activeStepPrompt: null,
      history: [
        {
          role: "assistant",
          content:
            "Готовы сформировать финальный отчёт? Отправьте START FINAL REPORT, когда будете готовы.",
        },
      ],
    });
    expect(resp).not.toMatch(/Диагностика ещё не завершена/);
    expect(resp).toMatch(/START FINAL REPORT/);
  });
});
