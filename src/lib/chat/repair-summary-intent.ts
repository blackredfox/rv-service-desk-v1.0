import type { Language } from "@/lib/lang";

export type RepairSummaryMissingField =
  | "complaint"
  | "findings"
  | "corrective_action";

export type RepairSummaryIntentAssessment = {
  currentMessageHasComplaint: boolean;
  currentMessageHasFindings: boolean;
  currentMessageHasCorrectiveAction: boolean;
  currentMessageHasRepairSignal: boolean;
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
  /(?:water\s+heater|heater|boiler)\s+(?:not\s+working|inoperative|not\s+heating)/i,
  /(?:водонагревател|бойлер)\S*\s+(?:не\s+работ|не\s+гре)/iu,
  /(?:calentador|boiler)\s+(?:no\s+funciona|no\s+calienta)/iu,
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
  /(?:i\s+found|found\s+that|the\s+fuse\s+was\s+(?:open|bad|blown|failed))/i,
  /(?:я\s+наш[её]л|предохранител\S*\s+(?:не\s+работал|неисправ|перегорел|сгорел))/iu,
  /(?:encontr[eé]|hall[eé]|el\s+fusible\s+estaba\s+(?:abierto|dañado|quemado))/iu,
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
  /(?:replaced|changed|swapped)\s+(?:the\s+)?(?:fuse|breaker|part)/i,
  /(?:replaced|changed|swapped|fixed)\s+(?:it|that)/i,
  /(?:заменил|поменял)\s+(?:предохранител|детал|узел)/iu,
  /(?:reemplaz[eé]|cambi[eé])\s+(?:el\s+)?(?:fusible|componente|pieza)/iu,
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
  priorUserMessages?: string[];
  hasActiveDiagnosticContext?: boolean;
}): RepairSummaryIntentAssessment {
  const currentMessageHasComplaint = COMPLAINT_PATTERNS.some((pattern) => pattern.test(args.message));
  const currentMessageHasFindings = FINDING_PATTERNS.some((pattern) => pattern.test(args.message));
  const currentMessageHasCorrectiveAction = CORRECTIVE_ACTION_PATTERNS.some((pattern) => pattern.test(args.message));
  const evidenceText = [
    ...(args.priorUserMessages ?? []),
    args.message,
  ]
    .filter(Boolean)
    .join("\n");

  const hasComplaint =
    COMPLAINT_PATTERNS.some((pattern) => pattern.test(evidenceText)) ||
    Boolean(args.hasActiveDiagnosticContext);
  const hasFindings = FINDING_PATTERNS.some((pattern) => pattern.test(evidenceText));
  const hasCorrectiveAction = CORRECTIVE_ACTION_PATTERNS.some((pattern) => pattern.test(evidenceText));

  const summarySignalCount = [hasComplaint, hasFindings, hasCorrectiveAction].filter(Boolean).length;
  const hasStructuredSummarySignals = summarySignalCount >= 2;

  const missingFields = dedupeMissingFields([
    ...(hasComplaint ? [] : ["complaint" as const]),
    ...(hasFindings ? [] : ["findings" as const]),
    ...(hasCorrectiveAction ? [] : ["corrective_action" as const]),
  ]);

  const readyForReportRouting = args.hasReportRequest && hasComplaint && hasFindings && hasCorrectiveAction;
  const shouldAskClarification = args.hasReportRequest && !readyForReportRouting;

  return {
    currentMessageHasComplaint,
    currentMessageHasFindings,
    currentMessageHasCorrectiveAction,
    currentMessageHasRepairSignal:
      currentMessageHasComplaint || currentMessageHasFindings || currentMessageHasCorrectiveAction,
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
      return `Чтобы сформировать отчёт сейчас, мне нужны только недостающие данные: подтвердите ${fieldsText}?`;
    case "ES":
      return `Para generar el informe ahora, solo me faltan estos datos: ¿puedes confirmar ${fieldsText}?`;
    default:
      return `To generate the report now, I only need the missing report details: can you confirm ${fieldsText}?`;
  }
}
