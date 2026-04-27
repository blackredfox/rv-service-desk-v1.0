export type InspectionReportIntentAssessment = {
  hasInspectionContext: boolean;
  hasInspectionFindings: boolean;
  hasReportRequest: boolean;
  readyForReportRouting: boolean;
};

const INSPECTION_CONTEXT_PATTERNS: RegExp[] = [
  /\b15\s*[- ]?point\s+visual\s+inspection\b/i,
  /\bvisual\s+inspection\b/i,
  /\binspection\s+(?:findings|report|summary)\b/i,
  /(?:инспекц|осмотр)[^\n]{0,80}(?:итог|результат|отч[её]т|проблем|дефект)/iu,
  /отч[её]т[^\n]{0,100}(?:инспекц|осмотр)/iu,
];

const INSPECTION_FINDING_PATTERNS: RegExp[] = [
  /\b(?:found|finding|findings|not\s+working|not\s+operational|cracked|expired|sagging|further\s+diagnostic|required|customer\s+approval|replacement\s+recommended)\b/i,
  /\b(?:cleaned\s+with\s+no\s+improvement|poor\/unclear\s+image|no\s+function)\b/i,
  /(?:проверил|наш[её]л|не\s+работает|нет\s+сигнала|нужн[ао]\s+доп\s+диаг|нужна\s+диагностик|трещин|замен[аы][^\n]{0,60}клиент|провисает|просроч|expired)/iu,
];

const REPORT_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:write|generate|prepare|make|create)\s+(?:a\s+|the\s+)?(?:customer\s+)?(?:inspection\s+)?report\b/i,
  /\b(?:inspection|customer)\s+report\b/i,
  /\breport\s+(?:for\s+the\s+)?customer\b/i,
  /(?:сделай|напиши|подготовь|сформируй|сгенерируй)\s+(?:клиентск\S+\s+)?отч[её]т/iu,
  /(?:просто\s+)?сделай\s+отч[её]т\s+для\s+клиента/iu,
  /отч[её]т\s+с\s+перечислен\S+\s+(?:этих\s+)?проблем/iu,
  /отч[её]т[^\n]{0,80}(?:итог|результат)[^\n]{0,80}(?:инспекц|осмотр)/iu,
];

function hasAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function assessInspectionReportIntent(args: {
  message: string;
  priorUserMessages?: string[];
  hasCurrentReportRequest?: boolean;
}): InspectionReportIntentAssessment {
  const prior = args.priorUserMessages ?? [];
  const transcript = [...prior, args.message].filter(Boolean).join("\n");
  const hasInspectionContext = hasAny(INSPECTION_CONTEXT_PATTERNS, transcript);
  const hasInspectionFindings = hasAny(INSPECTION_FINDING_PATTERNS, transcript);
  const hasReportRequest =
    Boolean(args.hasCurrentReportRequest) ||
    hasAny(REPORT_REQUEST_PATTERNS, args.message) ||
    hasAny(REPORT_REQUEST_PATTERNS, prior.slice(-4).join("\n"));

  return {
    hasInspectionContext,
    hasInspectionFindings,
    hasReportRequest,
    readyForReportRouting: hasInspectionContext && hasInspectionFindings && hasReportRequest,
  };
}

export function buildInspectionReportPromptConstraint(): string {
  return [
    "INSPECTION REPORT ROUTE (MANDATORY):",
    "- Treat this as a customer-facing visual inspection report, NOT unresolved fault-isolation diagnostics.",
    "- Build the report from transcript-grounded inspection findings only.",
    "- Preserve technician uncertainty exactly: use 'further diagnostic required' only where the technician stated it.",
    "- Preserve optional / customer-approval wording exactly where the technician stated replacement is optional or customer-approved.",
    "- Include inspection labor if the technician provided it.",
    "- Do NOT invent completed repairs, voltage values, leak tests, or unrelated safety checks.",
    "- Do NOT ask an LP/gas leak detector question unless the technician specifically requested LP diagnostics.",
  ].join("\n");
}