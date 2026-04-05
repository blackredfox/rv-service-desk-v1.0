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
  | "ALTERNATE_CHECK_POINT"
  | "APPEARANCE_RECOGNITION"
  | "CONFIRM_STEP_TARGET"
  | "PHOTO_CONFIRMATION"
  | "GENERIC_STEP_SUPPORT";

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

const APPEARANCE_RECOGNITION_PATTERNS = [
  /what\s+does\s+(?:it|this|that|the\s+part|the\s+component|the\s+target)\s+look\s+like/i,
  /how\s+does\s+(?:it|this|that|the\s+part|the\s+component)\s+look/i,
  /what\s+color\s+is\s+(?:it|this|that|the\s+wire|the\s+part)/i,
  /is\s+it\s+(?:glass|metal|plastic|rubber|red|black|blue|green|white|brown|left|right|top|bottom)/i,
  /как\s+(?:выглядит|выглядят|узнать\s+его|опознать\s+его)/iu,
  /какого\s+цвета\s+(?:он|она|оно|это)/iu,
  /(?:стекло|металл|пластик|резина)\s+или\s+(?:стекло|металл|пластик|резина)/iu,
  /c[oó]mo\s+se\s+ve/i,
  /qu[eé]\s+aspecto\s+tiene/iu,
  /de\s+qu[eé]\s+color\s+es/iu,
  /(?:vidrio|metal|pl[aá]stico|goma)\s+o\s+(?:vidrio|metal|pl[aá]stico|goma)/iu,
];

const CONFIRM_STEP_TARGET_PATTERNS = [
  /is\s+(?:this|that|it|this\s+one|that\s+one|the\s+one)\s+(?:it|the\s+right\s+one|correct|the\s+correct\s+part)?/i,
  /^(?:this|that|it|this\s+one|that\s+one)\??$/i,
  /^(?:left|right|top|bottom|upper|lower)\s+side\??$/i,
  /^(?:red|black|blue|green|white|brown|yellow|orange|gray|grey)\s+(?:wire|lead|connector|terminal|one|side)\??$/i,
  /это\s+(?:он|она|оно|тот|та|то)\??$/iu,
  /^(?:лев(?:ый|ая|ое)|прав(?:ый|ая|ое)|верх(?:ний|няя|нее)|ниж(?:ний|няя|нее))\s+(?:бок|сторона)\??$/iu,
  /^(?:красн(?:ый|ая|ое)|черн(?:ый|ая|ое)|син(?:ий|яя|ее)|бел(?:ый|ая|ое))\s+(?:провод|контакт|разъ[её]м)\??$/iu,
  /(?:es|ser[aá])\s+(?:este|ese|esta|esa|esto|eso)\??$/iu,
  /^(?:este|ese|esta|esa|esto|eso)\??$/iu,
  /^(?:lado\s+izquierdo|lado\s+derecho|arriba|abajo)\??$/iu,
];

const PHOTO_CONFIRMATION_PATTERNS = [
  /(?:photo|picture|image|attachment|attached)\b/i,
  /(?:фото|фотограф|снимок|прикрепил|приложил)/iu,
  /(?:foto|imagen|adjunt[ée]|adjunto|adjunta)/iu,
];

const QUESTION_LIKE_SUPPORT_START_PATTERNS = [
  /^(?:where|what|which|how|is|are|can|should|would|do|does|did|that|this|it|left|right|top|bottom|red|black|blue|green|glass|metal|photo|picture|image)\b/i,
  /^(?:где|что|как|какой|какая|какое|это|этот|эта|это\b|он|она|оно|лев(?:ый|ая|ое)|прав(?:ый|ая|ое)|красн(?:ый|ая|ое)|черн(?:ый|ая|ое)|стекло|металл|фото)\b/iu,
  /^(?:d[oó]nde|qu[eé]|c[oó]mo|cu[aá]l|es|este|ese|esta|esa|izquierdo|derecho|rojo|negro|vidrio|metal|foto|imagen)\b/iu,
];

const VISUAL_ATTRIBUTE_PATTERNS = [
  /\b(?:red|black|blue|green|white|brown|yellow|orange|gray|grey|left|right|top|bottom|upper|lower|glass|metal|plastic|rubber|round|square)\b/i,
  /\b(?:красн(?:ый|ая|ое)|черн(?:ый|ая|ое)|син(?:ий|яя|ее)|зел[её]н(?:ый|ая|ое)|бел(?:ый|ая|ое)|лев(?:ый|ая|ое)|прав(?:ый|ая|ое)|верх(?:ний|няя|нее)|ниж(?:ний|няя|нее)|стекло|металл|пластик|резина|кругл(?:ый|ая|ое)|квадратн(?:ый|ая|ое))\b/iu,
  /\b(?:rojo|negro|azul|verde|blanco|marr[oó]n|amarillo|naranja|gris|izquierdo|derecho|arriba|abajo|vidrio|metal|pl[aá]stico|goma|redondo|cuadrado)\b/iu,
];

const COMPARISON_FRAGMENT_PATTERNS = [
  /\b(?:or|vs\.?|versus)\b/i,
  /\bили\b/iu,
  /\bo\b/iu,
];

const PROGRESSION_OR_MODE_PATTERNS = [
  /start\s+final\s+report/i,
  /(?:write|generate)\s+report/i,
  /next\s+step/i,
  /authorization/i,
  /финальн(?:ый|ого)\s+отч[её]т/iu,
  /следующ(?:ий|его)\s+шаг/iu,
  /авторизац/iu,
  /informe\s+final/iu,
  /siguiente\s+paso/iu,
  /autorizaci[oó]n/iu,
];

const GENERIC_REFERENCE = /(?:\b(?:this|that|it|step|check|point|reading|measurement|result)\b|\b12v\b|\bb\+\b|эт(?:о|от|ом)|\bшаг\b|\bточк|\bвход\b|\bпровод\b|\bклемм\b|\bразъ[её]м\b|\bпредохранител|\besto\b|\beso\b|\bpaso\b|\bpunto\b|\bentrada\b|\bcable\b|\bterminal\b|\bconector\b|\bfusible\b|revisi[oó]n)/iu;

const GUIDANCE_EVIDENCE_PATTERNS = [
  /(?:i\s+)?(?:measured|checked|tested|verified|confirmed|found|got|read|see|saw)\b/i,
  /(?:я\s+)?(?:измерил|проверил|подтвердил|наш[её]л|увидел|заметил)\b/iu,
  /(?:ya\s+)?(?:med[ií]|comprob[eé]|verifiqu[eé]|confirm[eé]|encontr[eé]|vi)\b/iu,
  /^(?:yes|no|да|нет|s[ií]|no)\b[\s,.;:-]?/iu,
  /^\s*\d+(?:\.\d+)?\s*(?:v|volts?|mv|millivolts?|ohms?|amps?|psi|wc)\b/i,
  /\b\d+(?:\.\d+)?\s*(?:v|volts?|mv|millivolts?|ohms?|amps?|psi|wc)\b/i,
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

  if (isQuestionLikeSupportMessage(trimmed) || isShortFragmentFollowUp(trimmed)) {
    return false;
  }

  if (GUIDANCE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  return false;
}

function looksLikeProgressionOrModeChange(message: string): boolean {
  return PROGRESSION_OR_MODE_PATTERNS.some((pattern) => pattern.test(message));
}

function isQuestionLikeSupportMessage(message: string): boolean {
  const trimmed = message.trim();
  return /\?$/.test(trimmed) || QUESTION_LIKE_SUPPORT_START_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isShortFragmentFollowUp(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  const tokenCount = (trimmed.match(/[\p{L}\p{N}_+/\-]+/gu) ?? []).length;
  if (tokenCount === 0 || tokenCount > 6 || trimmed.length > 80) return false;

  return (
    /\?$/.test(trimmed) ||
    VISUAL_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    COMPARISON_FRAGMENT_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    CONFIRM_STEP_TARGET_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

function hasBoundedReference(message: string, stepReference: string): boolean {
  return GENERIC_REFERENCE.test(message) || hasActiveStepReferenceOverlap(message, stepReference);
}

export function classifyStepGuidanceIntent(args: {
  message: string;
  activeStepQuestion: string;
  activeStepHowToCheck?: string | null;
  hasPhotoAttachment?: boolean;
}): StepGuidanceIntentResult | null {
  const stepReference = [args.activeStepQuestion, args.activeStepHowToCheck ?? ""].join(" ").trim();
  const message = args.message.trim();
  const hasPhotoCue = args.hasPhotoAttachment || PHOTO_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(message));
  const hasBoundedStepReference = hasBoundedReference(message, stepReference);
  const questionLikeSupport = isQuestionLikeSupportMessage(message);
  const shortFragmentSupport = isShortFragmentFollowUp(message);

  if (!stepReference) return null;

  if (containsGuidanceEvidence(message) || looksLikeProgressionOrModeChange(message)) {
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
    { category: "APPEARANCE_RECOGNITION", patterns: APPEARANCE_RECOGNITION_PATTERNS },
    { category: "CONFIRM_STEP_TARGET", patterns: CONFIRM_STEP_TARGET_PATTERNS },
  ];

  const specificCategory = categories.find((entry) =>
    entry.patterns.some((pattern) => pattern.test(message)),
  );

  const broadSameStepSupport =
    Boolean(specificCategory) ||
    hasPhotoCue ||
    (shortFragmentSupport && (hasBoundedStepReference || shortFragmentSupport)) ||
    (questionLikeSupport && hasBoundedStepReference);

  if (!broadSameStepSupport) {
    return null;
  }

  if (specificCategory) {
    return { category: specificCategory.category };
  }

  if (hasPhotoCue) {
    return { category: "PHOTO_CONFIRMATION" };
  }

  if (VISUAL_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { category: "APPEARANCE_RECOGNITION" };
  }

  return { category: "GENERIC_STEP_SUPPORT" };
}
