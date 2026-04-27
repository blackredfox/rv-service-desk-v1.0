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
  /**
   * Narrow line-level edit (e.g. "<item description>: <value> <unit>" or a
   * labor-line correction) rather than a total-labor TOTAL change. Used by
   * the chat route to prefer the REPORT REVISION path over the broad
   * LABOR TOTAL OVERRIDE path.
   */
  isLineEdit?: boolean;
};

const REPORT_TRIGGER_NOUN = "(?:report|репорт|reporte|informe|отч[её]т)";
const WARRANTY_TRIGGER = "(?:warranty|garant[ií]a|гарантийн\\S*|ворант\\S*|варрант\\S*)";
const RETAIL_TRIGGER = "(?:retail|customer[\\s-]*pay|рознич\\S*)";

const APPROVED_FINAL_REPORT_PATTERNS = [
  new RegExp(`(?:write|generate|prepare|make|create)\\s+(?:the\\s+)?(?:(?:final|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|service|repair)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:write|generate|prepare|make|create)\\s+(?:the\\s+)?(?:inspection|visual\\s+inspection|customer)\\s+${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:need|want)\\s+(?:a\\s+)?(?:(?:final|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|service|repair)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:inspection|visual\\s+inspection|customer)\\s+${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:напиши|сделай|сформируй|подготовь|сгенерируй)\\s+(?:(?:финальн(?:ый|ого)|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|сервисн(?:ый|ого)|ремонтн(?:ый|ого))\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`(?:напиши|сделай|сформируй|подготовь|сгенерируй)\\s+(?:(?:клиентск\\S*|инспекционн\\S*)\\s+)?${REPORT_TRIGGER_NOUN}[^\\n]{0,100}(?:инспекц|осмотр|перечислен\\S+\\s+проблем)`, "iu"),
  new RegExp(`(?:нужен|нужно|хочу)\\s+(?:(?:финальн\\S*|${WARRANTY_TRIGGER}|${RETAIL_TRIGGER}|сервисн\\S*|ремонтн\\S*)\\s+)?${REPORT_TRIGGER_NOUN}(?:$|[.!?;:,\\n\\s])`, "iu"),
  new RegExp(`${REPORT_TRIGGER_NOUN}[^\\n]{0,100}(?:итог|результат)[^\\n]{0,100}(?:инспекц|осмотр)`, "iu"),
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

/**
 * Matches a bare numeric value followed by a time unit in any supported
 * language (EN, RU, ES). Used as a cue for post-final labor-line edits.
 *
 * Notes:
 * - `[.,]\s*\d+` tolerates the routing-input normalizer which inserts a
 *   space after `.` / `,` (so "0.3" arrives as "0. 3").
 * - Trailing `(?!\p{L})` is a Unicode-safe word boundary — JS `\b` is
 *   ASCII-only and fails on Cyrillic (e.g. trailing "ч").
 */
const LABOR_LINE_VALUE_PATTERN =
  /\b\d+(?:[.,]\s*\d+)?\s*(?:ч\.|час(?:а|ов)?|ч|hrs?|hours?|hora|horas|minutos|minuto|min|минут(?:ы|а)?|мин|h)(?!\p{L})/iu;

const REPORT_REVISION_CUE_PATTERNS = [
  /\b(?:report|complaint|procedure|condition|action|parts?|labor|labour|hours?|hrs?|hr|total|wording|line|that|this|retail|warranty)\b/i,
  /(?:отч[её]т|жалоб|процедур|состояни|действ|детал|част|труд|час|итого|строк|это|retail|warranty)/iu,
  /\b(?:reporte|informe|queja|procedimiento|condici[oó]n|acci[oó]n|partes?|mano\s+de\s+obra|horas?|hr|total|texto|l[ií]nea|eso|esto|retail|warranty)\b/iu,
  // Post-final labor-line / time-value cue: a numeric value followed by a
  // time unit (e.g. "0.3 ч", "0.5 hr", "30 min") is a strong post-final edit
  // signal for narrow labor-line corrections that do not include any of the
  // broader lexical cues above. This aligns with the Case-58 anchor edit:
  //   "исправь - Замена предохранителя и проверка работы: 0.3 ч".
  LABOR_LINE_VALUE_PATTERN,
];

/**
 * Matches a line-item edit shape: "<description>: <numeric> <time-unit>".
 * Used to distinguish a narrow labor-LINE correction from a whole-report
 * labor-TOTAL override. Descriptions that are themselves "total"/"итого"
 * are excluded — those remain proper labor TOTAL changes.
 */
const LINE_ITEM_EDIT_PATTERN =
  /([^\n:]{2,}):\s*\d+(?:[.,]\s*\d+)?\s*(?:ч\.|час(?:а|ов)?|ч|hrs?|hours?|hora|horas|minutos|minuto|min|минут(?:ы|а)?|мин|h)(?!\p{L})/iu;

const LINE_ITEM_TOTAL_DESCRIPTION_PATTERN =
  /\b(?:total\s+labor|total\s+hours?|total\s+hrs?|total|итого(?:\s+труд\S*)?|итого(?:вый)?|mano\s+de\s+obra\s+total|horas?\s+totales)\s*$/i;

/**
 * Detect whether the message is a line-LEVEL labor-line edit (narrow edit),
 * as opposed to a whole-report labor-TOTAL override.
 *
 * Example line edit (Case-58 anchor):
 *   "исправь - Замена предохранителя и проверка работы: 0.3 ч"
 *
 * Example total override (NOT a line edit):
 *   "change Total labor: 2.0 hr"
 *   "измени итого на 1.5 ч"
 */
export function isPostFinalLineEdit(message: string): boolean {
  const match = LINE_ITEM_EDIT_PATTERN.exec(message);
  if (!match) return false;
  const description = match[1].trim();
  if (!description) return false;
  if (LINE_ITEM_TOTAL_DESCRIPTION_PATTERN.test(description)) return false;
  return true;
}

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
    isLineEdit: isPostFinalLineEdit(candidateMessage),
  };
}
