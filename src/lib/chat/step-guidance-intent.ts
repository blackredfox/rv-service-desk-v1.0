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

const PHOTO_REFERENCE_PATTERNS = [
  /(?:photo|picture|image|attachment|attached)\b/i,
  /(?:фото|фотограф|снимок|прикрепил|приложил)/iu,
  /(?:foto|imagen|adjunt[ée]|adjunto|adjunta)/iu,
];

const QUESTION_LEAD_PATTERNS = [
  /^(?:where|what|which|how|is|are|can|should|would|do|does|did|this|that|it)\b/i,
  /^(?:где|что|как|какой|какая|какое|это|этот|эта|он|она|оно)\b/iu,
  /^(?:d[oó]nde|qu[eé]|c[oó]mo|cu[aá]l|es|este|ese|esta|esa|esto|eso)\b/iu,
];

const LEADING_FILLER_PATTERNS = [
  /^(?:and|so|well|uh|um)\s+/i,
  /^(?:а|ну|и)\s+/iu,
  /^(?:y|bueno|pues)\s+/iu,
];

const HOW_TO_CHECK_PATTERNS = [
  /\b(?:how|check|test|measure|verify|inspect|probe|explain|show|tell)\b/i,
  /\b(?:как|провер|измер|тест|объясн|покажи|подскажи)\b/iu,
  /\b(?:c[oó]mo|verific|comprob|medir|probar|revis|mostrar|explicar)\b/iu,
];

const LOCATE_COMPONENT_PATTERNS = [
  /\b(?:where|location|locate|find)\b/i,
  /\b(?:где|наход|искать|найти)\b/iu,
  /\b(?:d[oó]nde|ubicaci[oó]n|encuentr|buscar|queda)\b/iu,
];

const IDENTIFY_POINT_PATTERNS = [
  /\b(?:which|identify|wire|terminal|connector|pin|lead|input|b\+)\b/i,
  /\b(?:како|определ|провод|контакт|разъ[её]м|клемм|вывод|вход)\b/iu,
  /\b(?:qu[eé]|identific|cable|terminal|conector|pin|entrada)\b/iu,
];

const ALTERNATE_CHECK_POINT_PATTERNS = [
  /\b(?:another|other|alternate|alternative|instead)\b/i,
  /\b(?:друг|вместо)\b/iu,
  /\b(?:otro|otra|altern|lugar)\b/iu,
];

const APPEARANCE_RECOGNITION_PATTERNS = [
  /\b(?:look|appearance|color|shape|glass|metal|plastic|rubber|round|square|left|right|top|bottom|red|black|blue|green|white|brown|small|large)\b/i,
  /\b(?:выгляд|цвет|форма|стекл|металл|пластик|резин|кругл|квадрат|лев|прав|верх|низ|красн|черн|син|зел[её]н|бел|маленьк|больш)\b/iu,
  /\b(?:aspecto|color|forma|vidrio|metal|pl[aá]stico|goma|redondo|cuadrado|izquierd|derech|arriba|abajo|rojo|negro|azul|verde|blanco|marr[oó]n|pequeñ|grande)\b/iu,
];

const CONFIRM_STEP_TARGET_PATTERNS = [
  /^(?:is\s+)?(?:this|that|it|this\s+one|that\s+one)(?:\s+(?:the\s+)?(?:right\s+one|correct|the\s+correct\s+part))?\??$/i,
  /^(?:left|right|top|bottom|red|black|blue|green|white|brown|yellow|orange|gray|grey)(?:\s+(?:wire|lead|connector|terminal|one|side))?\??$/i,
  /^(?:это|этот|эта|он|она|оно|тот|та|то)(?:\s+правильн\S*)?\??$/iu,
  /^(?:лев\S*|прав\S*|верх\S*|ниж\S*|красн\S*|черн\S*|син\S*|бел\S*)(?:\s+(?:провод|контакт|разъ[её]м|сторона))?\??$/iu,
  /^(?:este|ese|esta|esa|esto|eso)(?:\s+correct[oa])?\??$/iu,
  /^(?:izquierd\S*|derech\S*|arriba|abajo|rojo|negro|azul|verde|blanco|marr[oó]n)(?:\s+(?:cable|conector|terminal|lado))?\??$/iu,
];

const DEMONSTRATIVE_REFERENCE_PATTERNS = [
  /\b(?:this|that|it|one|thing)\b/i,
  /\b(?:это|этот|эта|то|он|она|оно|тот|та)\b/iu,
  /\b(?:este|ese|esta|esa|esto|eso)\b/iu,
];

const VISUAL_REFERENCE_PATTERNS = [
  /\b(?:left|right|top|bottom|red|black|blue|green|white|brown|glass|metal|plastic|rubber|round|square|small|large|side)\b/i,
  /\b(?:лев|прав|верх|низ|красн|черн|син|зел[её]н|бел|стекл|металл|пластик|резин|кругл|квадрат|маленьк|больш|сторон)\b/iu,
  /\b(?:izquierd|derech|arriba|abajo|rojo|negro|azul|verde|blanco|marr[oó]n|vidrio|metal|pl[aá]stico|goma|redondo|cuadrado|pequeñ|grande|lado)\b/iu,
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

const ACTIVE_STEP_REFERENCE_PATTERNS = [
  /(?:\b(?:step|check|point|reading|measurement|result|12v|b\+)\b)/i,
  /(?:\b(?:шаг|точк|вход|провод|клемм|разъ[её]м|предохранител)\b)/iu,
  /(?:\b(?:paso|punto|entrada|cable|terminal|conector|fusible|revisi[oó]n)\b)/iu,
];

const MEASUREMENT_SUPPORT_PATTERNS = [
  /(?:12\s*[vв]|b\+|voltage|meter|multimeter)/iu,
  /(?:12\s*[vв]|напряжен|мультиметр|вольт)/iu,
  /(?:12\s*[vв]|voltaje|mult[ií]metro)/iu,
];

const SHORTHAND_SAME_STEP_SUPPORT_PATTERNS = [
  /^(?:(?:а|ну|и)\s+)?как(?:\s|$).*(?:12\s*[vв]|напряжен|вольт|мультиметр)/iu,
  /^(?:(?:and|so|well)\s+)?how(?:\s|$).*(?:12\s*v|voltage|meter|multimeter)/i,
  /^(?:(?:y|bueno|pues)\s+)?c[oó]mo(?:\s|$).*(?:12\s*v|voltaje|mult[ií]metro)/iu,
];

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

function getTokenCount(text: string): number {
  return (text.match(/[\p{L}\p{N}_+/\-]+/gu) ?? []).length;
}

function normalizeSupportMessage(message: string): string {
  let normalized = message.trim();

  for (const pattern of LEADING_FILLER_PATTERNS) {
    normalized = normalized.replace(pattern, "");
  }

  return normalized.trim();
}

function hasActiveStepReferenceOverlap(message: string, stepReference: string): boolean {
  const stepTerms = new Set(extractSignificantTerms(stepReference));
  if (stepTerms.size === 0) return false;

  return extractSignificantTerms(message).some((term) => stepTerms.has(term));
}

function hasBroadActiveStepReference(message: string, stepReference: string): boolean {
  return (
    ACTIVE_STEP_REFERENCE_PATTERNS.some((pattern) => pattern.test(message)) ||
    DEMONSTRATIVE_REFERENCE_PATTERNS.some((pattern) => pattern.test(message)) ||
    hasActiveStepReferenceOverlap(message, stepReference)
  );
}

function containsGuidanceEvidence(message: string): boolean {
  const trimmed = normalizeSupportMessage(message);

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
  const trimmed = normalizeSupportMessage(message);
  return /\?$/.test(trimmed) || QUESTION_LEAD_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isShortFragmentFollowUp(message: string): boolean {
  const trimmed = normalizeSupportMessage(message);
  if (!trimmed) return false;

  const tokenCount = getTokenCount(trimmed);
  if (tokenCount === 0 || tokenCount > 6 || trimmed.length > 80) return false;

  return (
    /\?$/.test(trimmed) ||
    VISUAL_REFERENCE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    DEMONSTRATIVE_REFERENCE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    CONFIRM_STEP_TARGET_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

function looksLikeSameStepSupport(args: {
  message: string;
  stepReference: string;
  hasPhotoCue: boolean;
}): boolean {
  const { message, stepReference, hasPhotoCue } = args;
  const questionLikeSupport = isQuestionLikeSupportMessage(message);
  const shortFragmentSupport = isShortFragmentFollowUp(message);
  const tokenCount = getTokenCount(message);
  const hasStepReference = hasBroadActiveStepReference(message, stepReference);
  const hasVisualCue = VISUAL_REFERENCE_PATTERNS.some((pattern) => pattern.test(message));

  if (hasPhotoCue || shortFragmentSupport) {
    return true;
  }

  if (SHORTHAND_SAME_STEP_SUPPORT_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  if (
    tokenCount <= 6 &&
    (HOW_TO_CHECK_PATTERNS.some((pattern) => pattern.test(message)) ||
      LOCATE_COMPONENT_PATTERNS.some((pattern) => pattern.test(message)) ||
      IDENTIFY_POINT_PATTERNS.some((pattern) => pattern.test(message)))
  ) {
    return true;
  }

  if (questionLikeSupport && (hasStepReference || hasVisualCue || tokenCount <= 6)) {
    return true;
  }

  if (questionLikeSupport && MEASUREMENT_SUPPORT_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  return hasStepReference && (questionLikeSupport || hasVisualCue);
}

function inferStepGuidanceCategory(message: string, hasPhotoCue: boolean): StepGuidanceIntentCategory {
  if (hasPhotoCue) {
    return "PHOTO_CONFIRMATION";
  }

  if (ALTERNATE_CHECK_POINT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "ALTERNATE_CHECK_POINT";
  }

  if (SHORTHAND_SAME_STEP_SUPPORT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "HOW_TO_CHECK";
  }

  if (IDENTIFY_POINT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "IDENTIFY_POINT";
  }

  if (LOCATE_COMPONENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "LOCATE_COMPONENT";
  }

  if (HOW_TO_CHECK_PATTERNS.some((pattern) => pattern.test(message))) {
    return "HOW_TO_CHECK";
  }

  if (CONFIRM_STEP_TARGET_PATTERNS.some((pattern) => pattern.test(message))) {
    return "CONFIRM_STEP_TARGET";
  }

  if (APPEARANCE_RECOGNITION_PATTERNS.some((pattern) => pattern.test(message))) {
    return "APPEARANCE_RECOGNITION";
  }

  return "GENERIC_STEP_SUPPORT";
}

export function classifyStepGuidanceIntent(args: {
  message: string;
  activeStepQuestion: string;
  activeStepHowToCheck?: string | null;
  hasPhotoAttachment?: boolean;
}): StepGuidanceIntentResult | null {
  const stepReference = [args.activeStepQuestion, args.activeStepHowToCheck ?? ""].join(" ").trim();
  const message = normalizeSupportMessage(args.message);
  const hasPhotoCue = args.hasPhotoAttachment || PHOTO_REFERENCE_PATTERNS.some((pattern) => pattern.test(message));

  if (!stepReference) return null;

  if (containsGuidanceEvidence(message) || looksLikeProgressionOrModeChange(message)) {
    return null;
  }

  if (!looksLikeSameStepSupport({ message, stepReference, hasPhotoCue })) {
    return null;
  }

  return { category: inferStepGuidanceCategory(message, hasPhotoCue) };
}
