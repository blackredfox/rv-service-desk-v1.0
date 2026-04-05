/**
 * Deterministic approved final-report intent detection.
 *
 * Responsibility: detect only allow-listed natural report requests.
 * Does NOT own: readiness, mode transitions, or diagnostic flow.
 */

export type ApprovedFinalReportIntent = {
  matched: boolean;
  matchedText?: string;
  reportKind?: ReportKind;
};

export type ReportKind = "generic" | "warranty" | "retail";

export type ReportRevisionIntent = {
  matched: boolean;
  matchedText?: string;
  reportKind?: ReportKind;
};

const APPROVED_FINAL_REPORT_PATTERNS = [
  /(?:write|generate|prepare|make|create)\s+(?:the\s+)?(?:(?:final|warranty|retail|service|repair)\s+)?report(?:$|[.!?;:,\n\s])/iu,
  /(?:напиши|сделай|сформируй|подготовь|сгенерируй)\s+(?:(?:финальн(?:ый|ого)|гарантийн(?:ый|ого)|warranty|retail|сервисн(?:ый|ого)|ремонтн(?:ый|ого))\s+)?(?:отч[её]т|report)(?:$|[.!?;:,\n\s])/iu,
  /(?:haz|genera|prepara|escribe|crea)\s+(?:el\s+)?(?:(?:warranty|retail|final|de\s+servicio|de\s+reparaci[oó]n)\s+)?(?:reporte|informe|report)(?:$|[.!?;:,\n\s])/iu,
  /(?:haz|genera|prepara|escribe|crea)\s+(?:el\s+)?(?:reporte|informe)\s+(?:final|warranty|retail)(?:$|[.!?;:,\n\s])/iu,
];

const REPORT_REVISION_ACTION_PATTERNS = [
  /\b(?:remove|delete|drop|omit|add|include|change|rewrite|reword|revise|update|edit|fix|make\s+it)\b/i,
  /(?:убери|удали|добавь|измени|перепиши|исправь|обнови|сделай)(?:$|[.!?;:,\n\s])/iu,
  /(?:quita|elimina|agrega|a[ñn]ade|cambia|reescribe|edita|actualiza|hazlo)\b/iu,
];

const REPORT_REVISION_CUE_PATTERNS = [
  /\b(?:report|complaint|procedure|condition|action|parts?|labor|labour|hours?|hrs?|hr|total|wording|line|that|this|retail|warranty)\b/i,
  /(?:отч[её]т|жалоб|процедур|состояни|действ|детал|част|труд|час|итого|строк|это|retail|warranty)/iu,
  /\b(?:reporte|informe|queja|procedimiento|condici[oó]n|acci[oó]n|partes?|mano\s+de\s+obra|horas?|hr|total|texto|l[ií]nea|eso|esto|retail|warranty)\b/iu,
];

const REPORT_KIND_PATTERNS: Record<Exclude<ReportKind, "generic">, RegExp[]> = {
  warranty: [
    /\bwarranty\b/i,
    /garant[ií]a/iu,
    /гарантийн/iu,
  ],
  retail: [
    /\bretail\b/i,
    /customer[\s-]*pay/i,
    /рознич/iu,
  ],
};

function normalizeMatchedText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ");
}

function inferReportKind(message: string): ReportKind | undefined {
  if (REPORT_KIND_PATTERNS.warranty.some((pattern) => pattern.test(message))) {
    return "warranty";
  }

  if (REPORT_KIND_PATTERNS.retail.some((pattern) => pattern.test(message))) {
    return "retail";
  }

  return undefined;
}

function findMatchedText(message: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[0]) {
      return match[0];
    }
  }

  return undefined;
}

export function detectApprovedFinalReportIntent(message: string): ApprovedFinalReportIntent {
  const candidateMessage = message.trim();
  const matchedText = findMatchedText(candidateMessage, APPROVED_FINAL_REPORT_PATTERNS);

  if (matchedText) {
    return {
      matched: true,
      matchedText: normalizeMatchedText(matchedText),
      reportKind: inferReportKind(candidateMessage),
    };
  }

  return { matched: false };
}

export function detectReportRevisionIntent(args: {
  message: string;
  hasExistingReport: boolean;
}): ReportRevisionIntent {
  if (!args.hasExistingReport) {
    return { matched: false };
  }

  const candidateMessage = args.message.trim();
  const hasAction = REPORT_REVISION_ACTION_PATTERNS.some((pattern) => pattern.test(candidateMessage));
  const reportKind = inferReportKind(candidateMessage);
  const hasCue =
    Boolean(reportKind) ||
    REPORT_REVISION_CUE_PATTERNS.some((pattern) => pattern.test(candidateMessage));

  if (!hasAction || !hasCue) {
    return { matched: false };
  }

  return {
    matched: true,
    matchedText: normalizeMatchedText(candidateMessage),
    reportKind,
  };
}
