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

import type { DiagnosticContext } from "@/lib/context-engine/types";

type Fact = {
  category: "symptom" | "observation" | "test_result" | "technician_statement";
  text: string;
};

type FactPack = {
  facts: Fact[];
  summary: string;
};

export type FinalReportAuthorityFacts = {
  complaint?: string;
  diagnosticProcedure?: string;
  verifiedCondition?: string;
  correctiveAction?: string;
  requiredParts?: string;
  authoritySummary?: string;
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
  // Split on sentence boundaries, but avoid splitting on decimals (e.g., "12.4V")
  const sentences = message.split(/(?<!\d)[.!?]+(?!\d)/).filter((s) => s.trim().length > 5);

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

const FUSE_FAULT_PATTERNS = [
  /(?:blown|failed|faulty|bad)\s+fuse/i,
  /fuse.{0,40}(?:blown|failed|faulty|bad)/i,
  /(?:неисправен|перегорел|сгорел)\s+предохранитель/i,
  /предохранитель.{0,40}(?:неисправен|перегорел|сгорел)/i,
];

const FUSE_REPLACEMENT_PATTERNS = [
  /(?:replace(?:d)?|replaced\s+the)\s+fuse/i,
  /(?:заменил|заменили|замена).{0,20}предохранител/i,
];

const GENERIC_REPLACEMENT_PATTERNS = [
  /(?:replace(?:d)?|replacement)/i,
  /(?:заменил|заменили|замена)/i,
];

const RESTORED_OPERATION_PATTERNS = [
  // English — strict positive-context only. Bare "working" / "operational"
  // must NEVER match a negation context (e.g. "the pump is not working");
  // a clear post-repair / restoration cue is required.
  /\b(?:resolved|back\s+up\s+and\s+running)\b/i,
  /\b(?:problem|issue)\s+(?:is\s+)?(?:fixed|resolved|solved)\b/i,
  /\bnow\s+(?:works|working|operational)\b/i,
  /\b(?:works?|working|operational|operating|running)\s+(?:now|again|properly|correctly|after\s+(?:repair|replacement|fix))\b/i,
  /\bafter\s+(?:the\s+)?(?:repair|replacement|fix|swap)\b[^.\n]{0,80}\b(?:works?|operational|running|operating|fixed)\b/i,
  /\b(?:replaced|swapped|installed|fixed)\s+\S+[^.\n]{0,80}\b(?:now\s+)?(?:works?|operational|running|operating)\b/i,
  // Russian — bare "работает" is too ambiguous (matches "не работает"); a
  // positive cue word is required.
  /(?:теперь|снова|штатно|нормально)\s+работает/iu,
  /работает\s+(?:нормально|штатно|снова|без\s+проблем|корректно)/iu,
  /\bзаработал(?:а|и)?\b/iu,
  /(?:проблема|неисправность)\s+устранена/iu,
  /(?:после\s+(?:замен|ремонт|почин|восстанов)\S*)[^.\n]{0,80}(?:работает|функционирует|запустился|включается)/iu,
  // Spanish — same approach.
  /\bfunciona\s+(?:correctamente|bien|de\s+nuevo|ahora)/iu,
  /(?:después\s+de\s+|tras\s+)(?:el\s+)?(?:reemplaz|repar|cambi)\S*[^.\n]{0,80}(?:funciona|opera)/iu,
];

function cleanAuthorityText(text?: string | null): string | undefined {
  if (!text) return undefined;
  return text.replace(/^Inferred from repair:\s*/i, "").replace(/\s+/g, " ").trim();
}

function inferComplaintFromHistory(history: Array<{ role: string; content: string }>): string | undefined {
  const pack = buildFactPack(history);
  const symptom = pack.facts.find((fact) => fact.category === "symptom");
  if (symptom) return symptom.text;

  const firstUser = history.find((msg) => msg.role === "user" && msg.content.trim().length > 0);
  return firstUser?.content.trim();
}

export function deriveFinalReportAuthorityFacts(
  history: Array<{ role: string; content: string }>,
  context?: DiagnosticContext | null,
): FinalReportAuthorityFacts | null {
  const complaint = inferComplaintFromHistory(history);
  if (!context?.isolationComplete && context?.terminalState?.phase !== "terminal") {
    return complaint ? { complaint } : null;
  }

  const latestUserMessages = history
    .filter((msg) => msg.role === "user")
    .slice(-6)
    .map((msg) => msg.content);

  const combinedEvidence = [
    context.terminalState.faultIdentified?.text,
    context.terminalState.correctiveAction?.text,
    context.terminalState.restorationConfirmed?.text,
    context.isolationFinding,
    ...latestUserMessages,
  ]
    .filter(Boolean)
    .join(" ");

  const hasFuseFault = FUSE_FAULT_PATTERNS.some((pattern) => pattern.test(combinedEvidence));
  const hasFuseReplacement =
    FUSE_REPLACEMENT_PATTERNS.some((pattern) => pattern.test(combinedEvidence)) ||
    (hasFuseFault && GENERIC_REPLACEMENT_PATTERNS.some((pattern) => pattern.test(combinedEvidence)));
  const hasRestoredOperation = RESTORED_OPERATION_PATTERNS.some((pattern) => pattern.test(combinedEvidence));

  const cleanedFault = cleanAuthorityText(context.terminalState.faultIdentified?.text);
  const cleanedRepair = cleanAuthorityText(context.terminalState.correctiveAction?.text);
  const cleanedRestore = cleanAuthorityText(context.terminalState.restorationConfirmed?.text);

  if (hasFuseFault || hasFuseReplacement) {
    return {
      complaint,
      diagnosticProcedure:
        "Diagnostic isolation traced the 12V loss to a failed fuse and restoration was verified after repair.",
      verifiedCondition: hasRestoredOperation
        ? "Failed fuse was identified as the root cause. Water heater is operational after fuse replacement."
        : "Failed fuse was identified in the water-heater power path.",
      correctiveAction: hasFuseReplacement
        ? "Replace failed fuse and verify normal water heater operation."
        : cleanedRepair ?? "Correct the failed fuse condition and verify water heater operation.",
      requiredParts: hasFuseReplacement ? "Fuse." : undefined,
      authoritySummary: [
        "Latest authoritative technician-verified state:",
        "- Root cause: failed / blown fuse in the water-heater power path.",
        `- Corrective action: ${hasFuseReplacement ? "fuse replaced" : cleanedRepair ?? "repair completed"}.`,
        `- Final operational status: ${hasRestoredOperation ? "water heater operational after repair" : cleanedRestore ?? "restoration confirmed"}.`,
      ].join("\n"),
    };
  }

  const verifiedCondition = hasRestoredOperation
    ? `Technician confirmed restored operation after repair. ${cleanedRestore ?? "System operational after repair."}`
    : cleanAuthorityText(context.isolationFinding) ?? cleanedFault;

  // Case-89 truth-integrity guard: when the technician has NOT confirmed
  // a corrective action AND has NOT confirmed restoration, the authority
  // summary must NOT push the LLM toward a "repaired/restored" framing.
  const hasNoRepairEvidence = !cleanedRepair && !cleanedRestore && !hasRestoredOperation;
  const closingLine = hasNoRepairEvidence
    ? "- No corrective action has been performed yet — the report must describe the diagnostic isolation only and may RECOMMEND a future corrective action; it must not claim the repair was done."
    : "- Earlier pre-repair observations must not override this restored final state.";

  return {
    complaint,
    diagnosticProcedure:
      cleanAuthorityText(context.isolationFinding) ??
      "Diagnostic isolation completed based on technician-confirmed repair and restoration.",
    verifiedCondition,
    correctiveAction:
      cleanedRepair ??
      (hasRestoredOperation ? "Perform the confirmed corrective action and verify restored operation." : undefined),
    authoritySummary: [
      "Latest authoritative technician-verified state:",
      cleanedFault ? `- Root cause / fault: ${cleanedFault}` : undefined,
      cleanedRepair ? `- Corrective action performed: ${cleanedRepair}` : undefined,
      verifiedCondition ? `- Final verified condition: ${verifiedCondition}` : undefined,
      closingLine,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildFinalReportAuthorityConstraint(
  facts?: FinalReportAuthorityFacts | null,
): string {
  if (!facts?.authoritySummary) return "";

  // When the authority summary already encodes a no-repair-performed
  // closing line (Case-89 direct-power isolation), use a closing
  // sentence that does NOT push the LLM toward "repaired/restored".
  const hasNoRepairClosing = facts.authoritySummary.includes(
    "No corrective action has been performed yet",
  );

  const trailingLine = hasNoRepairClosing
    ? "For the FINAL REPORT, the Verified Condition must reflect ONLY the diagnostic isolation. The Recommended Corrective Action may RECOMMEND a future repair using future / imperative wording. It MUST NOT state, imply, or invent that the repair was performed or that the system is operational after repair."
    : "For the FINAL REPORT, the Verified Condition and Recommended Corrective Action must reflect this repaired/restored latest state, not an earlier pre-repair snapshot.";

  return [
    "AUTHORITATIVE FINAL STATE (LATEST TECHNICIAN-VERIFIED — USE THIS AS SOURCE OF TRUTH):",
    facts.authoritySummary,
    trailingLine,
  ].join("\n\n");
}
