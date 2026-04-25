/**
 * Case-86 manual-acceptance revision (Blockers 1, 2, 3).
 *
 * Three narrow product axes verified here:
 *
 *   1. Sanitizer coverage — Case-86-style banner / status-screen
 *      metadata must be stripped from the SSE body, including the
 *      `Состояние:` Russian label, broadened `Detected RU · Reply RU`
 *      separators, and inline `Шаг wh_*: …` fragments embedded mid-
 *      sentence.
 *
 *   2. Language fidelity — RU / ES report-gate responses must NOT
 *      contain raw English active-step prompts when the underlying
 *      diagnostic procedure has only EN registry text (e.g. water
 *      pump). Falls back to a localized safe explanation.
 *
 *   3. Explicit report-request acknowledgment — the localized step-hint
 *      strings include the precise next confirmation instead of the
 *      generic wall (and never echo foreign-language step text).
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeLine,
  wrapEmitterWithDiagnosticSanitizer,
} from "@/lib/chat/diagnostic-output-sanitizer";
import {
  buildStepHintLine,
  looksLikeLanguage,
} from "@/lib/chat/report-gate-language";

describe("Case-86 sanitizer coverage (Blocker 1)", () => {
  it("drops Russian `Состояние:` status banner", () => {
    expect(sanitizeLine("Состояние: Изоляция не завершена")).toBeNull();
    expect(sanitizeLine("  Состояние: 12V branch open  ")).toBeNull();
  });

  it("drops English `State:` status banner", () => {
    expect(sanitizeLine("State: Isolation not complete")).toBeNull();
  });

  it("drops Detected/Reply banner with broadened separators", () => {
    expect(sanitizeLine("Detected RU · Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU • Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU - Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU — Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU – Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU | Reply RU")).toBeNull();
    expect(sanitizeLine("Detected RU / Reply RU")).toBeNull();
  });

  it("strips inline `Шаг wh_*: …` fragments mid-line (Case-86 leakage)", () => {
    const out = sanitizeLine(
      "Принято. Шаг wh_3: Работают ли другие LP-приборы?",
    );
    expect(out).not.toContain("Шаг wh_3");
    expect(out).toContain("Работают ли другие LP-приборы");
    expect(out).toContain("Принято");
  });

  it("strips inline `Step <id>:` fragments mid-line", () => {
    const out = sanitizeLine(
      "Got it. Step wp_2: Measure voltage at the pump motor terminals.",
    );
    expect(out).not.toMatch(/Step\s+wp_2:/i);
    expect(out).toContain("Measure voltage");
    expect(out).toContain("Got it");
  });

  it("strips inline `Paso <id>:` fragments mid-line", () => {
    const out = sanitizeLine(
      "Recibido. Paso wp_1: Mide el voltaje del motor de la bomba.",
    );
    expect(out).not.toMatch(/Paso\s+wp_1:/i);
    expect(out).toContain("Mide el voltaje");
    expect(out).toContain("Recibido");
  });

  it("preserves natural diagnostic prose (no over-sanitization)", () => {
    const out = sanitizeLine(
      "Понял — отчёт нужен. Прежде чем я его подготовлю, остался один шаг.",
    );
    expect(out).toBe(
      "Понял — отчёт нужен. Прежде чем я его подготовлю, остался один шаг.",
    );
  });

  it("streaming sanitizer wraps direct/server-authored output identically", () => {
    const collected: string[] = [];
    const emitter = wrapEmitterWithDiagnosticSanitizer((t) => collected.push(t));
    const banner = [
      "Detected RU · Reply RU",
      "Состояние: Изоляция не завершена",
      "Принято.",
      "Шаг wh_3: Работают ли другие LP-приборы?",
      "",
    ].join("\n");
    emitter.emit(banner);
    emitter.flush();
    const body = collected.join("");
    expect(body).not.toContain("Detected RU");
    expect(body).not.toContain("Состояние:");
    expect(body).not.toMatch(/Шаг\s+wh_/);
    expect(body).toContain("Работают ли другие LP-приборы");
    expect(body).toContain("Принято");
  });
});

describe("Case-86 language fidelity for report-gate (Blocker 2)", () => {
  it("looksLikeLanguage rejects English text in RU context", () => {
    expect(
      looksLikeLanguage(
        "Does the pump attempt to run when a faucet is opened? Any noise, humming, or vibration?",
        "RU",
      ),
    ).toBe(false);
    expect(
      looksLikeLanguage(
        "Measure voltage at the pump motor terminals with faucet open. Is 12V DC present?",
        "RU",
      ),
    ).toBe(false);
  });

  it("looksLikeLanguage accepts RU text in RU context", () => {
    expect(
      looksLikeLanguage(
        "Есть ли 12 В DC на плате управления? Измерьте напряжение.",
        "RU",
      ),
    ).toBe(true);
  });

  it("looksLikeLanguage rejects English text in ES context", () => {
    expect(
      looksLikeLanguage(
        "Does the pump attempt to run when a faucet is opened?",
        "ES",
      ),
    ).toBe(false);
  });

  it("looksLikeLanguage accepts Spanish text in ES context", () => {
    expect(
      looksLikeLanguage("¿Hay 12 V DC en la placa de control? Mida el voltaje.", "ES"),
    ).toBe(true);
  });

  it("buildStepHintLine RU does NOT echo raw English active-step text", () => {
    const englishWaterPumpStep =
      "Does the pump attempt to run when a faucet is opened? Any noise, humming, or vibration?";
    const hint = buildStepHintLine("RU", englishWaterPumpStep);
    // The raw English question must NOT appear inside RU prose.
    expect(hint).not.toContain("Does the pump attempt");
    expect(hint).not.toContain("faucet is opened");
    // A localized safe explanation must be present instead.
    expect(hint).toContain("остался один шаг");
    expect(hint).toContain("Уточните результат");
  });

  it("buildStepHintLine ES does NOT echo raw English active-step text", () => {
    const englishWaterPumpStep =
      "Measure voltage at the pump motor terminals with faucet open.";
    const hint = buildStepHintLine("ES", englishWaterPumpStep);
    expect(hint).not.toContain("Measure voltage at the pump motor terminals");
    expect(hint).toContain("queda un paso");
    expect(hint).toContain("Confírmame el resultado");
  });

  it("buildStepHintLine RU echoes the actual prompt when it is already in RU", () => {
    const russianStep =
      "Есть ли 12 В DC на плате управления водонагревателя? Измерьте напряжение.";
    const hint = buildStepHintLine("RU", russianStep);
    expect(hint).toContain("остался один шаг");
    expect(hint).toContain("12 В DC");
    expect(hint).toContain("Измерьте напряжение");
  });

  it("buildStepHintLine ES echoes the actual prompt when it is already in ES", () => {
    const spanishStep =
      "¿Hay 12 V DC en la placa de control del calentador de agua? Mida el voltaje.";
    const hint = buildStepHintLine("ES", spanishStep);
    expect(hint).toContain("queda un paso");
    expect(hint).toContain("12 V DC");
    expect(hint).toContain("Mida el voltaje");
  });

  it("buildStepHintLine EN echoes English prompt verbatim", () => {
    const englishStep =
      "Verify ground continuity between pump housing and chassis.";
    const hint = buildStepHintLine("EN", englishStep);
    expect(hint).toContain("One step is still open");
    expect(hint).toContain("Verify ground continuity");
  });
});
