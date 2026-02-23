/**
 * Intent Router
 * 
 * Server-side deterministic routing of technician messages into intents.
 * The LLM handles phrasing; the server handles routing.
 */

import type { Intent, EvidenceType } from "./types";

// ── Pattern Definitions ─────────────────────────────────────────────

const LOCATE_PATTERNS = [
  // English
  /where\s+(?:is|are|do\s+I\s+find|can\s+I\s+find|would\s+I\s+find)/i,
  /(?:location|position)\s+of/i,
  /(?:find|locate)\s+(?:the|a)/i,
  /where'?s\s+the/i,
  // Russian
  /где\s+(?:находится|находятся|искать|найти)/i,
  /(?:расположен|местоположение)/i,
  // Spanish
  /d[oó]nde\s+(?:est[aá]|encuentro|busco|puedo\s+encontrar)/i,
  /ubicaci[oó]n\s+de/i,
];

const EXPLAIN_PATTERNS = [
  // English
  /what\s+(?:is|are)\s+(?:a|an|the|this|that)/i,
  /what'?s\s+(?:a|an|the|this|that)/i,
  /(?:explain|describe)\s+(?:what|the)/i,
  /(?:tell\s+me\s+about|what\s+does)\s+(?:a|an|the)/i,
  /what\s+do\s+you\s+mean\s+by/i,
  // Russian
  /что\s+(?:такое|это|означает|значит)/i,
  /(?:объясни|расскажи)\s+(?:что|про)/i,
  // Spanish
  /qu[eé]\s+(?:es|son|significa)/i,
  /(?:explica|describe)\s+(?:qu[eé]|el|la)/i,
];

const HOWTO_PATTERNS = [
  // English
  /how\s+(?:do\s+I|to|can\s+I|should\s+I|would\s+I)\s+(?:check|test|measure|verify|inspect|diagnose)/i,
  /how\s+(?:do\s+I|to)\s+(?:do\s+(?:that|this|it))/i,
  /what\s+(?:should\s+I|do\s+I)\s+(?:use|need|look\s+for)/i,
  /(?:explain|show|tell)\s+(?:me\s+)?how/i,
  /how\s+(?:do\s+I|can\s+I)\s+(?:access|reach|get\s+to)/i,
  // Russian
  /как\s+(?:мне\s+)?(?:проверить|протестировать|измерить|проверять|сделать)/i,
  /каким\s+(?:образом|способом)/i,
  // Spanish
  /c[oó]mo\s+(?:puedo\s+)?(?:verificar|comprobar|medir|probar|revisar|hacer)/i,
  /de\s+qu[eé]\s+manera/i,
];

// New evidence patterns - triggers replan
const NEW_EVIDENCE_PATTERNS: Array<{ pattern: RegExp; type: EvidenceType }> = [
  // Physical damage (English)
  { pattern: /(?:found|discovered|noticed|see|saw|there'?s)\s+(?:a|the)?\s*(?:hole|leak|crack|burn|damage|corrosion|loose|broken|melted|burnt)/i, type: "physical_damage" },
  { pattern: /(?:it'?s|looks?)\s+(?:cracked|burnt|melted|corroded|damaged|broken|leaking)/i, type: "physical_damage" },
  // Physical damage (Russian)
  { pattern: /(?:нашёл|нашел|обнаружил|заметил|вижу)\s+(?:дыр|утечк|трещин|повреж|корроз)/i, type: "physical_damage" },
  // Physical damage (Spanish)
  { pattern: /(?:encontr[eé]|descubr[ií]|not[eé]|veo)\s+(?:un|una)?\s*(?:agujero|fuga|grieta|quemadura|da[nñ]o|corrosi[oó]n)/i, type: "physical_damage" },
  
  // Measurement change
  { pattern: /(?:now|but\s+now|wait)\s+(?:it'?s|I\s+(?:get|see|measure|read))/i, type: "measurement_change" },
  { pattern: /(?:reading|voltage|current|resistance)\s+(?:changed|is\s+different|now\s+shows)/i, type: "measurement_change" },
  
  // Technician dispute
  { pattern: /(?:that'?s\s+not|can'?t\s+be|doesn'?t\s+make\s+sense|are\s+you\s+sure|that'?s\s+wrong)/i, type: "technician_dispute" },
  { pattern: /(?:I\s+don'?t\s+(?:think|agree)|no\s+way|impossible)/i, type: "technician_dispute" },
  
  // New observation
  { pattern: /(?:I\s+also|also\s+noticed|another\s+thing|by\s+the\s+way|oh\s+and)/i, type: "new_observation" },
  { pattern: /(?:wait|hold\s+on|actually)\s*[,.]?\s*(?:I|there)/i, type: "new_observation" },
];

// Already answered patterns
const ALREADY_ANSWERED_PATTERNS = [
  /already\s+(?:checked|tested|verified|answered|told|said|mentioned|confirmed|reported|measured|looked)/i,
  /i\s+(?:already|just)\s+(?:checked|tested|verified|told|said|mentioned|confirmed|reported|measured)/i,
  /(?:told|said|mentioned)\s+(?:you|that)\s+(?:already|before|earlier)/i,
  /как\s+(?:я\s+)?(?:уже\s+)?(?:сказал|говорил|проверил|упомянул)/i,
  /уже\s+(?:проверил|проверено|сказал|ответил|делал|смотрел)/i,
  /ya\s+(?:lo\s+)?(?:revis[eé]|verifiqu[eé]|dije|mencion[eé]|comprob[eé])/i,
];

// Unable to verify patterns
const UNABLE_TO_VERIFY_PATTERNS = [
  /(?:don'?t|do\s+not|can'?t|cannot|can\s+not)\s+(?:know|see|tell|check|verify|measure|test|access|reach)/i,
  /(?:no\s+(?:way|access|tool|meter|multimeter))\s+(?:to\s+)?(?:check|measure|verify|test)/i,
  /unable\s+to\s+(?:verify|check|confirm|measure|test|access)/i,
  /not\s+(?:sure|certain|able)\s+(?:about|how|if)/i,
  /(?:не\s+(?:знаю|могу|вижу|проверить|могу\s+проверить))/i,
  /(?:no\s+(?:s[eé]|puedo|tengo))\s+(?:como|verificar|comprobar|medir)/i,
];

// Confirmation patterns (for labor)
const CONFIRMATION_PATTERNS = [
  /\b(?:confirm|ok|okay|yes|да|подтвер|s[ií]|confirmo|good|agree|accept|fine|correct|right|approve|looks?\s+good)\b/i,
];

// ── Intent Detection ────────────────────────────────────────────────

/**
 * Detect the primary intent from a technician message.
 * This is deterministic pattern matching - NOT LLM inference.
 */
export function detectIntent(message: string): Intent {
  const trimmed = message.trim();
  
  // Check for locate intent first (takes precedence over explain for mixed queries)
  for (const pattern of LOCATE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "LOCATE", query: extractQuery(trimmed, pattern) };
    }
  }
  
  // Check for explain intent
  for (const pattern of EXPLAIN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "EXPLAIN", query: extractQuery(trimmed, pattern) };
    }
  }
  
  // Check for howto intent
  for (const pattern of HOWTO_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "HOWTO", query: extractQuery(trimmed, pattern) };
    }
  }
  
  // Check for already answered
  for (const pattern of ALREADY_ANSWERED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "ALREADY_ANSWERED" };
    }
  }
  
  // Check for unable to verify
  for (const pattern of UNABLE_TO_VERIFY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "UNABLE_TO_VERIFY" };
    }
  }
  
  // Check for new evidence (potential replan trigger)
  for (const { pattern, type } of NEW_EVIDENCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { 
        type: "DISPUTE_OR_NEW_EVIDENCE", 
        evidence: trimmed,
        evidenceType: type,
      };
    }
  }
  
  // Check for confirmation (labor context)
  // First check for a number (override) - but be more careful about context
  // Numbers embedded in technical descriptions should not be treated as confirmations
  const technicalContextPatterns = [
    /(?:motor|pump|fan|voltage|volts?|v\b|dc|ac|power|battery|runs?|works?|operates?|apply)/i,
  ];
  
  const looksLikeTechnicalContext = technicalContextPatterns.some(p => p.test(trimmed));
  
  if (!looksLikeTechnicalContext) {
    const numberMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h\b|ч|час)?/i);
    if (numberMatch) {
      const value = parseFloat(numberMatch[1]);
      if (value >= 0.5 && value <= 20) {
        return { type: "CONFIRMATION", value };
      }
    }
  }
  
  // Also check for standalone numbers (e.g., just "2.5" or "1.5 hours")
  const standaloneNumber = trimmed.match(/^[\s]*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h\b|ч|час)?[\s]*$/i);
  if (standaloneNumber) {
    const value = parseFloat(standaloneNumber[1]);
    if (value >= 0.5 && value <= 20) {
      return { type: "CONFIRMATION", value };
    }
  }
  
  // Then check for confirmation keywords
  for (const pattern of CONFIRMATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "CONFIRMATION", value: "accept" };
    }
  }
  
  // Default: main diagnostic flow
  return { type: "MAIN_DIAGNOSTIC" };
}

/**
 * Check if a message contains new evidence that might trigger replan.
 * This is more sensitive than detectIntent - used when isolation is complete.
 */
export function detectNewEvidence(message: string): { 
  hasNewEvidence: boolean; 
  evidenceType?: EvidenceType;
  evidence?: string;
} {
  for (const { pattern, type } of NEW_EVIDENCE_PATTERNS) {
    if (pattern.test(message)) {
      return { 
        hasNewEvidence: true, 
        evidenceType: type,
        evidence: message,
      };
    }
  }
  return { hasNewEvidence: false };
}

/**
 * Check if a message is a clarification request (locate/explain/howto)
 */
export function isClarificationRequest(message: string): boolean {
  const allPatterns = [...LOCATE_PATTERNS, ...EXPLAIN_PATTERNS, ...HOWTO_PATTERNS];
  return allPatterns.some(p => p.test(message));
}

/**
 * Extract the query portion from a message after the pattern match
 */
function extractQuery(message: string, pattern: RegExp): string {
  // Get the part after the pattern match
  const match = message.match(pattern);
  if (!match) return message;
  
  const matchEnd = match.index! + match[0].length;
  const afterMatch = message.slice(matchEnd).trim();
  
  // Clean up common trailing words
  return afterMatch
    .replace(/^(?:the|a|an|this|that)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim() || message;
}

/**
 * Get a human-readable description of an intent
 */
export function describeIntent(intent: Intent): string {
  switch (intent.type) {
    case "MAIN_DIAGNOSTIC":
      return "Diagnostic response";
    case "LOCATE":
      return `Locate request: "${intent.query}"`;
    case "EXPLAIN":
      return `Explain request: "${intent.query}"`;
    case "HOWTO":
      return `How-to request: "${intent.query}"`;
    case "DISPUTE_OR_NEW_EVIDENCE":
      return `New evidence (${intent.evidenceType}): "${intent.evidence.slice(0, 50)}..."`;
    case "CONFIRMATION":
      return `Labor confirmation: ${intent.value}`;
    case "ALREADY_ANSWERED":
      return "Already answered signal";
    case "UNABLE_TO_VERIFY":
      return "Unable to verify signal";
    case "UNCLEAR":
      return "Unclear intent";
    default:
      return "Unknown intent";
  }
}
