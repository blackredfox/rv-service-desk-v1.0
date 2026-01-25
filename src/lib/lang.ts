export type Language = "EN" | "RU" | "ES";

export type LanguageMode = "AUTO" | Language;

const CYRILLIC_RE = /[\u0400-\u04FF]/;

// Very lightweight heuristic detection (MVP-safe). Deterministic.
export function detectLanguage(text: string): { language: Language; confidence: number } {
  const sample = (text ?? "").trim();
  if (!sample) return { language: "EN", confidence: 0.3 };

  if (CYRILLIC_RE.test(sample)) return { language: "RU", confidence: 0.9 };

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
  if (hits >= 2) return { language: "ES", confidence: 0.75 };

  return { language: "EN", confidence: 0.6 };
}

export function normalizeLanguageMode(input: unknown): LanguageMode {
  if (input === "AUTO") return "AUTO";
  if (input === "EN" || input === "RU" || input === "ES") return input;
  return "AUTO";
}
