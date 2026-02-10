/**
 * Labor Store — module-level storage for confirmed labor hours.
 *
 * Keyed by caseId. The confirmed value is the single source of truth
 * for the labor budget used in the final report breakdown.
 *
 * Also stores the initial estimate so we can detect confirmation vs override.
 */

type LaborEntry = {
  estimatedHours: number;
  confirmedHours: number;
  confirmedAt: string;
};

const store = new Map<string, LaborEntry>();

export function setLaborEstimate(caseId: string, estimatedHours: number): void {
  const existing = store.get(caseId);
  store.set(caseId, {
    estimatedHours,
    confirmedHours: existing?.confirmedHours ?? 0,
    confirmedAt: existing?.confirmedAt ?? "",
  });
}

export function confirmLabor(caseId: string, confirmedHours: number): void {
  const existing = store.get(caseId);
  store.set(caseId, {
    estimatedHours: existing?.estimatedHours ?? confirmedHours,
    confirmedHours,
    confirmedAt: new Date().toISOString(),
  });
}

export function getLaborEntry(caseId: string): LaborEntry | undefined {
  return store.get(caseId);
}

export function getConfirmedHours(caseId: string): number | undefined {
  return store.get(caseId)?.confirmedHours || undefined;
}

/**
 * Parse the LLM's labor confirmation response and extract the estimated hours.
 * Looks for patterns like "Estimated total labor: 1.5 hours"
 */
export function extractLaborEstimate(response: string): number | null {
  // Try specific "Estimated total labor: X.X hours" pattern first
  const specificMatch = response.match(
    /estimated\s+total\s+labor[:\s]+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i
  );
  if (specificMatch) return parseFloat(specificMatch[1]);

  // Try "total labor: X.X hr" pattern
  const totalMatch = response.match(
    /total\s+labor[:\s]+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i
  );
  if (totalMatch) return parseFloat(totalMatch[1]);

  // Try generic "X.X hours" near "labor" or "estimate"
  const genericMatch = response.match(
    /(?:labor|estimate)[^.]*?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i
  );
  if (genericMatch) return parseFloat(genericMatch[1]);

  return null;
}

/**
 * Parse the technician's response to a labor confirmation prompt.
 *
 * - If a number is found → that's the override
 * - If no number → treat as confirmation of the current estimate
 *
 * @returns confirmed hours, or null if neither could be resolved
 */
export function parseLaborConfirmation(
  userMessage: string,
  currentEstimate?: number
): number | null {
  const msg = userMessage.trim();

  // Try to extract a number with unit (handles: "2.5 hours", "2.5h", "2.5hr", "2.5hrs")
  const withUnit = msg.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h\b|ч|час)/i);
  if (withUnit) return parseFloat(withUnit[1]);

  // Try just a standalone number (e.g. "2.5" or "1.5" or "2")
  const standalone = msg.match(/^[\s]*(\d+(?:\.\d+)?)[\s]*$/);
  if (standalone) return parseFloat(standalone[1]);

  // Try a number embedded in the message (e.g. "make it 2 hours")
  const embedded = msg.match(/(\d+(?:\.\d+)?)/);
  if (embedded) {
    const val = parseFloat(embedded[1]);
    // Only accept if it's a reasonable labor value (0.5 - 20)
    if (val >= 0.5 && val <= 20) return val;
  }

  // No number found → confirmation keywords
  const confirmPatterns =
    /\b(confirm|ok|yes|да|подтвер|sí|si|confirmo|good|agree|accept|fine|correct|right|approve)\b/i;
  if (confirmPatterns.test(msg) && currentEstimate) {
    return currentEstimate;
  }

  // Fallback: if there's a current estimate and message is very short, treat as confirmation
  if (currentEstimate && msg.length < 30) {
    return currentEstimate;
  }

  return null;
}

/**
 * Validate that a labor breakdown in a final report sums to the confirmed total.
 *
 * @returns `{ valid, computedSum, violations }`
 */
export function validateLaborSum(
  reportText: string,
  confirmedTotal: number
): { valid: boolean; computedSum: number; violations: string[] } {
  const violations: string[] = [];

  // Extract individual labor steps: "task description - X.X hr"
  const stepPattern = /[-–]\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)/gi;
  const steps: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = stepPattern.exec(reportText)) !== null) {
    steps.push(parseFloat(match[1]));
  }

  // Extract the stated total: "Total labor: X.X hr"
  const totalMatch = reportText.match(
    /total\s+labor[:\s]+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)/i
  );
  const statedTotal = totalMatch ? parseFloat(totalMatch[1]) : null;

  const computedSum = steps.reduce((a, b) => a + b, 0);
  const roundedSum = Math.round(computedSum * 10) / 10;

  // Check stated total matches confirmed total
  if (statedTotal !== null && Math.abs(statedTotal - confirmedTotal) > 0.05) {
    violations.push(
      `LABOR_TOTAL_MISMATCH: Stated total (${statedTotal} hr) does not match confirmed total (${confirmedTotal} hr)`
    );
  }

  // Check sum of steps matches confirmed total (with tolerance)
  if (steps.length > 0 && Math.abs(roundedSum - confirmedTotal) > 0.05) {
    violations.push(
      `LABOR_SUM_DRIFT: Step breakdown sums to ${roundedSum} hr but confirmed total is ${confirmedTotal} hr`
    );
  }

  return {
    valid: violations.length === 0,
    computedSum: roundedSum,
    violations,
  };
}
