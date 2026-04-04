import type { Language } from "@/lib/lang";

export type RepairSummaryMissingField =
  | "complaint"
  | "findings"
  | "corrective_action";

export type RepairSummaryIntentAssessment = {
  hasComplaint: boolean;
  hasFindings: boolean;
  hasCorrectiveAction: boolean;
  hasStructuredSummarySignals: boolean;
  missingFields: RepairSummaryMissingField[];
  readyForReportRouting: boolean;
  shouldAskClarification: boolean;
};

const COMPLAINT_PATTERNS = [
  /(?:complaint|issue|problem|customer states?)\s*[:\-]/i,
  /(?:queja|problema)\s*[:\-]/iu,
  /(?:жалоб|проблема|неисправност)\s*[:\-]?/iu,
  /slide(?:[\s-]*out| room)?/i,
  /(?:water\s+l(?:ea|ee)k(?:ing)?|leak(?:ing)?\s+into)/i,
  /(?:not\s+attached|loose|detached)/i,
  /(?:filtraci[oó]n\s+de\s+agua|entra\s+agua)/iu,
  /(?:протечк|утечк).*вод/iu,
  /(?:не\s+закрепл|болтаетс)/iu,
];

const FINDING_PATTERNS = [
  /(?:finding|findings|found|inspection)\s*[:\-]/i,
  /(?:hallazgo|hallazgos|encontr[ée])\s*[:\-]?/iu,
  /(?:найдено|обнаружено|осмотр)\s*[:\-]?/iu,
  /only\s+\d+\s+screws?/i,
  /no\s+(?:silicone|sealant)/i,
  /только\s+\d+\s+(?:саморез|шуруп)/iu,
  /(?:нет|без)\s+(?:силикон|герметик)/iu,
  /solo\s+\d+\s+tornillos?/iu,
  /sin\s+(?:silicona|sellador)/iu,
];

const CORRECTIVE_ACTION_PATTERNS = [
  /(?:repair|repaired|fix(?:ed)?|corrective\s+action|action\s+taken)\s*[:\-]/i,
  /(?:reparaci[oó]n|acci[oó]n\s+correctiva|reparado)\s*[:\-]?/iu,
  /(?:ремонт|исправлено|выполнено)\s*[:\-]?/iu,
  /(?:added|installed|secured|reattached)\b/i,
  /appl(?:y|ied)\s+(?:silicone|sealant)/i,
  /(?:добавил|установил|закрепил|прикрутил|нан[её]с)/iu,
  /(?:agregu[eé]|instal[eé]|asegur[eé]|apliqu[eé]|sell[eé])/iu,
];

function dedupeMissingFields(fields: RepairSummaryMissingField[]): RepairSummaryMissingField[] {
  return Array.from(new Set(fields));
}

export function assessRepairSummaryIntent(args: {
  message: string;
  hasReportRequest: boolean;
}): RepairSummaryIntentAssessment {
  const hasComplaint = COMPLAINT_PATTERNS.some((pattern) => pattern.test(args.message));
  const hasFindings = FINDING_PATTERNS.some((pattern) => pattern.test(args.message));
  const hasCorrectiveAction = CORRECTIVE_ACTION_PATTERNS.some((pattern) => pattern.test(args.message));

  const summarySignalCount = [hasComplaint, hasFindings, hasCorrectiveAction].filter(Boolean).length;
  const hasStructuredSummarySignals = summarySignalCount >= 2;

  const missingFields = dedupeMissingFields([
    ...(hasComplaint ? [] : ["complaint" as const]),
    ...(hasFindings ? [] : ["findings" as const]),
    ...(hasCorrectiveAction ? [] : ["corrective_action" as const]),
  ]);

  const readyForReportRouting = args.hasReportRequest && hasComplaint && hasFindings && hasCorrectiveAction;
  const shouldAskClarification =
    !readyForReportRouting &&
    args.hasReportRequest &&
    hasStructuredSummarySignals;

  return {
    hasComplaint,
    hasFindings,
    hasCorrectiveAction,
    hasStructuredSummarySignals,
    missingFields,
    readyForReportRouting,
    shouldAskClarification,
  };
}

function joinMissingFields(language: Language, fields: RepairSummaryMissingField[]): string {
  if (language === "RU") {
    const labels: Record<RepairSummaryMissingField, string> = {
      complaint: "исходную жалобу",
      findings: "что именно было обнаружено",
      corrective_action: "какой ремонт был фактически выполнен",
    };
    return fields.map((field) => labels[field]).join(", ");
  }

  if (language === "ES") {
    const labels: Record<RepairSummaryMissingField, string> = {
      complaint: "la queja original",
      findings: "qué encontraste exactamente",
      corrective_action: "qué reparación completaste exactamente",
    };
    return fields.map((field) => labels[field]).join(", ");
  }

  const labels: Record<RepairSummaryMissingField, string> = {
    complaint: "the original complaint",
    findings: "what you found",
    corrective_action: "what repair you completed",
  };
  return fields.map((field) => labels[field]).join(", ");
}

export function buildRepairSummaryClarificationResponse(args: {
  language: Language;
  missingFields: RepairSummaryMissingField[];
}): string {
  const fieldsText = joinMissingFields(args.language, args.missingFields);

  switch (args.language) {
    case "RU":
      return `Прежде чем я направлю это в отчёт, мне нужно одно уточнение: подтвердите ${fieldsText}?`;
    case "ES":
      return `Antes de pasar esto al informe, necesito una sola aclaración: ¿puedes confirmar ${fieldsText}?`;
    default:
      return `Before I route this to the report path, I need one clarification: can you confirm ${fieldsText}?`;
  }
}
