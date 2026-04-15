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
  requestedSurface?: RequestedFinalOutputSurface;
};

export type ReportKind = "generic" | "warranty" | "retail";
export type RequestedFinalOutputSurface = "shop_final_report" | "portal_cause";

export type ReportRevisionIntent = {
  matched: boolean;
  matchedText?: string;
  reportKind?: ReportKind;
  requestedSurface?: RequestedFinalOutputSurface;
};

const REPORT_TRIGGER_NOUN = "(?:report|репорт|reporte|informe|отч[её]т)";
const WARRANTY_TRIGGER = "(?:warranty|garant[ií]a|гарантийн\\S*|ворант\\S*|варрант\\S*)";
const RETAIL_TRIGGER = "(?:retail|customer[\\s-]*pay|рознич\\S*)";

const APPROVED_FINAL_REPORT_PATTERNS = [
  new RegExp(`(?:write|generate|prepare|make|create)\\s+(?:the\\s+)?(?:(?:final|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|service|repair)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:need|want)\\s+(?:a\\s+)?(?:(?:final|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|service|repair)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:напиши|сделай|сформируй|подготовь|сгенерируй)\\s+(?:(?:финальн(?:ый|ого)|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|сервисн(?:ый|ого)|ремонтн(?:ый|ого))\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:нужен|нужно|хочу)\\s+(?:(?:финальн\\S*|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|сервисн\\S*|ремонтн\\S*)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:haz|genera|prepara|escribe|crea)\\s+(?:el\\s+)?(?:(?:${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|final|de\\s+servicio|de\\s+reparaci[oó]n)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:quiero|necesito)\\s+(?:un\\s+)?(?:(?:${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|final|de\\s+servicio|de\\s+reparaci[oó]n)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:haz|genera|prepara|escribe|crea)\\s+(?:el\\s+)?(?:reporte|informe|report)\\s+(?:final|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER})(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`${WARRANTY_TRIGGER}\\s+${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`${RETAIL_TRIGGER}\\s+${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
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
    /ворант/iu,
    /варрант/iu,
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
      requestedSurface: "shop_final_report",
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
    requestedSurface: "shop_final_report",
  };
}
