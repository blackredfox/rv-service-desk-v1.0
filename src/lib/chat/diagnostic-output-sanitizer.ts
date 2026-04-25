/**
 * Diagnostic output sanitizer — strip server-side metadata banners from
 * tokens emitted to the technician.
 *
 * Authority contract:
 *   - Server owns state, legality, safety, and Context Engine authority.
 *   - LLM owns the technician-facing conversation.
 *   - The diagnostic system prompt embeds internal status banners
 *     (active procedure name, progress counters, "ASK EXACTLY", step
 *     identifiers) so the LLM can ground its answer. Those banners are
 *     for the LLM only — they MUST NOT leak into the user's chat.
 *
 *   - This sanitizer is a stateful, line-buffered streaming filter that
 *     drops banner lines and strips internal step prefixes BEFORE the
 *     token reaches the SSE stream. It changes nothing about state,
 *     legality, or Context Engine flow.
 *
 *   - Sanitization is feature-flagged via
 *     `DISABLE_DIAGNOSTIC_OUTPUT_SANITIZER=1` for emergency rollback.
 *     The default is enabled.
 *
 * Failure mode:
 *   - The sanitizer never throws, never blocks, and never changes the
 *     visible meaning of natural prose. It only removes whole lines
 *     that match strict, conservative patterns and strips a small set
 *     of leading step-id prefixes.
 */

const DISABLE_FLAG_ENV = "DISABLE_DIAGNOSTIC_OUTPUT_SANITIZER";

export const DIAGNOSTIC_OUTPUT_SANITIZER_FLAG_ENV = DISABLE_FLAG_ENV;

export function isDiagnosticOutputSanitizerEnabled(): boolean {
  const raw = process.env[DISABLE_FLAG_ENV];
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  // Disabled only when the operator explicitly opts out.
  return !(normalized === "1" || normalized === "true");
}

// ── Drop-the-whole-line patterns ───────────────────────────────────────
//
// These patterns intentionally match the whole line (with optional
// surrounding whitespace). They cover the actual banners observed in
// production transcripts (Cases 78–86).
//
// Separator class for "Detected RU · Reply RU"-style banners — broadened
// to cover middle-dot, bullet, hyphen-minus, en-dash, em-dash, pipe, and
// slash variants observed in Case 86.
const SEP = "[·•∙\u00B7\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015|/]";

const DROP_LINE_PATTERNS: RegExp[] = [
  // Language/control banners
  /^\s*Copy\s*$/i,
  /^\s*Reply\s+(?:RU|EN|ES)\s*$/i,
  new RegExp(`^\\s*Detected\\s+(?:RU|EN|ES)(?:\\s*${SEP}\\s*Reply\\s+(?:RU|EN|ES))?\\s*$`, "i"),
  /^\s*(?:RU|EN|ES)\s*[—–-]\s*(?:RU|EN|ES)\s*$/i,
  /^\s*(?:Output\s+)?Policy\s*:.*$/i,

  // Russian internal status banner observed in Cases 81/86/95–99.
  // `Состояние` (state) added per Case-86 manual acceptance feedback.
  // `Первый\s+(?:[\wа-яё]+\s+)?шаг` covers `Первый шаг` AND
  // `Первый действительный шаг` / `Первый необходимый шаг` (Case-97).
  /^\s*(?:Система|Классификация|Режим|Состояние|Статус|Прогресс)\s*:.*$/iu,
  /^\s*Первый(?:\s+[\wа-яё]+){0,2}\s+шаг\s*:.*$/iu,
  /^\s*АКТИВНАЯ\s+ДИАГНОСТИЧЕСКАЯ\s+ПРОЦЕДУРА\s*:.*$/iu,
  /^\s*ТЕКУЩИЙ\s+ШАГ\s*:.*$/iu,
  /^\s*Задай\s+ТОЧНО\s*:.*$/iu,
  /^\s*ВСЕ\s+ШАГИ\s+ЗАВЕРШЕНЫ\.?\s*$/iu,

  // English equivalents (system prompt label leakage)
  /^\s*(?:System|Classification|Mode|State|Status|Progress)\s*:\s+.{0,400}$/i,
  /^\s*First(?:\s+\S+){0,2}\s+step\s*:.*$/i,
  /^\s*ACTIVE\s+DIAGNOSTIC\s+PROCEDURE\s*:.*$/i,
  /^\s*CURRENT\s+STEP\s*:.*$/i,
  /^\s*Ask\s+EXACTLY\s*:.*$/i,
  /^\s*ALL\s+STEPS\s+COMPLETE\.?\s*$/i,

  // Spanish equivalents
  /^\s*(?:Sistema|Clasificación|Modo|Estado|Progreso)\s*:.*$/i,
  // Spanish places adjectives AFTER the noun, so we accept up to 2
  // words AFTER `paso` (e.g. `Primer paso necesario:` / `Primero paso
  // adecuado:`) in addition to the canonical `Primer paso:`.
  /^\s*Primer(?:o)?\s+paso(?:\s+\S+){0,2}\s*:.*$/i,
  /^\s*PROCEDIMIENTO\s+DE\s+DIAGN[ÓO]STICO\s+ACTIVO\s*:.*$/i,
  /^\s*PASO\s+ACTUAL\s*:.*$/i,
  /^\s*Pregunta\s+EXACTAMENTE\s*:.*$/i,
  /^\s*TODOS\s+LOS\s+PASOS\s+COMPLETADOS\.?\s*$/i,

  // Procedure-name header banner observed in Case-88, e.g.:
  //   "Water Pump — Пошаговая диагностика"
  //   "Water Heater — Step-by-step diagnostics"
  //   "Bomba de agua — Diagnóstico paso a paso"
  // The LLM rephrases the internal procedure-context banner into a
  // human-readable header. Drop the whole line in any reply language.
  /^\s*\S[^\n]*?\s*[—–\-]\s*Пошаговая\s+диагностика\.?\s*$/iu,
  /^\s*\S[^\n]*?\s*[—–\-]\s*Step[-\s]*by[-\s]*step\s+diagnostic(?:s)?\.?\s*$/i,
  /^\s*\S[^\n]*?\s*[—–\-]\s*Diagn[óo]stico\s+paso\s+a\s+paso\.?\s*$/iu,
];

// ── Strip-leading-prefix patterns ──────────────────────────────────────
//
// These patterns match a known internal step-id prefix at the start of a
// line and remove ONLY the prefix, preserving the actual question text.
// Example: "Шаг wh_3: Работают ли другие LP-приборы?" → "Работают ли другие LP-приборы?"
const STRIP_PREFIX_PATTERNS: RegExp[] = [
  /^\s*Шаг\s+\S+\s*:\s*/iu,
  /^\s*Step\s+\S+\s*:\s*/i,
  /^\s*Paso\s+\S+\s*:\s*/i,
];

// ── Strip-inline patterns ──────────────────────────────────────────────
//
// These patterns remove inline metadata fragments that appear MID-line
// (i.e., not at the very start), e.g. when the LLM concatenates a
// banner and a sentence into one line. Examples observed in Case 86:
//   "Принято. Шаг wh_3: Работают ли..."  →  "Принято. Работают ли..."
//   "Detected RU · Reply RU. Continue..."  →  ". Continue..."  (then trimmed)
//
// IMPORTANT: JavaScript `\b` is ASCII-only — it does NOT respect
// Cyrillic word boundaries. We use a lookbehind for "start of line OR
// whitespace OR sentence-terminator punctuation" so the inline strip
// works for "Принято. Шаг wh_3:" as well as English/ES.
const STRIP_INLINE_PATTERNS: RegExp[] = [
  /(?<=^|[\s.,;:])Шаг\s+\S+\s*:\s*/giu,
  /(?<=^|[\s.,;:])Step\s+\S+\s*:\s*/gi,
  /(?<=^|[\s.,;:])Paso\s+\S+\s*:\s*/gi,
  new RegExp(`(?<=^|[\\s.,;:])Detected\\s+(?:RU|EN|ES)(?:\\s*${SEP}\\s*Reply\\s+(?:RU|EN|ES))?\\s*\\.?\\s*`, "gi"),
];

/**
 * Sanitize a single complete line of LLM output.
 *
 * @param line raw output line (no trailing newline)
 * @param options optional behaviour switches:
 *   - `replyLanguage`: when "RU" or "ES", a step-prefix line whose
 *     residual content is dominantly the wrong script (e.g. an English
 *     active-step prompt leaked into a RU response — Case-88) is dropped
 *     entirely instead of emitting the raw foreign-language text.
 *
 * Returns:
 *   - `null` if the line should be dropped entirely
 *   - the (possibly modified) line otherwise
 */
export function sanitizeLine(
  line: string,
  options?: { replyLanguage?: "RU" | "EN" | "ES" },
): string | null {
  // Drop empty lines that arise from cleaning above (let the caller
  // collapse repeated blank lines).
  for (const pat of DROP_LINE_PATTERNS) {
    if (pat.test(line)) return null;
  }
  let out = line;
  let prefixWasStripped = false;
  for (const pat of STRIP_PREFIX_PATTERNS) {
    const replaced = out.replace(pat, "");
    if (replaced !== out) {
      prefixWasStripped = true;
      out = replaced;
    }
  }
  // Strip inline metadata fragments mid-line (Case 86 leakage).
  for (const pat of STRIP_INLINE_PATTERNS) {
    out = out.replace(pat, "");
  }
  // Collapse runs of whitespace introduced by the inline strips and
  // trim any leading punctuation/whitespace left behind.
  out = out.replace(/\s{2,}/g, " ").replace(/^[\s.,;:·•|/—–-]+/, "");

  // Case-88 — Language-fidelity drop:
  // If a step-prefix was stripped (i.e. this line was originally
  // "Шаг wp_2: Measure voltage..." or similar) and the technician's
  // reply language is RU / ES, the residual must be in the same
  // script. Otherwise the registry's English step text is leaking
  // into a non-English reply. Drop the line rather than echo it.
  if (
    prefixWasStripped &&
    options?.replyLanguage &&
    options.replyLanguage !== "EN" &&
    !looksLikeReplyLanguage(out, options.replyLanguage)
  ) {
    return null;
  }

  return out;
}

/**
 * Conservative dominance check used by `sanitizeLine` to decide whether
 * the residual of a step-prefix line is still in the technician's reply
 * language. Mirrors the behaviour of `looksLikeLanguage` in
 * `report-gate-language.ts` but is duplicated here intentionally so the
 * sanitizer has zero coupling to the report-gate module.
 */
function looksLikeReplyLanguage(
  text: string,
  language: "RU" | "ES",
): boolean {
  const letters = text.match(/[A-Za-z\u00C0-\u024F\u0400-\u04FF]/g) ?? [];
  if (letters.length === 0) return true; // numeric / punctuation only
  const cyr = letters.filter((c) => /[\u0400-\u04FF]/.test(c)).length;
  const lat = letters.length - cyr;
  if (language === "RU") {
    return cyr >= Math.max(3, Math.floor(letters.length * 0.5));
  }
  // ES — Latin script expected. Reject if Cyrillic dominates and require
  // a Spanish-specific marker (otherwise Latin text is likely English,
  // which we must NOT echo into ES prose either).
  if (cyr > lat) return false;
  return /[áéíóúñ¿¡]|(?:^|\s)(?:el|la|los|las|que|del|para|de|con|sin|cómo|qué|cuál|hay|verifica|comprueba|mide|inspecciona)\b/i.test(text);
}

export type SanitizingEmitter = {
  /** Process and forward (or drop) the next chunk of LLM output. */
  emit: (chunk: string) => void;
  /** Flush any buffered partial line. Call once at end-of-stream. */
  flush: () => void;
};

/**
 * Wrap a downstream `emitToken(text)` callback with a stateful, line-buffered
 * sanitizer. Streaming-safe: tokens may arrive partial and are buffered until
 * a newline is observed. The wrapper preserves token-level streaming by
 * forwarding any non-banner content immediately for inline strips, and
 * forwarding completed lines as soon as `\n` is seen.
 *
 * IMPORTANT: callers MUST invoke `flush()` exactly once after the upstream
 * stream has finished, so the final unterminated buffer can be evaluated.
 *
 * Optional `options.replyLanguage`: when "RU" or "ES", lines with stripped
 * step-id prefixes whose residual is dominantly the wrong script are
 * dropped (Case-88 — registry-only English active-step text MUST NOT leak
 * into a non-English technician-facing reply).
 */
export function wrapEmitterWithDiagnosticSanitizer(
  emitToken: (text: string) => void,
  options?: { replyLanguage?: "RU" | "EN" | "ES" },
): SanitizingEmitter {
  let pending = "";
  // Track whether the previous emitted character was a newline so we can
  // collapse runs of blank lines created by line drops.
  let lastEmittedWasNewline = true;

  function commitLine(line: string, withNewline: boolean): void {
    const sanitized = sanitizeLine(line, options);
    if (sanitized === null) {
      // Whole line dropped — collapse adjacent newlines.
      return;
    }
    if (sanitized.length === 0) {
      // Strip-prefix turned the line into empty. Avoid emitting a
      // duplicate blank line directly after another blank.
      if (lastEmittedWasNewline && !withNewline) return;
      if (lastEmittedWasNewline) return;
      emitToken("\n");
      lastEmittedWasNewline = true;
      return;
    }
    emitToken(sanitized);
    if (withNewline) {
      emitToken("\n");
      lastEmittedWasNewline = true;
    } else {
      lastEmittedWasNewline = false;
    }
  }

  function processBuffered(): void {
    while (true) {
      const idx = pending.indexOf("\n");
      if (idx < 0) {
        // No newline yet — keep buffering. Do not forward partial line
        // content; it could be a partial banner.
        return;
      }
      const line = pending.slice(0, idx);
      pending = pending.slice(idx + 1);
      commitLine(line, /* withNewline */ true);
    }
  }

  return {
    emit(chunk: string) {
      if (!chunk) return;
      pending += chunk;
      processBuffered();
    },
    flush() {
      // Evaluate the final un-terminated buffer (if any).
      if (pending.length > 0) {
        commitLine(pending, /* withNewline */ false);
        pending = "";
      }
      // No-op if the stream ended on a newline we already emitted.
      lastEmittedWasNewline = true;
    },
  };
}
