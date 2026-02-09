export type Language = "EN" | "RU" | "ES";

export type LanguageMode = "AUTO" | Language;

/**
 * Payload v2: Input language detection result
 */
export type InputLanguageV2 = {
  /** Always the best guess for THIS message's language */
  detected: Language;
  /** How we got `detected`: "server" = backend detector, "client" = frontend hint */
  source: "server" | "client";
  /** Confidence score 0-1 */
  confidence?: number;
  /** Detection method used */
  reason?: string;
};

/**
 * Payload v2: Output language policy
 */
export type OutputLanguagePolicyV2 = {
  /** What user selected in the dropdown at send-time */
  mode: LanguageMode;
  /** Effective assistant dialogue output language for THIS turn */
  effective: Language;
  /** "auto" when mode === "AUTO", "forced" when mode !== "AUTO" */
  strategy: "auto" | "forced";
};

const CYRILLIC_RE = /[\u0400-\u04FF]/;

/**
 * Lightweight heuristic language detection (MVP-safe, deterministic)
 * Returns detected language, confidence, and reason
 */
export function detectLanguage(text: string): { language: Language; confidence: number; reason: string } {
  const sample = (text ?? "").trim();
  if (!sample) return { language: "EN", confidence: 0.3, reason: "empty-input" };

  if (CYRILLIC_RE.test(sample)) return { language: "RU", confidence: 0.9, reason: "heuristic-cyrillic" };

  const lowered = sample.toLowerCase();
  const spanishSignals = [
    "¿",
    "¡",
    "ñ",
    "á",
    "é",
    "í",
    "ó",
    "ú",
    "diagnóstico",
    "reparación",
    "garantía",
    "cliente",
  ];
  const hits = spanishSignals.reduce((acc, s) => (lowered.includes(s) ? acc + 1 : acc), 0);
  if (hits >= 2) return { language: "ES", confidence: 0.75, reason: "heuristic-spanish-markers" };

  return { language: "EN", confidence: 0.6, reason: "heuristic-default" };
}

/**
 * Detect input language and build InputLanguageV2 structure
 */
export function detectInputLanguageV2(text: string): InputLanguageV2 {
  const detection = detectLanguage(text);
  return {
    detected: detection.language,
    source: "server",
    confidence: detection.confidence,
    reason: detection.reason,
  };
}

/**
 * Compute effective output language based on mode and detected input
 */
export function computeOutputPolicy(mode: LanguageMode, inputDetected: Language): OutputLanguagePolicyV2 {
  if (mode === "AUTO") {
    return {
      mode: "AUTO",
      effective: inputDetected,
      strategy: "auto",
    };
  }
  return {
    mode,
    effective: mode,
    strategy: "forced",
  };
}

export function normalizeLanguageMode(input: unknown): LanguageMode {
  if (input === "AUTO") return "AUTO";
  if (input === "EN" || input === "RU" || input === "ES") return input;
  return "AUTO";
}

/**
 * Declarative language policy for output composition.
 * Single source of truth for translation behavior.
 *
 * | Mode | Primary Output | Translation Included | Translation Language |
 * |------|---------------|---------------------|---------------------|
 * | EN   | English       | No                  | —                   |
 * | RU   | English       | Yes                 | Russian             |
 * | ES   | English       | Yes                 | Spanish             |
 * | AUTO | English       | Depends on detected | Detected language   |
 */
export type LanguagePolicy = {
  mode: LanguageMode;
  primaryOutput: Language;
  includeTranslation: boolean;
  translationLanguage?: Language;
};

/**
 * Resolve the declarative language policy from mode + detected input.
 * This function is the SINGLE SOURCE OF TRUTH for whether translation
 * should appear in the output. Nothing else decides this.
 */
export function resolveLanguagePolicy(
  mode: LanguageMode,
  inputDetected: Language,
): LanguagePolicy {
  switch (mode) {
    case "EN":
      return { mode: "EN", primaryOutput: "EN", includeTranslation: false };
    case "RU":
      return { mode: "RU", primaryOutput: "EN", includeTranslation: true, translationLanguage: "RU" };
    case "ES":
      return { mode: "ES", primaryOutput: "EN", includeTranslation: true, translationLanguage: "ES" };
    case "AUTO":
      if (inputDetected === "EN") {
        return { mode: "AUTO", primaryOutput: "EN", includeTranslation: false };
      }
      return { mode: "AUTO", primaryOutput: "EN", includeTranslation: true, translationLanguage: inputDetected };
    default:
      return { mode: "EN", primaryOutput: "EN", includeTranslation: false };
  }
}
