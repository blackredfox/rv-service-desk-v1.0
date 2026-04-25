/**
 * Systemic Response Governance — generalization of the
 * Case-88 / Case-89 / Case-90 / Case-91 work.
 *
 * These tests are NOT one-off equipment cases. They lock down the
 * system-wide invariants the refactor extracted into
 * `src/lib/chat/response-governance-policy.ts` and the existing
 * `src/lib/chat/report-gate-language.ts`:
 *
 *   A — Universal report-intent gate
 *       (Tier 1/2/3 named missing items, Tier 4 wall is last-resort)
 *   B — Language fidelity for server-authored technician-facing text
 *       (RU/ES never embed raw English fragments)
 *   C — Metadata / status leak ban
 *       (the diagnostic sanitizer drops registry status/banner labels
 *        regardless of the equipment domain)
 *   D — START FINAL REPORT consistency invariant
 *       (if the assistant invited it, the next response to a report
 *        request MUST NOT be the legacy "Diagnostics not complete" wall)
 *   F — Fact integrity
 *       ("requires replacement" is never converted to
 *        "repair completed / operation restored")
 *
 * Tests are deterministic and DO NOT call a real LLM.
 *
 * Out-of-scope (explicit, by user instruction): Axis E
 * (LP-leak context preservation) is left as a documented follow-up.
 */

import { describe, it, expect } from "vitest";
import {
  buildPostInvitationGateResponse,
  isStartFinalReportInvariantViolated,
  wasFinalReportInvitedRecently,
} from "@/lib/chat/response-governance-policy";
import {
  filterServerAuthoredFragments,
  looksLikeLanguage,
} from "@/lib/chat/report-gate-language";
import {
  sanitizeLine,
  wrapEmitterWithDiagnosticSanitizer,
} from "@/lib/chat/diagnostic-output-sanitizer";
import { assessTranscriptRepairStatus } from "@/lib/chat/repair-summary-intent";

// ── Axis D — START FINAL REPORT consistency invariant ───────────────

describe("Systemic — START FINAL REPORT invariant", () => {
  it("detects a recent assistant invitation containing the literal phrase", () => {
    expect(
      wasFinalReportInvitedRecently([
        { role: "user", content: "проверил всё" },
        {
          role: "assistant",
          content:
            "Готовы сформировать финальный отчёт? Отправьте START FINAL REPORT, когда будете готовы.",
        },
      ]),
    ).toBe(true);
  });

  it("detects a recent assistant invitation in EN / ES", () => {
    expect(
      wasFinalReportInvitedRecently([
        {
          role: "assistant",
          content: "Send START FINAL REPORT and I will generate the report.",
        },
      ]),
    ).toBe(true);
    expect(
      wasFinalReportInvitedRecently([
        {
          role: "assistant",
          content: "Si quieres el informe ahora, envía START FINAL REPORT.",
        },
      ]),
    ).toBe(true);
  });

  it("returns false when the latest assistant turn does NOT invite it", () => {
    expect(
      wasFinalReportInvitedRecently([
        { role: "assistant", content: "Continue with the next diagnostic step." },
      ]),
    ).toBe(false);
  });

  it("only considers the most-recent assistant turn (not earlier ones)", () => {
    // Earlier invitation, but the latest assistant turn does NOT invite.
    expect(
      wasFinalReportInvitedRecently([
        { role: "assistant", content: "Send START FINAL REPORT when ready." },
        { role: "user", content: "wait, one more check" },
        { role: "assistant", content: "OK, what was the voltage reading?" },
      ]),
    ).toBe(false);
  });

  it("isStartFinalReportInvariantViolated is true ONLY when invited AND not ready", () => {
    const inviting = [
      { role: "assistant", content: "Send START FINAL REPORT." },
    ];
    const notInviting = [
      { role: "assistant", content: "Continue with the next step." },
    ];
    expect(isStartFinalReportInvariantViolated(inviting, /*ready*/ false)).toBe(true);
    expect(isStartFinalReportInvariantViolated(inviting, /*ready*/ true)).toBe(false);
    expect(isStartFinalReportInvariantViolated(notInviting, /*ready*/ false)).toBe(false);
  });

  it("buildPostInvitationGateResponse never returns the legacy wall (RU)", () => {
    const out = buildPostInvitationGateResponse("RU");
    expect(out).not.toMatch(/Диагностика ещё не завершена/);
    expect(out).not.toMatch(/продолжим с текущего шага/);
    expect(out).toMatch(/START FINAL REPORT/);
    expect(out).toMatch(/последнему диагностическому|последнего диагностического|последнем диагностическом|последний/i);
  });

  it("buildPostInvitationGateResponse never returns the legacy wall (EN)", () => {
    const out = buildPostInvitationGateResponse("EN");
    expect(out).not.toMatch(/Diagnostics are not yet complete/);
    expect(out).not.toMatch(/Let's continue with the current step/);
    expect(out).toMatch(/START FINAL REPORT/);
  });

  it("buildPostInvitationGateResponse never returns the legacy wall (ES)", () => {
    const out = buildPostInvitationGateResponse("ES");
    expect(out).not.toMatch(/El diagnóstico aún no está completo/);
    expect(out).toMatch(/START FINAL REPORT/);
  });
});

// ── Axis B — Language fidelity for server-authored fragments ────────

describe("Systemic — language fidelity for server-authored text", () => {
  it("filterServerAuthoredFragments drops English fragments in RU output", () => {
    const out = filterServerAuthoredFragments(
      [
        "Voltage reading at the pump terminals",
        "Показание напряжения на клеммах насоса",
        "Pressure measurement",
        "Замер давления на регуляторе",
      ],
      "RU",
    );
    expect(out).toContain("Показание напряжения на клеммах насоса");
    expect(out).toContain("Замер давления на регуляторе");
    expect(out).not.toContain("Voltage reading at the pump terminals");
    expect(out).not.toContain("Pressure measurement");
  });

  it("filterServerAuthoredFragments drops Cyrillic fragments in ES output", () => {
    const out = filterServerAuthoredFragments(
      [
        "Lectura del voltaje en los terminales de la bomba",
        "Показание напряжения",
        "Verificación del regulador",
      ],
      "ES",
    );
    expect(out).toContain("Lectura del voltaje en los terminales de la bomba");
    expect(out).toContain("Verificación del regulador");
    expect(out).not.toContain("Показание напряжения");
  });

  it("filterServerAuthoredFragments keeps everything in EN output", () => {
    const out = filterServerAuthoredFragments(
      [
        "Voltage reading at terminals",
        "Pressure measurement",
        "Continuity check",
      ],
      "EN",
    );
    expect(out).toHaveLength(3);
  });

  it("looksLikeLanguage is conservative — bare English ('Measure voltage') is rejected for RU", () => {
    expect(looksLikeLanguage("Measure voltage at the pump terminals", "RU")).toBe(false);
    expect(looksLikeLanguage("Измерьте напряжение на клеммах насоса", "RU")).toBe(true);
  });
});

// ── Axis C — Metadata / status leak ban (system-wide) ────────────────

describe("Systemic — metadata / status leak ban", () => {
  it("drops registry banner across equipment domains, not just water pump", () => {
    expect(sanitizeLine("Water Pump — Пошаговая диагностика")).toBeNull();
    expect(sanitizeLine("Water Heater — Пошаговая диагностика")).toBeNull();
    expect(sanitizeLine("Furnace — Пошаговая диагностика")).toBeNull();
    expect(sanitizeLine("LP Gas — Пошаговая диагностика")).toBeNull();
    expect(sanitizeLine("Inverter — Step-by-step diagnostics")).toBeNull();
    expect(sanitizeLine("Bomba de agua — Diagnóstico paso a paso")).toBeNull();
  });

  it("drops Russian status / state / progress labels regardless of equipment", () => {
    expect(sanitizeLine("Система: водонагреватель")).toBeNull();
    expect(sanitizeLine("Классификация: bla")).toBeNull();
    expect(sanitizeLine("Режим: диагностика")).toBeNull();
    expect(sanitizeLine("Статус: open")).toBeNull();
    expect(sanitizeLine("Состояние: bla")).toBeNull();
    expect(sanitizeLine("Прогресс: 2/5 шагов завершено")).toBeNull();
    expect(sanitizeLine("Первый шаг: проверка пред.")).toBeNull();
  });

  it("drops English equivalent labels regardless of equipment", () => {
    expect(sanitizeLine("System: water_heater")).toBeNull();
    expect(sanitizeLine("Classification: gas valve")).toBeNull();
    expect(sanitizeLine("Mode: diagnostic")).toBeNull();
    expect(sanitizeLine("Status: open")).toBeNull();
    expect(sanitizeLine("State: ok")).toBeNull();
    expect(sanitizeLine("Progress: 1/5 steps complete")).toBeNull();
  });

  it("drops Spanish equivalent labels regardless of equipment", () => {
    expect(sanitizeLine("Sistema: bomba")).toBeNull();
    expect(sanitizeLine("Clasificación: gas")).toBeNull();
    expect(sanitizeLine("Modo: diagnóstico")).toBeNull();
    expect(sanitizeLine("Estado: abierto")).toBeNull();
    expect(sanitizeLine("Progreso: 1/5 pasos completados")).toBeNull();
  });

  it("drops English step text leaking into RU/ES across step IDs and equipment", () => {
    // Water heater
    expect(
      sanitizeLine(
        "Шаг wh_3: Verify gas valve solenoid voltage during ignition cycle.",
        { replyLanguage: "RU" },
      ),
    ).toBeNull();
    // Furnace
    expect(
      sanitizeLine(
        "Paso furn_2: Inspect the burner orifice for obstruction.",
        { replyLanguage: "ES" },
      ),
    ).toBeNull();
    // Generic English step in EN reply is allowed (not a leak)
    expect(
      sanitizeLine(
        "Step furn_2: Inspect the burner orifice for obstruction.",
        { replyLanguage: "EN" },
      ),
    ).toContain("Inspect the burner orifice");
  });

  it("streaming sanitizer drops mixed metadata + step-text block in one pass (system-wide)", () => {
    const collected: string[] = [];
    const emitter = wrapEmitterWithDiagnosticSanitizer(
      (t) => collected.push(t),
      { replyLanguage: "RU" },
    );
    emitter.emit(
      [
        "Detected RU · Reply RU",
        "Water Heater — Пошаговая диагностика",
        "Прогресс: 2/5 шагов завершено",
        "",
        "Шаг wh_3: Verify gas valve solenoid voltage during ignition cycle.",
        "Хорошие новости: предохранитель цел.",
        "",
      ].join("\n"),
    );
    emitter.flush();
    const body = collected.join("");
    expect(body).not.toContain("Detected RU");
    expect(body).not.toContain("Water Heater — Пошаговая диагностика");
    expect(body).not.toMatch(/Прогресс/);
    expect(body).not.toMatch(/Шаг\s+wh_3/);
    expect(body).not.toContain("Verify gas valve solenoid");
    // Legitimate Russian assistant prose survives.
    expect(body).toContain("предохранитель цел");
  });
});

// ── Axis F — Fact integrity (system-wide, not water-pump-only) ──────

describe("Systemic — fact integrity (recommended ≠ completed)", () => {
  it("recommended replacement across equipment is never read as completed", () => {
    // Water heater scenario.
    expect(
      assessTranscriptRepairStatus([
        "Газовый клапан водонагревателя неисправен. Требует замены. Напиши warranty report.",
      ]),
    ).toEqual({ repairPerformed: false, restorationConfirmed: false });

    // Inverter scenario.
    expect(
      assessTranscriptRepairStatus([
        "The inverter is failed and needs to be replaced. Write the warranty report.",
      ]),
    ).toEqual({ repairPerformed: false, restorationConfirmed: false });

    // LP regulator scenario.
    expect(
      assessTranscriptRepairStatus([
        "El regulador de LP está dañado, hay que reemplazarlo. Prepara el informe.",
      ]),
    ).toEqual({ repairPerformed: false, restorationConfirmed: false });
  });

  it("completed repair across equipment is correctly recognized", () => {
    // Water heater scenario.
    expect(
      assessTranscriptRepairStatus([
        "Поменял газовый клапан. Водонагреватель теперь работает нормально.",
      ]),
    ).toEqual({ repairPerformed: true, restorationConfirmed: true });

    // Inverter scenario.
    expect(
      assessTranscriptRepairStatus([
        "Replaced the inverter. The system now works correctly after replacement.",
      ]),
    ).toEqual({ repairPerformed: true, restorationConfirmed: true });
  });
});

// ── Axis A — Universal report-intent gate (deterministic surface) ───

describe("Systemic — universal report intent gate", () => {
  it("fact-integrity helper is active across equipment, not water-pump-only", () => {
    // Same systemic check as Axis F, but framed from the report-intent
    // angle: this is the helper consumed by `buildTranscriptDerivedDraftConstraint`
    // at BOTH route call sites (early readiness + post-context-engine).
    // The route applies it to ANY equipment that reaches `final_report`
    // mode via the bounded report-intent path.
    const dimmer = assessTranscriptRepairStatus([
      "Dimmer не реагирует. Подал 12 в напрямую — нет реакции. Требует замены. Сделай отчёт.",
    ]);
    expect(dimmer).toEqual({ repairPerformed: false, restorationConfirmed: false });

    const waterHeaterValve = assessTranscriptRepairStatus([
      "Gas pressure good. Solenoid bad — needs replacement. Write warranty report.",
    ]);
    expect(waterHeaterValve).toEqual({
      repairPerformed: false,
      restorationConfirmed: false,
    });
  });

  it("post-invitation gate text contains the same language-fidelity guarantee as Tier 1", () => {
    // Smoke-check: the post-invitation response in RU contains NO
    // dominant Latin-script run. (Apart from the protocol literal
    // "START FINAL REPORT" which is intentionally preserved as the
    // technician must type it back.)
    const ru = buildPostInvitationGateResponse("RU").replace(/START\s+FINAL\s+REPORT/g, "");
    expect(looksLikeLanguage(ru, "RU")).toBe(true);

    const es = buildPostInvitationGateResponse("ES").replace(/START\s+FINAL\s+REPORT/g, "");
    expect(looksLikeLanguage(es, "ES")).toBe(true);
  });
});

// ── Documented follow-up (Axis E — context preservation) ────────────

describe.skip("Systemic — Axis E (LP-leak context preservation) — DEFERRED", () => {
  it("[deferred] LP tank leak complaint must not route into appliance ignition steps", () => {
    // Out of scope for this PR per user instruction. The narrow fix
    // requires a procedure-level branching change in
    // `src/lib/diagnostic-procedures.ts` (split LP Gas procedure into
    // a leak/safety/containment branch and an appliance-ignition
    // branch, with intent matching driven by complaint shape).
    //
    // Tracked as next-up generalization work after this PR ships.
  });
});
