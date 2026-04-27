import type { Language } from "@/lib/lang";

/**
 * Heuristic — does `text` look like it belongs to `language`?
 *
 * Used as a safety net for `buildStepHintLine`: if the active-step
 * prompt was registered only in English (e.g. water-pump procedure)
 * but the technician's reply language is RU/ES, we MUST NOT echo raw
 * English step text inside a RU/ES technician-facing response.
 *
 * Conservative thresholds — we accept the text only when the dominant
 * letter run matches the target language's script. Mixed-language
 * results fall back to the safe localized wording in
 * `buildStepHintLine`.
 */
export function looksLikeLanguage(text: string, language: Language): boolean {
  const letters = text.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g) ?? [];
  if (letters.length === 0) return true; // numeric / punctuation only — safe.
  const cyr = letters.filter((c) => /[\u0400-\u04FF]/.test(c)).length;
  const lat = letters.length - cyr;
  switch (language) {
    case "RU":
      // Reject if Latin letters dominate.
      return cyr >= Math.max(3, Math.floor(letters.length * 0.5));
    case "ES":
      // Spanish uses Latin script; reject if Cyrillic dominates.
      // Also require at least one Spanish-specific marker, otherwise the
      // text is likely English (which we must NOT echo into ES prose).
      if (cyr > lat) return false;
      return /[áéíóúñ¿¡]|(?:^|\s)(?:el|la|los|las|que|del|para|de|con|sin|cómo|qué|cuál|hay|verifica|comprueba|mide|inspecciona)\b/i.test(text);
    default:
      // EN — Latin letters expected.
      return lat >= cyr;
  }
}

/**
 * Filter an arbitrary list of server-authored text fragments
 * (e.g. sidecar `missingFields`, registry-derived labels) so only
 * fragments that match the technician's reply language survive.
 *
 * Architecture invariant: when the reply language is RU or ES,
 * raw English / wrong-script fragments must NEVER reach the
 * technician-facing response. Used by `buildSpecificReportGateResponse`
 * to keep Tier-1 sidecar wording language-consistent.
 */
export function filterServerAuthoredFragments(
  fragments: string[],
  language: Language,
): string[] {
  return fragments
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .filter((f) => looksLikeLanguage(f, language));
}

/**
 * Build the "one step still open" hint that follows the report-gate
 * acknowledgment. Echoes the active-step prompt verbatim when it is
 * already in the technician's reply language; otherwise returns a
 * safe localized explanation that does NOT mix languages.
 *
 * Authority contract: Context Engine is the source of truth for the
 * active step. This helper only formats the technician-facing prose.
 */
export function buildStepHintLine(language: Language, stepPrompt: string): string {
  const trimmed = stepPrompt.trim();
  const oneLine = trimmed.replace(/\s+/g, " ").slice(0, 240);
  const echoSafe = looksLikeLanguage(oneLine, language);
  switch (language) {
    case "RU":
      return echoSafe
        ? `Чтобы закрыть диагностику и оформить отчёт, остался один шаг: ${oneLine}`
        : "Чтобы закрыть диагностику и оформить отчёт, остался один шаг — подтверждение по текущему диагностическому пункту. Уточните результат текущей проверки, и я подготовлю отчёт.";
    case "ES":
      return echoSafe
        ? `Para cerrar el diagnóstico y emitir el informe, queda un paso: ${oneLine}`
        : "Para cerrar el diagnóstico y emitir el informe, queda un paso — la confirmación del paso de diagnóstico actual. Confírmame el resultado y preparo el informe.";
    default:
      return echoSafe
        ? `One step is still open before the report can be issued: ${oneLine}`
        : "One step is still open before the report can be issued — the confirmation for the current diagnostic check. Share the result and I'll prepare the report.";
  }
}
