/**
 * Deterministic current-step guidance intent classification.
 *
 * Responsibility: classify bounded guidance requests only.
 * Does NOT own: step progression, mode transitions, or evidence handling.
 *
 * PR4: Added chained clarification detection to handle repeated follow-up
 * questions that should stay on the same active step without advancement.
 */

export type StepGuidanceIntentCategory =
  | "HOW_TO_CHECK"
  | "LOCATE_COMPONENT"
  | "IDENTIFY_POINT"
  | "ALTERNATE_CHECK_POINT"
  | "CHAINED_CLARIFICATION";

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

/**
 * PR4: Chained clarification patterns — repeated follow-up questions
 * that remain about the same active step context.
 *
 * These patterns detect follow-up clarification requests such as:
 * - "tell me where the fuse is" (after prior "how do I check" question)
 * - "is this the one?" / "is this it?"
 * - short dictation-style follow-ups
 * - photo confirmation requests
 *
 * These must NOT advance the step — they stay on the same active step.
 */
const CHAINED_CLARIFICATION_PATTERNS = [
  // EN: repeated locate/tell-me patterns
  /tell\s+(?:me\s+)?where\s+(?:the\s+)?(?:fuse|connector|board|relay|pump|wire|terminal|input|switch)/i,
  /show\s+(?:me\s+)?where/i,
  /point\s+(?:me\s+)?to/i,
  // EN: confirmation questions (is this it? is this the one?)
  /is\s+(?:this|that)\s+(?:it|the\s+(?:one|right\s+one|correct\s+one|fuse|connector|board|relay|terminal))/i,
  /does\s+(?:this|that)\s+look\s+(?:right|correct|like)/i,
  /is\s+(?:this|that)\s+(?:what\s+(?:you|i)\s+(?:mean|need))/i,
  /(?:attached|sent|uploaded)\s+(?:a\s+)?(?:photo|picture|image)/i,
  // EN: short fragmented follow-ups
  /^(?:this\s+one|that\s+one|here|this|that)\??\s*$/i,
  /^(?:is\s+it\s+)?(?:here|there)\??\s*$/i,

  // RU: repeated locate/tell-me patterns
  /скаж(?:и|ите)\s+(?:мне\s+)?(?:где|куда)/iu,
  /покаж(?:и|ите)\s+(?:мне\s+)?где/iu,
  /(?:а\s+)?где\s+(?:именно\s+)?(?:находится|искать|найти)\s+(?:предохранител|разъ[её]м|плат|реле|насос|провод|клемм|вход|выключател)/iu,
  // RU: confirmation questions
  /это\s+(?:он|она|оно|тот|та|то|правильн|нужн)/iu,
  /(?:это\s+)?(?:тот\s+)?(?:предохранител|разъ[её]м|провод|клемм|вход)/iu,
  /(?:приложил|отправил|загрузил)\s+(?:фото|фотографи|изображени)/iu,
  /(?:похож|выглядит)\s+(?:как|на)\s+(?:вход|плат|разъ[её]м)/iu,
  // RU: short fragmented follow-ups
  /^(?:это\s+)?(?:он|она|оно|тут|здесь|там)\??\s*$/iu,

  // ES: repeated locate/tell-me patterns
  /d(?:i|í)me\s+(?:d[oó]nde|donde)/iu,
  /mu[ée]strame\s+(?:d[oó]nde|donde)/iu,
  /(?:y\s+)?(?:d[oó]nde|donde)\s+(?:exactamente\s+)?(?:est[aá]|queda|encuentro)\s+(?:el\s+)?(?:fusible|conector|placa|rel[eé]|bomba|cable|terminal|entrada|interruptor)/iu,
  // ES: confirmation questions
  /(?:[eé]s)?(?:te|a)\s+(?:es\s+)?(?:el\s+)?(?:correcto|indicado|fusible|conector)/iu,
  /es\s+(?:este|ese|esto|eso)(?:\s+(?:el\s+)?(?:correcto|indicado|que\s+(?:necesito|busco)))?\s*\??\s*$/iu,
  /(?:adjunt[eé]|env[ií][eé]|sub[ií])\s+(?:una\s+)?(?:foto|imagen)/iu,
  /(?:parece|se\s+ve)\s+(?:como|que\s+es)/iu,
  // ES: short fragmented follow-ups
  /^(?:[eé]s)?(?:te|a|o)?\s*\??\s*$/iu,
  /^(?:aqu[ií]|all[ií])\s*\??\s*$/iu,
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
  isChainedFollowUp?: boolean;
}): StepGuidanceIntentResult | null {
  const stepReference = [args.activeStepQuestion, args.activeStepHowToCheck ?? ""].join(" ").trim();
  if (!stepReference) return null;

  // PR4: For chained follow-ups, be more lenient with the reference check
  // since the technician is clearly still asking about the same step context
  const hasReference = hasBoundedReference(args.message, stepReference);
  const hasEvidence = containsGuidanceEvidence(args.message);

  // If this is a chained follow-up AND no evidence is reported, treat as clarification
  if (args.isChainedFollowUp && !hasEvidence) {
    // Check for chained clarification patterns first
    if (CHAINED_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(args.message))) {
      return { category: "CHAINED_CLARIFICATION" };
    }
    // Also check standard patterns even without strict reference
    for (const entry of [
      { category: "LOCATE_COMPONENT" as const, patterns: LOCATE_COMPONENT_PATTERNS },
      { category: "IDENTIFY_POINT" as const, patterns: IDENTIFY_POINT_PATTERNS },
      { category: "HOW_TO_CHECK" as const, patterns: HOW_TO_CHECK_PATTERNS },
    ]) {
      if (entry.patterns.some((pattern) => pattern.test(args.message))) {
        return { category: entry.category };
      }
    }
  }

  // Standard flow: require reference and no evidence
  if (hasEvidence || !hasReference) {
    return null;
  }

  const categories: Array<{
    category: StepGuidanceIntentCategory;
    patterns: RegExp[];
  }> = [
    { category: "CHAINED_CLARIFICATION", patterns: CHAINED_CLARIFICATION_PATTERNS },
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

/**
 * PR4: Check if a message is a chained follow-up clarification
 * that should stay on the same active step.
 *
 * This is used to detect when the technician is asking repeated
 * clarification questions without providing actual findings.
 */
export function isChainedClarificationFollowUp(args: {
  message: string;
  previousWasGuidance: boolean;
  activeStepQuestion: string;
  activeStepHowToCheck?: string | null;
}): boolean {
  // If previous turn was not guidance, this cannot be a chained follow-up
  if (!args.previousWasGuidance) return false;

  // Check if message contains actual findings (should not be treated as chained)
  if (containsGuidanceEvidence(args.message)) return false;

  // Check for chained clarification patterns
  if (CHAINED_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(args.message))) {
    return true;
  }

  // Check for standard guidance patterns (may be repeated locate/how-to questions)
  const allGuidancePatterns = [
    ...LOCATE_COMPONENT_PATTERNS,
    ...IDENTIFY_POINT_PATTERNS,
    ...HOW_TO_CHECK_PATTERNS,
  ];

  return allGuidancePatterns.some((pattern) => pattern.test(args.message));
}
