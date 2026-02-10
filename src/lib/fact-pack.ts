/**
 * Fact Pack Builder — extracts ONLY verified facts from conversation history.
 *
 * The fact pack is injected into the final report prompt to prevent the LLM
 * from inventing symptoms, conditions, or test results not stated by the technician.
 *
 * Rules:
 * - Only technician messages (role: "user") are scanned
 * - Only explicit statements are included (no inferences)
 * - Categories: reported symptoms, confirmed observations, test results
 * - If something was not verified, it MUST be described as "not verified"
 */

type Fact = {
  category: "symptom" | "observation" | "test_result" | "technician_statement";
  text: string;
};

type FactPack = {
  facts: Fact[];
  summary: string;
};

// Patterns that indicate test results with measurements
const TEST_RESULT_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(?:v|volts?|vdc|vac)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:a|amps?|ma)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:ohms?|Ω|kohm|megohm)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:psi|bar|kpa)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:°?[fc]|degrees?)\b/i,
];

// Patterns that indicate observations
const OBSERVATION_PATTERNS = [
  /(?:i\s+)?(?:see|saw|notice|noticed|found|hear|heard|smell|smelled|feel|felt)\s+(.+)/i,
  /(?:there\s+(?:is|are|was|were))\s+(.+)/i,
  /(?:it\s+(?:looks|sounds|smells|feels))\s+(.+)/i,
  /(?:visible|visibly)\s+(.+)/i,
  /вижу|заметил|обнаружил|слышу|слышал|чувствую/i,
  /hay|veo|noto|huelo|escucho/i,
];

// Patterns that indicate symptoms / initial complaint
const SYMPTOM_PATTERNS = [
  /(?:not|no|doesn'?t|don'?t|won'?t|isn'?t)\s+(?:work|run|start|cool|heat|operate|function|respond|pump|blow|spin|turn)/i,
  /(?:stopped|quit|dead|won'?t\s+(?:start|run|work|turn))/i,
  /не\s+(?:работает|включается|запускается|охлаждает|греет)/i,
  /no\s+(?:funciona|enciende|arranca|enfría|calienta)/i,
];

/**
 * Extract verified facts from a single user message.
 */
function extractFacts(message: string): Fact[] {
  const facts: Fact[] = [];
  const sentences = message.split(/[.!?]+/).filter((s) => s.trim().length > 5);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    // Check for test results (highest priority — most specific)
    if (TEST_RESULT_PATTERNS.some((p) => p.test(trimmed))) {
      facts.push({ category: "test_result", text: trimmed });
      continue;
    }

    // Check for observations
    if (OBSERVATION_PATTERNS.some((p) => p.test(trimmed))) {
      facts.push({ category: "observation", text: trimmed });
      continue;
    }

    // Check for symptoms
    if (SYMPTOM_PATTERNS.some((p) => p.test(trimmed))) {
      facts.push({ category: "symptom", text: trimmed });
      continue;
    }

    // Generic technician statements that contain useful info
    if (trimmed.length > 15 && !/^\s*(?:ok|yes|no|confirm|thank|hi|hello)\b/i.test(trimmed)) {
      facts.push({ category: "technician_statement", text: trimmed });
    }
  }

  return facts;
}

/**
 * Build a fact pack from conversation history.
 * Only scans user (technician) messages.
 *
 * @param history - Array of { role, content } messages
 * @returns FactPack with categorized facts and a summary string
 */
export function buildFactPack(
  history: Array<{ role: string; content: string }>
): FactPack {
  const allFacts: Fact[] = [];

  for (const msg of history) {
    if (msg.role !== "user") continue;
    const facts = extractFacts(msg.content);
    allFacts.push(...facts);
  }

  // Deduplicate similar facts (by normalized text)
  const seen = new Set<string>();
  const unique = allFacts.filter((f) => {
    const key = f.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build summary string for prompt injection
  const symptoms = unique.filter((f) => f.category === "symptom").map((f) => `- ${f.text}`);
  const observations = unique.filter((f) => f.category === "observation").map((f) => `- ${f.text}`);
  const testResults = unique.filter((f) => f.category === "test_result").map((f) => `- ${f.text}`);
  const statements = unique.filter((f) => f.category === "technician_statement").map((f) => `- ${f.text}`);

  const sections: string[] = [];

  if (symptoms.length > 0) {
    sections.push(`Reported symptoms:\n${symptoms.join("\n")}`);
  }
  if (observations.length > 0) {
    sections.push(`Confirmed observations:\n${observations.join("\n")}`);
  }
  if (testResults.length > 0) {
    sections.push(`Test results:\n${testResults.join("\n")}`);
  }
  if (statements.length > 0) {
    sections.push(`Other technician statements:\n${statements.join("\n")}`);
  }

  const summary = sections.length > 0
    ? sections.join("\n\n")
    : "No specific facts extracted from conversation.";

  return { facts: unique, summary };
}

/**
 * Build a fact-lock constraint string for injection into the final report prompt.
 * This tells the LLM exactly what facts are available and prohibits invention.
 */
export function buildFactLockConstraint(
  history: Array<{ role: string; content: string }>
): string {
  const pack = buildFactPack(history);

  return `FACT LOCK (MANDATORY — DO NOT VIOLATE):
The following facts were explicitly stated or confirmed by the technician during diagnostics.
Your report MUST use ONLY these facts. Do NOT add, infer, or assume any symptoms,
observations, measurements, or conditions not listed below.

${pack.summary}

RULES:
- If a symptom was NOT reported by the technician, do NOT mention it.
- If a measurement was NOT stated, do NOT invent one.
- If a condition was NOT verified, describe it as "not verified" or omit it.
- Do NOT add "intermittent operation", "no heat", or any other symptom unless the technician explicitly stated it.
- Every fact in your report must trace back to the list above.`;
}
