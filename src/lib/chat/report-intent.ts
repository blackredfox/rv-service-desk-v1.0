/**
 * Deterministic approved final-report intent detection.
 *
 * Responsibility: detect only allow-listed natural report requests.
 * Does NOT own: readiness, mode transitions, or diagnostic flow.
 */

export type ApprovedFinalReportIntent = {
  matched: boolean;
  matchedText?: string;
};

const APPROVED_FINAL_REPORT_PATTERNS = [
  /(?:^|[.!?;:,\n]\s*)(write|generate)\s+(?:the\s+)?(?:(final|warranty)\s+)?report(?:$|[.!?;:,\n])/iu,
  /(?:^|[.!?;:,\n]\s*)(?:напиши|сделай)\s+(?:(?:финальн(?:ый|ого)|warranty)\s+)?(?:отч[её]т|report)(?:$|[.!?;:,\n])/iu,
  /(?:^|[.!?;:,\n]\s*)(?:genera|haz|escribe)\s+(?:el\s+)?(?:reporte|informe)(?:\s+final)?(?:$|[.!?;:,\n])/iu,
];

function normalizeMatchedText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ");
}

export function detectApprovedFinalReportIntent(message: string): ApprovedFinalReportIntent {
  const candidateMessage = message.trim();

  for (const pattern of APPROVED_FINAL_REPORT_PATTERNS) {
    const match = candidateMessage.match(pattern);
    if (match?.[0]) {
      return {
        matched: true,
        matchedText: normalizeMatchedText(match[0]),
      };
    }
  }

  return { matched: false };
}
