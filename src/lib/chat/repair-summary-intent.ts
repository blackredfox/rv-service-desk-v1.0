import type { Language } from "@/lib/lang";

export type RepairSummaryMissingField =
  | "complaint"
  | "findings"
  | "corrective_action";

export type RepairSummaryIntentAssessment = {
  complaintInferredFromActiveContext: boolean;
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
  // Broader technician phrasing ("checked X", "проверил X", "revisé X")
  // — required so dense report-ready narratives (Cases 82–84) are
  // recognised as having findings even when the technician does not
  // type the literal words "found" / "inspection".
  /(?:checked|inspected|verified|tested|measured)\s+\S+/i,
  /(?:проверил(?:а)?|осмотрел(?:а)?|измерил(?:а)?|протестировал(?:а)?)\s+\S+/iu,
  /(?:revis[eé]|inspeccion[eé]|verifiqu[eé]|med[ií]|prob[eé])\s+\S+/iu,
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
  // Broader corrective-action phrasing ("replaced the pump", "заменил
  // насос") — required so dense reports about non-fuse/breaker parts
  // are recognised. Past-tense only; future-intent forms like
  // "надо менять" / "need to replace" are intentionally NOT matched.
  /(?:replaced|changed|swapped|installed|removed)\s+(?:the\s+|a\s+)?[a-zа-яё][a-zа-яё\s-]{1,40}/iu,
  /(?:заменил(?:а)?|поменял(?:а)?|снял(?:а)?|поставил(?:а)?)\s+\S+/iu,
  /(?:reemplaz[eé]|cambi[eé]|instal[eé]|quit[eé])\s+\S+/iu,
];

function dedupeMissingFields(fields: RepairSummaryMissingField[]): RepairSummaryMissingField[] {
  return Array.from(new Set(fields));
}

// ── Case-89: Transcript-derived repair-status assessment ────────────
//
// `assessTranscriptRepairStatus` answers two narrow truth-integrity
// questions about the transcript (technician messages only):
//
//   - `repairPerformed`     — did the technician explicitly state the
//                              repair / part-replacement was COMPLETED?
//                              (past tense; future intent like "требует
//                              замены" / "needs replacement" is NOT a
//                              completion statement.)
//   - `restorationConfirmed` — did the technician explicitly state the
//                              system is OPERATING after the repair?
//
// When either flag is `false`, the route's transcript-derived draft
// constraint adds explicit prohibitions so the LLM cannot invent
// "after replacement, operation was restored", "post-repair check
// passed", "system is operating", etc. (Case-89 P1 truth bug.)
//
// Authority contract:
//   - Server owns this assessment. The LLM does not.
//   - Future-intent / "requires replacement" wording is intentionally
//     NOT recognised as a completion. The recommended-correction
//     section may still recommend the future repair.
//
const REPAIR_PERFORMED_PATTERNS: RegExp[] = [
  // English — past-tense repair completion.
  /\b(?:replaced|swapped|installed|reinstalled|fixed|repaired|reseated|reconnected|rewired|tightened|sealed|cleaned|secured)\s+(?:the\s+|a\s+)?\S+/i,
  // Russian — past-tense repair completion.
  /(?:заменил(?:а|и)?|поменял(?:а|и)?|переустановил(?:а|и)?|установил(?:а|и)?|починил(?:а|и)?|отремонтировал(?:а|и)?|восстановил(?:а|и)?|подключил(?:а|и)?(?!\s+\d+\s*(?:в|вольт|волт))|подсоединил(?:а|и)?|закрепил(?:а|и)?)\s+\S+/iu,
  // Spanish — past-tense repair completion. Spanish orthography turns
  // `z` → `c` before `é` (e.g. reemplazar → reemplacé). Both spellings
  // appear in real transcripts.
  /(?:reemplaz[eé]|reemplac[eé]|cambi[eé]|instal[eé]|repar[eé]|arregl[eé]|reconect[eé])\s+\S+/iu,
];

const RESTORATION_CONFIRMED_PATTERNS: RegExp[] = [
  // English — explicit post-repair restoration.
  /\bafter\s+(?:the\s+)?(?:repair|replacement|fix|swap)\b[^.\n]{0,80}\b(?:works?|operational|running|operating|fixed)\b/i,
  /\b(?:works?|operational|running|operating|fixed)\b[^.\n]{0,80}\bafter\s+(?:the\s+)?(?:repair|replacement|fix|swap)\b/i,
  /\bnow\s+(?:works?|operational|running|operating)\b/i,
  /\b(?:works?|working|operational|operating|running)\s+(?:now|again|properly|correctly)\b/i,
  /\b(?:problem|issue)\s+(?:is\s+)?(?:fixed|resolved|solved)\b/i,
  /\bback\s+up\s+and\s+running\b/i,
  // Russian.
  /(?:после\s+(?:замен|ремонт|почин|восстанов)\S*)[^.\n]{0,80}(?:работает|функционирует|запустился|включается)/iu,
  /(?:работает|функционирует|запустился|включается)[^.\n]{0,80}(?:после\s+(?:замен|ремонт|почин|восстанов)\S*)/iu,
  /(?:теперь|снова|штатно|нормально)\s+работает/iu,
  /работает\s+(?:нормально|штатно|снова|без\s+проблем|корректно)/iu,
  /\bзаработал(?:а|и)?\b/iu,
  /(?:проблема|неисправность)\s+устранена/iu,
  // Spanish.
  /\bfunciona\s+(?:correctamente|bien|de\s+nuevo|ahora)/iu,
  /(?:después\s+de\s+|tras\s+)(?:el\s+|la\s+)?(?:reemplaz|repar|cambi)\S*[^.\n]{0,80}(?:funciona|opera)/iu,
  /(?:funciona|opera)[^.\n]{0,80}(?:después\s+de\s+|tras\s+)(?:el\s+|la\s+)?(?:reemplaz|repar|cambi)/iu,
];

const FUTURE_REPLACEMENT_INTENT_PATTERNS: RegExp[] = [
  // English future-intent — must NOT be treated as completed repair.
  /\b(?:needs?|requires?|will\s+(?:need|require)|going\s+to|gonna|to\s+be)\s+(?:replaced|replacement|swapped|fixed|repaired)\b/i,
  /\b(?:replacement|repair)\s+(?:is\s+)?(?:required|needed|necessary)\b/i,
  // Russian future-intent.
  /(?:требует(?:ся)?|нужн[аоы]?|надо|необходим\S*)\s+(?:замен\S*|ремонт\S*)/iu,
  // Spanish future-intent.
  /(?:requiere|necesita|hay\s+que)\s+(?:reemplaz\S*|cambi\S*|repar\S*)/iu,
];

export type TranscriptRepairStatus = {
  repairPerformed: boolean;
  restorationConfirmed: boolean;
};

/**
 * Assess whether the technician's transcript (user messages only) shows
 * a COMPLETED repair and a CONFIRMED post-repair restoration.
 *
 * Future-intent statements ("requires replacement", "требует замены") are
 * deliberately filtered out — they are recommendations, not completions.
 */
export function assessTranscriptRepairStatus(
  userMessages: string[],
): TranscriptRepairStatus {
  const text = userMessages.filter(Boolean).join("\n");
  if (text.trim().length === 0) {
    return { repairPerformed: false, restorationConfirmed: false };
  }

  // A sentence that establishes a completed repair must contain a
  // past-tense repair verb AND must NOT be the future-intent form
  // ("требует замены"). We split on sentence boundaries and require at
  // least one sentence that satisfies both constraints.
  const sentences = text
    .split(/(?<!\d)[.!?\n]+(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let repairPerformed = false;
  for (const sentence of sentences) {
    const isFutureIntent = FUTURE_REPLACEMENT_INTENT_PATTERNS.some((p) => p.test(sentence));
    if (isFutureIntent) continue;
    if (REPAIR_PERFORMED_PATTERNS.some((p) => p.test(sentence))) {
      repairPerformed = true;
      break;
    }
  }

  const restorationConfirmed = RESTORATION_CONFIRMED_PATTERNS.some((p) => p.test(text));

  return { repairPerformed, restorationConfirmed };
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
  const currentMessageHasRepairSignal =
    currentMessageHasComplaint || currentMessageHasFindings || currentMessageHasCorrectiveAction;
  const evidenceText = [
    ...(args.priorUserMessages ?? []),
    args.message,
  ]
    .filter(Boolean)
    .join("\n");

  const complaintInferredFromActiveContext =
    Boolean(args.hasActiveDiagnosticContext) &&
    args.hasReportRequest &&
    currentMessageHasRepairSignal;

  const hasComplaint =
    COMPLAINT_PATTERNS.some((pattern) => pattern.test(evidenceText)) ||
    complaintInferredFromActiveContext;
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
    complaintInferredFromActiveContext,
    currentMessageHasComplaint,
    currentMessageHasFindings,
    currentMessageHasCorrectiveAction,
    currentMessageHasRepairSignal,
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
