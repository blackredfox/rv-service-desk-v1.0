/**
 * Diagnostic output sanitizer — unit tests.
 *
 * Verifies the streaming, line-buffered sanitizer drops internal status
 * banners (Copy / Reply RU / "Прогресс: X/Y" / "Шаг wh_3:" / etc.) and
 * preserves natural prose. These banners are observed in production
 * transcripts (Case-78/79/80/81) leaking from the system prompt context.
 *
 * The wrapper MUST:
 *   - drop full banner lines silently;
 *   - strip leading "Шаг <id>:" / "Step <id>:" / "Paso <id>:" prefixes;
 *   - never throw, never block;
 *   - never alter natural prose;
 *   - flush trailing partial line at end-of-stream.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeLine,
  wrapEmitterWithDiagnosticSanitizer,
  isDiagnosticOutputSanitizerEnabled,
  DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV,
} from "@/lib/chat/diagnostic-output-sanitizer";

describe("diagnostic-output-sanitizer — sanitizeLine", () => {
  it("drops 'Copy' alone", () => {
    expect(sanitizeLine("Copy")).toBeNull();
    expect(sanitizeLine("  Copy  ")).toBeNull();
  });

  it("drops 'Reply RU' / 'Reply EN' / 'Reply ES'", () => {
    expect(sanitizeLine("Reply RU")).toBeNull();
    expect(sanitizeLine("Reply EN")).toBeNull();
    expect(sanitizeLine("Reply ES")).toBeNull();
  });

  it("drops 'Detected RU · Reply RU' compound banner", () => {
    expect(sanitizeLine("Detected RU · Reply RU")).toBeNull();
    expect(sanitizeLine("Detected EN")).toBeNull();
  });

  it("drops Russian status-screen banner lines (Case-81)", () => {
    expect(
      sanitizeLine("Система: Водонагреватель Suburban (газовый/комбинированный)"),
    ).toBeNull();
    expect(
      sanitizeLine("Классификация: Водонагреватель (газовый/комбинированный)"),
    ).toBeNull();
    expect(sanitizeLine("Режим: Руководимая диагностика")).toBeNull();
    expect(sanitizeLine("Статус: Изоляция не завершена")).toBeNull();
    expect(sanitizeLine("Прогресс: 1/24 шагов завершено")).toBeNull();
    expect(sanitizeLine("Первый шаг: wh_2")).toBeNull();
    expect(sanitizeLine("ВСЕ ШАГИ ЗАВЕРШЕНЫ.")).toBeNull();
  });

  it("drops English equivalents of system-prompt labels", () => {
    expect(sanitizeLine("ACTIVE DIAGNOSTIC PROCEDURE: Water Heater")).toBeNull();
    expect(sanitizeLine("CURRENT STEP: wh_3")).toBeNull();
    expect(sanitizeLine('Ask EXACTLY: "is the gas valve open?"')).toBeNull();
    expect(sanitizeLine("Progress: 3/24 steps completed")).toBeNull();
    expect(sanitizeLine("ALL STEPS COMPLETE")).toBeNull();
  });

  it("strips leading 'Шаг wh_3:' prefix and keeps the question text", () => {
    expect(sanitizeLine("Шаг wh_3: Работают ли другие LP-приборы?")).toBe(
      "Работают ли другие LP-приборы?",
    );
    expect(sanitizeLine("Step wh_3: Are other LP appliances working?")).toBe(
      "Are other LP appliances working?",
    );
    expect(sanitizeLine("Paso wh_3: ¿Funcionan otros aparatos LP?")).toBe(
      "¿Funcionan otros aparatos LP?",
    );
  });

  it("strips leading numeric step prefix 'Шаг 1:' / 'Step 5:'", () => {
    expect(sanitizeLine("Шаг 1: Подтвердите тип духовки.")).toBe(
      "Подтвердите тип духовки.",
    );
    expect(sanitizeLine("Step 5: Check the gas valve voltage.")).toBe(
      "Check the gas valve voltage.",
    );
  });

  it("preserves natural prose unchanged", () => {
    const samples = [
      "Хорошо, давайте проверим напряжение на свече накала.",
      "I see. Let's verify the gas line pressure.",
      "El siguiente paso es probar la válvula.",
      "Принято.",
      "OK — that helps.",
      "Не работает водонагреватель Suburban — поняла.",
    ];
    for (const s of samples) {
      expect(sanitizeLine(s)).toBe(s);
    }
  });

  it("drops 'RU — RU' / 'EN — EN' compact banners but does not drop dashes within prose", () => {
    expect(sanitizeLine("RU — RU")).toBeNull();
    expect(sanitizeLine("EN - EN")).toBeNull();
    expect(sanitizeLine("Это — диагностика.")).toBe("Это — диагностика.");
  });
});

describe("diagnostic-output-sanitizer — streaming wrapper", () => {
  function collect(): { emit: (s: string) => void; out: () => string } {
    let buf = "";
    return {
      emit: (s: string) => {
        buf += s;
      },
      out: () => buf,
    };
  }

  it("strips the full Case-81 banner block before forwarding the question", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);

    // Emulate the LLM streaming the literal Case-81 leakage.
    w.emit("Copy\nReply RU\n");
    w.emit("Система: Водонагреватель Suburban (газовый/комбинированный)\n");
    w.emit("Классификация: Водонагреватель (газовый/комбинированный)\n");
    w.emit("Режим: Руководимая диагностика\n");
    w.emit("Статус: Изоляция не завершена\n");
    w.emit("Прогресс: 1/24 шагов завершено\n");
    w.emit("Первый шаг: wh_2\n");
    w.emit("\nПринято.\n\n");
    w.emit("Шаг wh_3: Работают ли другие LP-приборы?");
    w.flush();

    const out = sink.out();
    // No banner content remains.
    expect(out).not.toMatch(/Copy/);
    expect(out).not.toMatch(/Reply RU/);
    expect(out).not.toMatch(/Прогресс:/);
    expect(out).not.toMatch(/Первый шаг:/);
    expect(out).not.toMatch(/Статус:/);
    expect(out).not.toMatch(/Система:/);
    expect(out).not.toMatch(/Шаг wh_3:/);
    // Natural content survives.
    expect(out).toMatch(/Принято\./);
    expect(out).toMatch(/Работают ли другие LP-приборы\?/);
  });

  it("handles tokens split mid-banner-line without leaking the banner", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    // Tokens may arrive partial. The wrapper buffers until newline.
    w.emit("Co");
    w.emit("py\nRe");
    w.emit("ply RU\nПрив");
    w.emit("ет!");
    w.flush();
    const out = sink.out();
    expect(out).not.toMatch(/Copy/);
    expect(out).not.toMatch(/Reply RU/);
    expect(out).toMatch(/Привет!/);
  });

  it("strips leading step prefix from a streamed line", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    w.emit("Шаг wh_3: ");
    w.emit("Работают ли другие LP-");
    w.emit("приборы?\n");
    w.flush();
    expect(sink.out()).toBe("Работают ли другие LP-приборы?\n");
  });

  it("emits natural prose unchanged when no banners are present", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    w.emit("Хорошо. Давайте проверим напряжение.\n");
    w.emit("Затем посмотрим, держится ли пламя.");
    w.flush();
    expect(sink.out()).toBe(
      "Хорошо. Давайте проверим напряжение.\nЗатем посмотрим, держится ли пламя.",
    );
  });

  it("flush forwards a final line that arrived without trailing newline", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    w.emit("Принято.");
    // Without flush, the wrapper must NOT have forwarded yet (banner check
    // requires newline). Verify that emit alone did not leak.
    expect(sink.out()).toBe("");
    w.flush();
    expect(sink.out()).toBe("Принято.");
  });

  it("flush still drops a trailing banner-only buffer", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    w.emit("Reply RU");
    w.flush();
    expect(sink.out()).toBe("");
  });

  it("collapses adjacent blank lines created by line drops", () => {
    const sink = collect();
    const w = wrapEmitterWithDiagnosticSanitizer(sink.emit);
    w.emit("Copy\nReply RU\n\nПринято.\n\nXXX\n");
    w.flush();
    const out = sink.out();
    // No leading blank lines.
    expect(out.startsWith("\n")).toBe(false);
    expect(out).toMatch(/Принято\./);
    expect(out).toMatch(/XXX/);
  });
});

describe("diagnostic-output-sanitizer — feature flag", () => {
  it("is enabled by default", () => {
    const prev = process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV];
    delete process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV];
    try {
      expect(isDiagnosticOutputSanitizerEnabled()).toBe(true);
    } finally {
      if (prev !== undefined) process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV] = prev;
    }
  });

  it("is disabled by explicit opt-out env value '1' / 'true'", () => {
    const prev = process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV];
    try {
      process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV] = "1";
      expect(isDiagnosticOutputSanitizerEnabled()).toBe(false);
      process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV] = "true";
      expect(isDiagnosticOutputSanitizerEnabled()).toBe(false);
      process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV] = "no";
      expect(isDiagnosticOutputSanitizerEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV];
      else process.env[DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV] = prev;
    }
  });
});
