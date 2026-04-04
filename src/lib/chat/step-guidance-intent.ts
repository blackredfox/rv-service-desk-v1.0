/**
 * Deterministic current-step guidance intent classification.
 *
 * Responsibility: classify bounded guidance requests only.
 * Does NOT own: step progression, mode transitions, or evidence handling.
 */

export type StepGuidanceIntentCategory =
  | "HOW_TO_CHECK"
  | "LOCATE_COMPONENT"
  | "IDENTIFY_POINT"
  | "ALTERNATE_CHECK_POINT";

type StepGuidanceIntentResult = {
  category: StepGuidanceIntentCategory;
};

const HOW_TO_CHECK_PATTERNS = [
  /how\s+(?:do\s+i|to|can\s+i|should\s+i)\s+(?:check|test|measure|verify|inspect|probe)/i,
  /(?:explain|show|tell)\s+(?:me\s+)?how/i,
  /как\s+(?:мне\s+)?(?:проверить|измерить|прозвонить|тестировать|сделать)/iu,
  /(?:c[oó]mo|como)\s+(?:puedo\s+)?(?:verificar|verifico|comprobar|compruebo|medir|mido|probar|pruebo|revisar|reviso|hacer|hago)/iu,
];

const LOCATE_COMPONENT_PATTERNS = [
  /where\s+(?:is|are|do\s+i\s+find|can\s+i\s+find|would\s+i\s+find)/i,
  /where'?s\s+(?:the\s+)?/i,
  /location\s+of/i,
  /где\s+(?:находится|находятся|искать|найти)/iu,
  /(?:d[oó]nde|donde)\s+(?:est[aá]|est[aá]n|queda|quedan|encuentro|busco|puedo\s+encontrar)/iu,
  /ubicaci[oó]n\s+de/iu,
];

const IDENTIFY_POINT_PATTERNS = [
  /how\s+(?:do\s+i|can\s+i)\s+find/i,
  /which\s+(?:wire|terminal|connector|pin|lead|side|input|point)/i,
  /(?:identify|find)\s+(?:the\s+)?(?:correct\s+)?(?:wire|terminal|connector|pin|input|b\+)/i,
  /как\s+(?:найти|определить)/iu,
  /како(?:й|е|го)\s+(?:провод|контакт|разъ[её]м|клемм|вывод|вход)/iu,
  /(?:c[oó]mo|como)\s+(?:identifico|ubico|encuentro)/iu,
  /qu[eé]\s+(?:cable|terminal|conector|pin|lado|entrada)/iu,
];

const ALTERNATE_CHECK_POINT_PATTERNS = [
  /(?:another|other|alternate|alternative)\s+(?:point|place|location|terminal|wire|connector)/i,
  /can\s+i\s+(?:check|measure|probe|test)\s+(?:it\s+)?(?:at|from)/i,
  /instead\s+of\s+(?:that|there|this\s+point)/i,
  /друг(?:ая|ой|ую)\s+(?:точк|мест)/iu,
  /можно\s+(?:проверить|измерить|прозвонить)\s+(?:на|в|с)/iu,
  /вместо\s+(?:этого|этой\s+точки)/iu,
  /otro\s+(?:punto|lugar|terminal|conector)/iu,
  /puedo\s+(?:verificar|comprobar|medir|probar)\s+(?:en|desde)/iu,
  /en\s+lugar\s+de\s+(?:eso|ese\s+punto|all[ií])/iu,
];

const GENERIC_REFERENCE = /(?:\b(?:this|that|it|step|check|point|reading|measurement|result)\b|\b12v\b|\bb\+\b|эт(?:о|от|ом)|\bшаг\b|\bточк|\bвход\b|\bпровод\b|\bклемм\b|\bразъ[её]м\b|\bпредохранител|\besto\b|\beso\b|\bpaso\b|\bpunto\b|\bentrada\b|\bcable\b|\bterminal\b|\bconector\b|\bfusible\b|revisi[oó]n)/iu;

const GUIDANCE_EVIDENCE_PATTERNS = [
  /(?:i\s+)?(?:measured|checked|tested|verified|confirmed|found|got|read|see|saw)\b/i,
  /(?:я\s+)?(?:измерил|проверил|подтвердил|наш[её]л|увидел|заметил)\b/iu,
  /(?:ya\s+)?(?:med[ií]|comprob[eé]|verifiqu[eé]|confirm[eé]|encontr[eé]|vi)\b/iu,
  /^(?:yes|no|да|нет|s[ií]|no)\b[\s,.;:-]?/iu,
];

function extractSignificantTerms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_+/\-]+/gu) ?? []).filter(
    (term) => term.length >= 3 && ![
      "this",
      "that",
      "with",
      "have",
      "from",
      "step",
      "what",
      "where",
      "which",
      "check",
      "как",
      "где",
      "что",
      "это",
      "этот",
      "paso",
      "esto",
      "eso",
      "como",
      "cómo",
      "donde",
      "dónde",
      "que",
      "qué",
    ].includes(term),
  );
}

function hasActiveStepReferenceOverlap(message: string, stepReference: string): boolean {
  const stepTerms = new Set(extractSignificantTerms(stepReference));
  if (stepTerms.size === 0) return false;

  return extractSignificantTerms(message).some((term) => stepTerms.has(term));
}

function containsGuidanceEvidence(message: string): boolean {
  const trimmed = message.trim();

  if (GUIDANCE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  return false;
}

function hasBoundedReference(message: string, stepReference: string): boolean {
  return GENERIC_REFERENCE.test(message) || hasActiveStepReferenceOverlap(message, stepReference);
}

export function classifyStepGuidanceIntent(args: {
  message: string;
  activeStepQuestion: string;
  activeStepHowToCheck?: string | null;
}): StepGuidanceIntentResult | null {
  const stepReference = [args.activeStepQuestion, args.activeStepHowToCheck ?? ""].join(" ").trim();
  if (!stepReference) return null;

  if (containsGuidanceEvidence(args.message) || !hasBoundedReference(args.message, stepReference)) {
    return null;
  }

  const categories: Array<{
    category: StepGuidanceIntentCategory;
    patterns: RegExp[];
  }> = [
    { category: "ALTERNATE_CHECK_POINT", patterns: ALTERNATE_CHECK_POINT_PATTERNS },
    { category: "IDENTIFY_POINT", patterns: IDENTIFY_POINT_PATTERNS },
    { category: "LOCATE_COMPONENT", patterns: LOCATE_COMPONENT_PATTERNS },
    { category: "HOW_TO_CHECK", patterns: HOW_TO_CHECK_PATTERNS },
  ];

  for (const entry of categories) {
    if (entry.patterns.some((pattern) => pattern.test(args.message))) {
      return { category: entry.category };
    }
  }

  return null;
}
