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
// production transcripts.
const DROP_LINE_PATTERNS: RegExp[] = [
  // Language/control banners
  /^\s*Copy\s*$/i,
  /^\s*Reply\s+(?:RU|EN|ES)\s*$/i,
  /^\s*Detected\s+(?:RU|EN|ES)(?:\s*[·•-]\s*Reply\s+(?:RU|EN|ES))?\s*$/i,
  /^\s*(?:RU|EN|ES)\s*[—–-]\s*(?:RU|EN|ES)\s*$/i,
  /^\s*(?:Output\s+)?Policy\s*:.*$/i,

  // Russian internal status banner observed in Case-81
  /^\s*(?:Система|Классификация|Режим|Статус|Прогресс|Первый\s+шаг)\s*:.*$/iu,
  /^\s*АКТИВНАЯ\s+ДИАГНОСТИЧЕСКАЯ\s+ПРОЦЕДУРА\s*:.*$/iu,
  /^\s*ТЕКУЩИЙ\s+ШАГ\s*:.*$/iu,
  /^\s*Задай\s+ТОЧНО\s*:.*$/iu,
  /^\s*ВСЕ\s+ШАГИ\s+ЗАВЕРШЕНЫ\.?\s*$/iu,

  // English equivalents (system prompt label leakage)
  /^\s*(?:System|Classification|Mode|Status|Progress|First\s+step)\s*:\s+.{0,400}$/i,
  /^\s*ACTIVE\s+DIAGNOSTIC\s+PROCEDURE\s*:.*$/i,
  /^\s*CURRENT\s+STEP\s*:.*$/i,
  /^\s*Ask\s+EXACTLY\s*:.*$/i,
  /^\s*ALL\s+STEPS\s+COMPLETE\.?\s*$/i,

  // Spanish equivalents
  /^\s*(?:Sistema|Clasificación|Modo|Estado|Progreso|Primer\s+paso)\s*:.*$/i,
  /^\s*PROCEDIMIENTO\s+DE\s+DIAGN[ÓO]STICO\s+ACTIVO\s*:.*$/i,
  /^\s*PASO\s+ACTUAL\s*:.*$/i,
  /^\s*Pregunta\s+EXACTAMENTE\s*:.*$/i,
  /^\s*TODOS\s+LOS\s+PASOS\s+COMPLETADOS\.?\s*$/i,
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

/**
 * Sanitize a single complete line of LLM output.
 * Returns:
 *   - `null` if the line should be dropped entirely
 *   - the (possibly modified) line otherwise
 */
export function sanitizeLine(line: string): string | null {
  // Drop empty lines that arise from cleaning above (let the caller
  // collapse repeated blank lines).
  for (const pat of DROP_LINE_PATTERNS) {
    if (pat.test(line)) return null;
  }
  let out = line;
  for (const pat of STRIP_PREFIX_PATTERNS) {
    out = out.replace(pat, "");
  }
  return out;
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
 */
export function wrapEmitterWithDiagnosticSanitizer(
  emitToken: (text: string) => void,
): SanitizingEmitter {
  let pending = "";
  // Track whether the previous emitted character was a newline so we can
  // collapse runs of blank lines created by line drops.
  let lastEmittedWasNewline = true;

  function commitLine(line: string, withNewline: boolean): void {
    const sanitized = sanitizeLine(line);
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
