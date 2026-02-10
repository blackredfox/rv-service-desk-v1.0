/**
 * Diagnostic Registry — per-case state tracking for diagnostic questions.
 *
 * Tracks which diagnostic areas have been answered or marked as
 * unable-to-verify, so the agent never repeats closed questions.
 *
 * Also detects "key findings" that trigger immediate diagnostic pivoting.
 */

type DiagnosticEntry = {
  /** Topics / questions the technician has answered */
  answeredKeys: Set<string>;
  /** Topics the technician explicitly cannot verify */
  unableToVerifyKeys: Set<string>;
  /** Key findings that may trigger early isolation */
  keyFindings: string[];
};

const registry = new Map<string, DiagnosticEntry>();

function ensureEntry(caseId: string): DiagnosticEntry {
  let entry = registry.get(caseId);
  if (!entry) {
    entry = { answeredKeys: new Set(), unableToVerifyKeys: new Set(), keyFindings: [] };
    registry.set(caseId, entry);
  }
  return entry;
}

// ── Answered detection ──────────────────────────────────────────────

const ALREADY_ANSWERED_PATTERNS = [
  /already\s+(?:checked|tested|verified|answered|told|said|mentioned|confirmed|reported|measured|looked)/i,
  /i\s+(?:already|just)\s+(?:checked|tested|verified|told|said|mentioned|confirmed|reported|measured)/i,
  /(?:told|said|mentioned)\s+(?:you|that)\s+(?:already|before|earlier)/i,
  /как\s+(?:я\s+)?(?:уже\s+)?(?:сказал|говорил|проверил|упомянул)/i,   // RU
  /уже\s+(?:проверил|проверено|сказал|ответил|делал|смотрел)/i,         // RU
  /ya\s+(?:lo\s+)?(?:revisé|verifiqué|dije|mencioné|comprobé)/i,       // ES
];

/**
 * Check if a message indicates the technician already answered something.
 */
export function detectAlreadyAnswered(message: string): boolean {
  return ALREADY_ANSWERED_PATTERNS.some((p) => p.test(message));
}

// ── Unable-to-verify detection ──────────────────────────────────────

const UNABLE_TO_VERIFY_PATTERNS = [
  /(?:don'?t|do\s+not|can'?t|cannot|can\s+not)\s+(?:know|see|tell|check|verify|measure|test|access|reach)/i,
  /(?:no\s+(?:way|access|tool|meter|multimeter))\s+(?:to\s+)?(?:check|measure|verify|test)/i,
  /unable\s+to\s+(?:verify|check|confirm|measure|test|access)/i,
  /not\s+(?:sure|certain|able)\s+(?:about|how|if)/i,
  /(?:не\s+(?:знаю|могу|вижу|проверить|могу\s+проверить))/i,           // RU
  /(?:no\s+(?:sé|puedo|tengo))\s+(?:como|verificar|comprobar|medir)/i, // ES
];

/**
 * Check if a message indicates the technician cannot verify something.
 */
export function detectUnableToVerify(message: string): boolean {
  return UNABLE_TO_VERIFY_PATTERNS.some((p) => p.test(message));
}

// ── Diagnostic topic extraction ─────────────────────────────────────

const DIAGNOSTIC_TOPICS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "voltage", patterns: [/volt(?:age|s)?/i, /напряжени/i, /voltaje/i] },
  { key: "ground", patterns: [/ground/i, /земл/i, /tierra/i, /continuity/i] },
  { key: "pump_noise", patterns: [/pump.*(?:noise|sound|hum|vibrat)/i, /насос.*(?:шум|звук)/i] },
  { key: "pressure_switch", patterns: [/pressure\s*switch/i, /реле\s*давлен/i] },
  { key: "visual_inspection", patterns: [/visual|corrosion|burn\s*mark|damage/i, /визуальн|коррози/i] },
  { key: "breaker_fuse", patterns: [/breaker|fuse/i, /автомат|предохранител/i] },
  { key: "thermostat", patterns: [/thermostat/i, /термостат/i] },
  { key: "capacitor", patterns: [/capacitor/i, /конденсатор/i] },
  { key: "compressor", patterns: [/compressor/i, /компрессор/i] },
  { key: "blower_fan", patterns: [/blower|fan\s*(?:blade|wheel|motor)/i, /вентилятор|лопаст/i] },
  { key: "igniter", patterns: [/ignit(?:er|ion)/i, /поджиг|розжиг/i] },
  { key: "gas_valve", patterns: [/gas\s*valve/i, /газовый\s*клапан/i] },
  { key: "flame_sensor", patterns: [/flame\s*sensor/i, /датчик\s*пламен/i] },
  { key: "filter", patterns: [/filter/i, /фильтр/i] },
  { key: "contactor", patterns: [/contactor/i, /контактор/i] },
  { key: "condenser_fan", patterns: [/condenser\s*fan/i, /вентилятор\s*конденсатор/i] },
  { key: "water_damage", patterns: [/water.*(?:damage|leak)/i, /повреждение.*вод/i] },
  { key: "error_codes", patterns: [/error\s*code|fault\s*(?:code|light|indicator)/i, /код\s*ошиб/i] },
  { key: "wiring", patterns: [/wir(?:ing|e)\s*(?:connection|damage)/i, /провод/i] },
];

/**
 * Extract diagnostic topics mentioned in a message.
 */
export function extractTopics(message: string): string[] {
  const found: string[] = [];
  for (const topic of DIAGNOSTIC_TOPICS) {
    if (topic.patterns.some((p) => p.test(message))) {
      found.push(topic.key);
    }
  }
  return found;
}

// ── Key finding (pivot trigger) detection ───────────────────────────

const KEY_FINDING_PATTERNS: Array<{ pattern: RegExp; finding: string }> = [
  { pattern: /missing\s+(?:fan\s*)?blade/i, finding: "missing fan blade" },
  { pattern: /(?:fan|blower)\s*(?:blade|wheel)\s*(?:is\s+)?(?:missing|broken|cracked|gone)/i, finding: "fan/blower blade damage" },
  { pattern: /blower\s*wheel\s*(?:damage|crack|broken|gone|missing)/i, finding: "blower wheel damage" },
  { pattern: /(?:component|blade|wheel|part)\s*(?:contact|touch|rub|scraping)\s*(?:housing|shroud|casing)/i, finding: "component contacting housing" },
  { pattern: /(?:visibly|visible|obvious)\s*(?:compromised|destroyed|snapped|shattered|melted|burnt)/i, finding: "visibly compromised part" },
  { pattern: /(?:motor|compressor|pump)\s*(?:seized|locked|frozen|burnt\s*out)/i, finding: "seized/locked motor" },
  { pattern: /(?:coil|winding)\s*(?:open|short|burnt)/i, finding: "open/shorted coil" },
  { pattern: /(?:crack|hole|split)\s*(?:in\s+)?(?:housing|casing|body|tank)/i, finding: "cracked housing" },
  { pattern: /(?:no|zero)\s*(?:resistance|continuity)\s*(?:through|across|at)/i, finding: "open circuit confirmed" },
  { pattern: /(?:amp|current)\s*draw\s*(?:is\s+)?(?:zero|0|none)/i, finding: "zero current draw" },
  { pattern: /(?:shaft|axle|bearing)\s*(?:broken|snapped|worn\s*out|play|wobble)/i, finding: "mechanical failure" },
  { pattern: /лопаст.*(?:отсутств|слома|повреж|нет)/i, finding: "blade missing/damaged (RU)" },
  { pattern: /(?:не|нет)\s*(?:сопротивлен|непрерывност)/i, finding: "open circuit (RU)" },
];

/**
 * Detect a key diagnostic finding that should trigger pivot/early isolation.
 * Returns the finding description or null.
 */
export function detectKeyFinding(message: string): string | null {
  for (const { pattern, finding } of KEY_FINDING_PATTERNS) {
    if (pattern.test(message)) return finding;
  }
  return null;
}

// ── Registry operations ─────────────────────────────────────────────

/**
 * Process a technician message: update the registry with answered topics,
 * unable-to-verify topics, and key findings.
 */
export function processUserMessage(caseId: string, message: string): {
  newAnswered: string[];
  newUnable: string[];
  keyFinding: string | null;
  alreadyAnswered: boolean;
} {
  const entry = ensureEntry(caseId);
  const topics = extractTopics(message);
  const isAlreadyAnswered = detectAlreadyAnswered(message);
  const isUnableToVerify = detectUnableToVerify(message);
  const keyFinding = detectKeyFinding(message);

  const newAnswered: string[] = [];
  const newUnable: string[] = [];

  for (const topic of topics) {
    if (isUnableToVerify) {
      if (!entry.unableToVerifyKeys.has(topic)) {
        entry.unableToVerifyKeys.add(topic);
        newUnable.push(topic);
      }
    } else {
      if (!entry.answeredKeys.has(topic)) {
        entry.answeredKeys.add(topic);
        newAnswered.push(topic);
      }
    }
  }

  // If "already answered" but no specific topic detected, mark recent topics
  if (isAlreadyAnswered && topics.length === 0) {
    // The technician is saying "already answered" without specifying what
    // This is recorded but topics stay as-is
  }

  if (keyFinding && !entry.keyFindings.includes(keyFinding)) {
    entry.keyFindings.push(keyFinding);
  }

  return { newAnswered, newUnable, keyFinding, alreadyAnswered: isAlreadyAnswered };
}

/**
 * Build a context string injected into the diagnostic system prompt.
 * Tells the LLM which topics are closed and what key findings exist.
 */
export function buildRegistryContext(caseId: string): string {
  const entry = registry.get(caseId);
  if (!entry) return "";

  const parts: string[] = [];

  if (entry.answeredKeys.size > 0) {
    parts.push(
      `ALREADY ANSWERED (do NOT ask again): ${[...entry.answeredKeys].join(", ")}`
    );
  }

  if (entry.unableToVerifyKeys.size > 0) {
    parts.push(
      `UNABLE TO VERIFY (closed — skip these): ${[...entry.unableToVerifyKeys].join(", ")}`
    );
  }

  if (entry.keyFindings.length > 0) {
    parts.push(
      `KEY FINDINGS: ${entry.keyFindings.join("; ")}`
    );
  }

  if (parts.length === 0) return "";

  return `DIAGNOSTIC REGISTRY (current case state):\n${parts.join("\n")}\nDo NOT repeat questions about topics listed above. Move forward.`;
}

/**
 * Check whether the case should pivot immediately to isolation based on key findings.
 */
export function shouldPivot(caseId: string): { pivot: boolean; finding?: string } {
  const entry = registry.get(caseId);
  if (!entry || entry.keyFindings.length === 0) return { pivot: false };
  return { pivot: true, finding: entry.keyFindings[entry.keyFindings.length - 1] };
}

/**
 * Get the registry entry (for testing/debugging).
 */
export function getRegistryEntry(caseId: string): DiagnosticEntry | undefined {
  return registry.get(caseId);
}

/**
 * Clear registry for a case (for testing).
 */
export function clearRegistry(caseId: string): void {
  registry.delete(caseId);
}
