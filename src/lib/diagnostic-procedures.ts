/**
 * Diagnostic Procedures — structured, typed diagnostic sequences for RV systems.
 *
 * Each procedure defines an ordered sequence of steps with prerequisites.
 * The Agent MUST follow these steps in order and NEVER invent new ones.
 *
 * Architecture:
 * - Procedures are the single source of truth for diagnostic questions.
 * - The prompt file references the active procedure; it does NOT embed sequences.
 * - Step completion is tracked in the diagnostic registry.
 */

import type { Language } from "./lang";

// ── Types ───────────────────────────────────────────────────────────

export type DiagnosticStep = {
  /** Unique step ID within the procedure (e.g. "wp_1", "furn_3") */
  id: string;
  /** The exact diagnostic question to ask */
  question: string;
  /** Step IDs that must be completed before this step can be asked */
  prerequisites: string[];
  /** Patterns in technician messages that indicate this step is answered */
  matchPatterns: RegExp[];
  /** How-to-check instruction returned when the technician asks for guidance */
  howToCheck?: string;
  /** Branch ID this step belongs to (null = main flow) */
  branchId?: string;
};

/**
 * Branch definition for conditional diagnostic paths.
 * A branch is entered based on technician response and is mutually exclusive with other branches.
 */
export type ProcedureBranch = {
  /** Unique branch ID (e.g., "no_ignition", "flame_failure") */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Step that can trigger entry to this branch */
  triggerStepId: string;
  /** Pattern in technician response that triggers this branch */
  triggerPattern: RegExp;
  /** First step when entering this branch */
  entryStepId: string;
  /** Branch IDs that cannot be active simultaneously */
  mutuallyExclusive: string[];
};

export type DiagnosticProcedure = {
  /** System identifier (e.g. "water_pump", "furnace") */
  system: string;
  /** Display name for the system */
  displayName: string;
  /** Whether this is a complex system (requires thorough diagnosis) */
  complex: boolean;
  /** Procedure variant */
  variant: "MANUFACTURER" | "STANDARD";
  /** Ordered steps */
  steps: DiagnosticStep[];
  /** Branch definitions (P1.5) */
  branches?: ProcedureBranch[];
};

// ── System Detection ────────────────────────────────────────────────

const SYSTEM_PATTERNS: Array<{ system: string; patterns: RegExp[] }> = [
  // Water heater MUST be before furnace (more specific pattern)
  { system: "water_heater", patterns: [
    /water\s*heater/i, 
    /водонагреват/i, 
    /бойлер/i,
    /calentador\s*de\s*agua/i,
    /hot\s*water\s*(?:heater|tank|system)/i,
    /suburban.*(?:gas|water)/i,
    /atwood.*(?:gas|water)/i,
    /(?:gas|propane|lp).*water\s*heater/i,
  ]},
  { system: "water_pump", patterns: [/water\s*pump/i, /водяно[йе]\s*насос/i, /bomba\s*de\s*agua/i, /fresh\s*water\s*pump/i] },
  { system: "lp_gas", patterns: [/lp\s*gas|propane|gas\s*(?:system|leak|line|valve|regulator)/i, /газ(?:ов)?/i, /gas\s*(?:lp|propano)/i] },
  { system: "slide_out", patterns: [/slide[\s-]*out/i, /слайд/i, /slide\s*room/i] },
  { system: "leveling", patterns: [/level(?:ing|er)?\s*(?:system|jack)/i, /jack\s*system/i, /выравнива/i, /nivelaci/i] },
  { system: "inverter_converter", patterns: [/inverter/i, /converter/i, /инвертер|инвертор|конвертер|конвертор/i] },
  { system: "furnace", patterns: [/furnace/i, /heater(?!\s*pump)/i, /печ[ьк]/i, /калориф/i, /horno/i, /calefacc/i] },
  { system: "roof_ac", patterns: [/(?:roof\s*)?(?:ac|a\/c)\b/i, /air\s*condition/i, /heat\s*pump/i, /кондицион/i, /aire\s*acondicionado/i] },
  { system: "refrigerator", patterns: [/refrig/i, /fridge/i, /холодильник/i, /refrigerador/i, /nevera/i] },
  { system: "electrical_ac", patterns: [/(?:120v|110v)\s*(?:outlet|circuit|power|electrical)/i, /gfci/i, /\boutlet\b/i, /розетк/i] },
  { system: "electrical_12v", patterns: [/12v|12\s*volt|dc\s*(?:power|circuit|system)/i, /(?:light|fan|vent)\s*(?:not|won't|doesn't|don't)/i] },
  { system: "consumer_appliance", patterns: [/(?:tv|television|microwave|stereo|radio|dvd|blu[\s-]*ray)/i, /телевизор|микроволнов/i] },
  { system: "awning", patterns: [/awning/i, /маркиз/i, /toldo/i] },
];

/**
 * Detect the system from the technician's initial message.
 * Returns null if no system can be identified.
 */
export function detectSystem(message: string): string | null {
  for (const { system, patterns } of SYSTEM_PATTERNS) {
    if (patterns.some((p) => p.test(message))) return system;
  }
  return null;
}

// ── Procedures ──────────────────────────────────────────────────────

const PROCEDURES: Map<string, DiagnosticProcedure> = new Map();

function reg(proc: DiagnosticProcedure) {
  PROCEDURES.set(proc.system, proc);
}

type LocalizedProcedureContent = {
  displayName?: Partial<Record<Language, string>>;
  steps?: Record<
    string,
    {
      question?: Partial<Record<Language, string>>;
      howToCheck?: Partial<Record<Language, string>>;
    }
  >;
};

const PROCEDURE_LOCALIZATIONS: Partial<Record<string, LocalizedProcedureContent>> = {
  water_heater: {
    displayName: {
      RU: "Водонагреватель (газовый/комбинированный)",
    },
    steps: {
      wh_1: {
        question: {
          RU: "Какой тип водонагревателя установлен? (только газ/LP, только электрический или комбинированный газ+электро) Если известно, укажите марку/модель.",
        },
        howToCheck: {
          RU: "Проверьте шильдик на водонагревателе. У газовых моделей снаружи видна горелочная трубка. У чисто электрических моделей наружного доступа к горелке нет. У комбинированных есть оба режима.",
        },
      },
      wh_2: {
        question: {
          RU: "Какой уровень в LP-баке — показание указателя или проверка по весу? Основной вентиль бака полностью открыт?",
        },
        howToCheck: {
          RU: "Проверьте указатель уровня бака или взвесьте баллон. Убедитесь, что рукоятка основного вентиля параллельна линии (положение открыто).",
        },
      },
      wh_3: {
        question: {
          RU: "Работают ли другие LP-приборы? (горелки плиты, печь, холодильник в режиме LP)",
        },
        howToCheck: {
          RU: "Включите горелку плиты. Если она загорается и горит синим пламенем, подача LP в RV в норме.",
        },
      },
      wh_4: {
        question: {
          RU: "Открыт ли ручной газовый запорный клапан на водонагревателе? (находится на газовой линии перед входом в узел)",
        },
        howToCheck: {
          RU: "Проследите газовую линию до водонагревателя. Рукоятка запорного клапана должна быть параллельна трубе (открыто).",
        },
      },
      wh_5: {
        question: {
          RU: "Есть ли 12 В DC на плате управления/поджиге водонагревателя? Измерьте напряжение.",
        },
        howToCheck: {
          RU: "Переключите мультиметр в режим DC volts и измерьте напряжение на входных клеммах 12V платы управления. Норма: 11.5–13.5 В.",
        },
      },
      wh_5a: {
        question: {
          RU: "Ветка отсутствия 12 В: проверьте предохранитель/автомат водонагревателя, отключатель аккумулятора и цепь питания от внутреннего выключателя. Есть ли напряжение аккумулятора до платы управления?",
        },
        howToCheck: {
          RU: "Измерьте DC-напряжение с обеих сторон предохранителя или автомата, затем на отключателе аккумулятора и на проводе питания от внутреннего выключателя. На каждой точке до платы должно быть напряжение аккумулятора.",
        },
      },
      wh_5b: {
        question: {
          RU: "Ветка отсутствия 12 В: проверьте непрерывность массы и осмотрите проводку/разъёмы от цепи предохранителя и выключателя до платы управления. Есть ли обрыв, коррозия или ослабленное соединение?",
        },
        howToCheck: {
          RU: "Проверьте непрерывность от массы платы до шасси, затем осмотрите жгут, разъёмы и соединения на коррозию, перегрев, обрыв или ослабление.",
        },
      },
      wh_5c: {
        question: {
          RU: "Ветка отсутствия 12 В: после проверки или ремонта питающей цепи восстановились ли 12 В DC на плате управления водонагревателя? Точное значение?",
        },
        howToCheck: {
          RU: "После устранения проблемы снова измерьте DC-напряжение прямо на входе 12V платы управления. Норма: 11.5–13.5 В.",
        },
      },
      wh_6: {
        question: {
          RU: "Когда водонагреватель включён: слышны ли щелчки/искрение от поджига? Для моделей со свечой накала — разогревается ли она до оранжевого цвета?",
        },
        howToCheck: {
          RU: "Включите водонагреватель. У горелки послушайте щелчки (искровой розжиг) или посмотрите, появляется ли оранжевое свечение нагревателя.",
        },
      },
      wh_7: {
        question: {
          RU: "Загорается ли горелка и удерживается ли пламя? Цвет: синий, жёлтый или пламени нет?",
        },
        howToCheck: {
          RU: "Посмотрите через смотровое окно горелки. Исправное пламя в основном синее, допускаются небольшие жёлтые кончики.",
        },
      },
      wh_6a: {
        question: {
          RU: "Ветка отсутствия розжига: есть ли 12 В на клеммах модуля поджига во время попытки розжига?",
        },
        howToCheck: {
          RU: "Измерьте DC-напряжение на модуле поджига при включённом переключателе. Во время попытки розжига должно появляться 12 В.",
        },
      },
      wh_6b: {
        question: {
          RU: "Ветка отсутствия розжига: проверьте зазор и состояние искрового электрода. Зазор 1/8\" (3 мм), наконечник чистый, трещин нет?",
        },
        howToCheck: {
          RU: "Снимите электрод. Осмотрите наконечник на нагар и повреждения. Зазор до горелочной трубки должен быть 1/8\".",
        },
      },
      wh_6c: {
        question: {
          RU: "Ветка отсутствия розжига: надёжно ли подключена масса модуля поджига? Есть ли непрерывность от модуля до шасси?",
        },
        howToCheck: {
          RU: "Проверьте соединение провода и прозвоните массу до шасси.",
        },
      },
      wh_7a: {
        question: {
          RU: "Ветка срыва пламени: сколько времени пламя горит до затухания? (в секундах)",
        },
        howToCheck: {
          RU: "Засеките время от появления пламени до блокировки. Меньше 10 с часто указывает на датчик пламени, больше 30 с — на проблему подачи газа.",
        },
      },
      wh_7b: {
        question: {
          RU: "Ветка срыва пламени: какое милливольтное значение на термопаре/датчике пламени при наличии пламени?",
        },
        howToCheck: {
          RU: "Измерьте DC mV на выводах термопары при горящем пламени. Для удержания газового клапана обычно нужно минимум 20–30 mV.",
        },
      },
      wh_7c: {
        question: {
          RU: "Ветка срыва пламени: положение термопары — наконечник находится по центру факела? Не касается металла горелки?",
        },
        howToCheck: {
          RU: "Наконечник термопары должен быть в самой горячей части пламени (примерно на 1/2\" выше горелки) и не касаться металла.",
        },
      },
      wh_8a: {
        question: {
          RU: "Ветка отсутствия подачи газа: есть ли 12 В на катушке соленоида газового клапана во время попытки розжига?",
        },
        howToCheck: {
          RU: "Измерьте DC-напряжение на клеммах катушки соленоида во время цикла розжига.",
        },
      },
      wh_8b: {
        question: {
          RU: "Ветка отсутствия подачи газа: какое сопротивление катушки соленоида газового клапана? (должно быть 30–200 Ом)",
        },
        howToCheck: {
          RU: "Отсоедините провода катушки и измерьте сопротивление между клеммами. OL = обрыв катушки = замена клапана.",
        },
      },
      wh_8c: {
        question: {
          RU: "Ветка отсутствия подачи газа: есть ли мусор во входной сетке узла ручного клапана?",
        },
        howToCheck: {
          RU: "Отсоедините газовую линию на входе клапана и проверьте входную сетку на мусор или коррозию.",
        },
      },
      wh_8: {
        question: {
          RU: "Если 12 В на соленоиде газового клапана подтверждены: проходит ли газ дальше? (краткая проверка запаха у горелочной трубки или показание манометра)",
        },
        howToCheck: {
          RU: "БЕЗОПАСНОСТЬ: только кратко проверьте запах. Если на клапане есть 12 В, а газа нет, соленоид клапана может зависнуть или быть неисправным.",
        },
      },
      wh_9: {
        question: {
          RU: "Термопара / датчик пламени: чистый и правильно расположен в зоне пламени? Какое милливольтное значение при наличии пламени?",
        },
        howToCheck: {
          RU: "При наличии пламени измерьте DC mV на выводах термопары. Норма — минимум 20–30 mV.",
        },
      },
      wh_10: {
        question: {
          RU: "Состояние горелочной трубки и жиклёра: видны ли засорение, коррозия, насекомые или повреждения?",
        },
        howToCheck: {
          RU: "Снимите крышку доступа к горелочной трубке и осмотрите фонариком. Частые причины засора — паутина и гнёзда насекомых.",
        },
      },
      wh_11: {
        question: {
          RU: "Только для COMBO-моделей: работает ли электрический ТЭН? Есть ли 120 В на элементе при включённом переключателе?",
        },
        howToCheck: {
          RU: "При включённом электрорежиме измерьте 120 VAC на клеммах ТЭНа. Сопротивление элемента обычно 10–16 Ом.",
        },
      },
      wh_12: {
        question: {
          RU: "Проверялась или нажималась кнопка сброса верхнего термопредохранителя (ECO)? Она находится на газовом клапане или рядом с термостатом.",
        },
        howToCheck: {
          RU: "Найдите маленькую красную кнопку сброса на узле газового клапана. Нажмите уверенно. Если был щелчок, ECO был сработавшим.",
        },
      },
    },
  },
};

type ProcedureContextLabels = {
  activeProcedure: string;
  progress: (doneCount: number, totalSteps: number) => string;
  currentStep: string;
  askExactly: string;
  howToCheckHeader: string;
  allStepsComplete: string;
  completionSummary: string;
  completionWait: string;
};

function getProcedureContextLabels(language: Language = "EN"): ProcedureContextLabels {
  switch (language) {
    case "RU":
      return {
        activeProcedure: "АКТИВНАЯ ДИАГНОСТИЧЕСКАЯ ПРОЦЕДУРА",
        progress: (doneCount, totalSteps) => `Прогресс: ${doneCount}/${totalSteps} шагов завершено`,
        currentStep: "ТЕКУЩИЙ ШАГ",
        askExactly: "Задай ТОЧНО",
        howToCheckHeader: "ИНСТРУКЦИЯ КАК ПРОВЕРИТЬ (техник попросил пояснение)",
        allStepsComplete: "ВСЕ ШАГИ ЗАВЕРШЕНЫ.",
        completionSummary: "Кратко подведи итоги и спроси: 'Готовы сформировать финальный отчёт? Отправьте START FINAL REPORT, когда будете готовы.'",
        completionWait: "Не формируй отчёт. Не объявляй изоляцию завершённой. Жди явную команду.",
      };
    case "ES":
      return {
        activeProcedure: "PROCEDIMIENTO DE DIAGNÓSTICO ACTIVO",
        progress: (doneCount, totalSteps) => `Progreso: ${doneCount}/${totalSteps} pasos completados`,
        currentStep: "PASO ACTUAL",
        askExactly: "Pregunta EXACTAMENTE",
        howToCheckHeader: "INSTRUCCIÓN DE CÓMO VERIFICAR (el técnico pidió orientación)",
        allStepsComplete: "TODOS LOS PASOS COMPLETADOS.",
        completionSummary: "Resume brevemente los hallazgos y pregunta: '¿Listo para generar el informe final? Envíe START FINAL REPORT cuando esté listo.'",
        completionWait: "No generes el informe. No declares el aislamiento completo. Espera el comando explícito.",
      };
    default:
      return {
        activeProcedure: "ACTIVE DIAGNOSTIC PROCEDURE",
        progress: (doneCount, totalSteps) => `Progress: ${doneCount}/${totalSteps} steps completed`,
        currentStep: "CURRENT STEP",
        askExactly: "Ask EXACTLY",
        howToCheckHeader: "HOW-TO-CHECK INSTRUCTION (technician asked for guidance)",
        allStepsComplete: "ALL STEPS COMPLETE.",
        completionSummary: "Summarize findings and ask: 'Ready to generate final report? Send START FINAL REPORT when ready.'",
        completionWait: "Do NOT generate the report. Do NOT declare isolation complete. Wait for explicit command.",
      };
  }
}

export function getLocalizedProcedureDisplayName(
  procedure: DiagnosticProcedure,
  language: Language = "EN",
): string {
  return PROCEDURE_LOCALIZATIONS[procedure.system]?.displayName?.[language] ?? procedure.displayName;
}

export function getLocalizedStepQuestion(
  procedure: DiagnosticProcedure,
  step: DiagnosticStep,
  language: Language = "EN",
): string {
  return PROCEDURE_LOCALIZATIONS[procedure.system]?.steps?.[step.id]?.question?.[language] ?? step.question;
}

export function getLocalizedStepHowToCheck(
  procedure: DiagnosticProcedure,
  step: DiagnosticStep,
  language: Language = "EN",
): string | undefined {
  return PROCEDURE_LOCALIZATIONS[procedure.system]?.steps?.[step.id]?.howToCheck?.[language] ?? step.howToCheck;
}

// ── Water Pump ──────────────────────────────────────────────────────

reg({
  system: "water_pump",
  displayName: "Water Pump",
  complex: false,
  variant: "STANDARD",
  steps: [
    {
      id: "wp_1",
      question: "Does the pump attempt to run when a faucet is opened? Any noise, humming, or vibration?",
      prerequisites: [],
      matchPatterns: [/pump.*(?:run|noise|hum|vibrat|silent|nothing|no\s*sound|dead)/i, /faucet.*open/i],
    },
    {
      id: "wp_2",
      question: "Measure voltage at the pump motor terminals with faucet open. Is 12V DC present? Exact reading?",
      prerequisites: ["wp_1"],
      matchPatterns: [/(?:\d+(?:\.\d+)?)\s*v(?:olts?|dc)?/i, /voltage.*(?:pump|terminal|motor)/i, /no\s*(?:voltage|power)/i],
    },
    {
      id: "wp_3",
      question: "Verify ground continuity between pump housing and chassis. Clean and secure?",
      prerequisites: ["wp_1"],
      matchPatterns: [/ground.*(?:good|ok|clean|secure|continu)/i, /(?:no|bad|poor)\s*ground/i, /(?:\d+(?:\.\d+)?)\s*ohm/i],
    },
    {
      id: "wp_4",
      question: "Any visible water damage, corrosion, or burnt marks on the pump or wiring?",
      prerequisites: ["wp_1"],
      matchPatterns: [/(?:no|yes|some)?\s*(?:corrosion|burn|damage|water\s*damage)/i, /(?:looks?\s*)?(?:clean|good|ok|fine)/i],
    },
    {
      id: "wp_5",
      question: "Is the pressure switch functioning? Does it click when system pressure drops?",
      prerequisites: ["wp_2"],
      matchPatterns: [/pressure\s*switch/i, /click/i, /(?:no|yes)\s*click/i],
    },
  ],
});

// ── LP Gas ──────────────────────────────────────────────────────────

reg({
  system: "lp_gas",
  displayName: "LP Gas System",
  complex: true,
  variant: "STANDARD",
  steps: [
    {
      id: "lpg_1",
      question: "LP tank level — gauge reading or weight check? Valve in full open position?",
      prerequisites: [],
      matchPatterns: [/tank.*(?:full|empty|level|gauge|\d+%)/i, /valve.*(?:open|closed)/i],
    },
    {
      id: "lpg_2",
      question: "Regulator output pressure — reading at the test port? Should be 11\" WC (± 0.5).",
      prerequisites: ["lpg_1"],
      matchPatterns: [/(?:regulator|pressure).*(?:\d+|wc|water\s*column)/i, /(?:11|10|12).*(?:wc|inch)/i],
      howToCheck: "Connect a manometer to the regulator test port. With an appliance running, reading should be 11\" WC (±0.5). Below 10\" = low supply or failing regulator.",
    },
    {
      id: "lpg_3",
      question: "Gas leak detector applied at all connections from tank to appliance? Any bubbles or detector alerts?",
      prerequisites: ["lpg_1"],
      matchPatterns: [/(?:no|yes)\s*(?:leak|bubble)/i, /leak.*(?:test|detect|check)/i, /(?:clean|good|tight)\s*(?:connection|fitting)/i],
      howToCheck: "Apply leak detector solution or use an electronic sniffer at each fitting from tank valve to appliance. Bubbles or detector alarm = leak. Tighten or replace fitting.",
    },
    {
      id: "lpg_4",
      question: "Manual gas valve at the appliance — open? Verify gas flow reaches the appliance.",
      prerequisites: ["lpg_2"],
      matchPatterns: [/manual\s*(?:gas\s*)?valve.*(?:open|closed)/i, /gas.*(?:reach|flow|present)/i],
      howToCheck: "Locate the manual shutoff valve on the gas line entering the appliance. Handle parallel to pipe = open. If open but no gas, check upstream connections.",
    },
    {
      id: "lpg_5",
      question: "Ignition sequence — does the igniter activate (spark or glow)? Timing correct?",
      prerequisites: ["lpg_4"],
      matchPatterns: [/ignit.*(?:spark|glow|work|fire|activate)/i, /(?:no|yes)\s*(?:spark|ignition)/i],
      howToCheck: "Turn appliance on and observe igniter. Spark igniters should click 2-4 times per second. Hot surface igniters glow orange within 15-30 seconds.",
    },
    {
      id: "lpg_6",
      question: "Flame present after ignition? Color and stability? Blue and steady?",
      prerequisites: ["lpg_5"],
      matchPatterns: [/flame.*(?:present|blue|yellow|steady|unstable|no|none)/i, /(?:no|yes)\s*flame/i],
      howToCheck: "View through sight glass or access panel. Proper flame is mostly blue with small yellow tips. Yellow/orange flame = air mixture issue. Wavering = draft or pressure problem.",
    },
    {
      id: "lpg_7",
      question: "Flame sensor / thermocouple — clean and positioned in flame path? Voltage reading?",
      prerequisites: ["lpg_6"],
      matchPatterns: [/(?:flame\s*sensor|thermocouple).*(?:clean|dirty|position|mv|millivolt|\d+)/i],
      howToCheck: "Thermocouple tip should be in the flame path, not touching metal. Measure DC millivolts with flame lit — need 20-30mV minimum to hold gas valve open.",
    },
    {
      id: "lpg_8",
      question: "Control board error codes or fault indicators? LED status?",
      prerequisites: [],
      matchPatterns: [/(?:error|fault|code|led|blink|flash)/i],
    },
  ],
});

// ── Water Heater (Gas / Combo) ──────────────────────────────────────

reg({
  system: "water_heater",
  displayName: "Water Heater (Gas/Combo)",
  complex: true,
  variant: "STANDARD",
  steps: [
    // Step 1: System type identification
    {
      id: "wh_1",
      question: "What type of water heater? (Gas/LP only, Electric only, or Combo gas+electric) Make/model if known?",
      prerequisites: [],
      matchPatterns: [
        /(?:gas|lp|propane|electric|combo|combination|both)/i,
        /suburban|atwood|dometic|girard/i,
        /(?:только\s*)?(?:газ|электр|комбинир)/i,
      ],
      howToCheck: "Check the label on the water heater. Gas units have a burner tube visible from outside. Electric-only units have no external burner access. Combo units have both.",
    },
    // Step 2: For gas/combo - LP supply verification
    {
      id: "wh_2",
      question: "LP tank level — gauge reading or weight check? Main tank valve fully open?",
      prerequisites: ["wh_1"],
      matchPatterns: [
        /(?:tank|level|gauge|манометр).*(?:\d+|full|empty|open|closed|0)/i,
        /(?:valve|клапан|вентиль).*(?:open|closed|открыт|закрыт)/i,
        /давлен.*(?:\d+|0|норм)/i,
      ],
      howToCheck: "Check tank gauge or weigh the tank. Ensure main valve handle is parallel to the line (open position).",
    },
    // Step 3: Other LP appliances check (isolation step)
    {
      id: "wh_3",
      question: "Do other LP appliances work? (Stove burners, furnace, refrigerator on LP mode)",
      prerequisites: ["wh_2"],
      matchPatterns: [
        /(?:other|stove|furnace|fridge|refrigerator|плита|печь|холодильник).*(?:work|yes|no|да|нет)/i,
        /(?:да|нет|yes|no).*(?:work|работа)/i,
      ],
      howToCheck: "Turn on a stove burner. If it lights and burns blue, LP supply to the RV is good.",
    },
    // Step 4: Water heater gas valve position
    {
      id: "wh_4",
      question: "Is the manual gas shutoff valve to the water heater open? (Located on gas line entering the unit)",
      prerequisites: ["wh_3"],
      matchPatterns: [
        /(?:manual|shutoff|gas\s*valve).*(?:open|closed|yes|no)/i,
        /(?:открыт|закрыт|да|нет)/i,
      ],
      howToCheck: "Trace the gas line to the water heater. The shutoff valve handle should be parallel to the pipe (open).",
    },
    // Step 5: 12V power verification
    {
      id: "wh_5",
      question: "Is 12V DC present at the water heater control board/igniter? Measure voltage.",
      prerequisites: ["wh_1"],
      matchPatterns: [
        /(?:\d+(?:\.\d+)?)\s*v(?:olts?|dc)?/i,
        /(?:12v|12\s*volt|voltage|напряжени)/i,
        /(?:no|yes|есть|нет)\s*(?:power|voltage|питани)/i,
      ],
      howToCheck: "With multimeter set to DC volts, measure across the 12V input terminals on the control board. Should read 11.5-13.5V.",
    },
    // Step 6: Ignition attempt (BRANCH TRIGGER STEP)
    {
      id: "wh_6",
      question: "When water heater is turned ON: Do you hear clicking/sparking from the igniter? For glow plug models: does it glow orange?",
      prerequisites: ["wh_4", "wh_5"],
      matchPatterns: [
        /(?:click|spark|glow|ignit).*(?:yes|no|hear|see)/i,
        /(?:да|нет|слыш|виж).*(?:щелч|искр|свеч)/i,
        /(?:no|yes)\s*(?:click|spark|glow)/i,
      ],
      howToCheck: "Turn the water heater switch ON. Listen near the burner for clicking (spark ignition) or look for orange glow (hot surface igniter).",
    },
    // Step 7: Flame presence (BRANCH TRIGGER STEP)
    {
      id: "wh_7",
      question: "Does the burner flame light and stay lit? Color: blue, yellow, or no flame?",
      prerequisites: ["wh_6"],
      matchPatterns: [
        /flame.*(?:yes|no|blue|yellow|orange|lit|light|stay|goes\s*out)/i,
        /(?:пламя|огонь).*(?:да|нет|голуб|жёлт|гаснет|горит)/i,
        /(?:no|yes)\s*flame/i,
      ],
      howToCheck: "Look through the burner access window. A healthy flame is mostly blue with slight yellow tips.",
    },
    // === NO IGNITION BRANCH (wh_6 → no spark/click) ===
    {
      id: "wh_6a",
      question: "No ignition branch: Is 12V present at the igniter module terminals when attempting ignition?",
      prerequisites: ["wh_6"],
      branchId: "no_ignition",
      matchPatterns: [
        /(?:12v|voltage).*(?:igniter|module|terminal)/i,
        /(?:no|yes)\s*(?:12v|voltage|power)/i,
      ],
      howToCheck: "Measure DC voltage at igniter module while switch is ON. Should see 12V during ignition attempt.",
    },
    {
      id: "wh_6b",
      question: "No ignition branch: Check spark electrode gap and condition. Gap 1/8\" (3mm), clean tip, no cracks?",
      prerequisites: ["wh_6a"],
      branchId: "no_ignition",
      matchPatterns: [
        /(?:electrode|spark|gap).*(?:ok|good|clean|dirty|cracked|worn)/i,
        /(?:\d+(?:\/\d+)?)\s*(?:inch|mm|"|'')/i,
      ],
      howToCheck: "Remove electrode. Check tip for buildup or damage. Gap should be 1/8\" from burner tube.",
    },
    {
      id: "wh_6c",
      question: "No ignition branch: Igniter module ground connection secure? Continuity from module to chassis?",
      prerequisites: ["wh_6a"],
      branchId: "no_ignition",
      matchPatterns: [
        /(?:ground|continuity).*(?:ok|good|bad|loose)/i,
        /(?:no|yes)\s*(?:ground|continuity)/i,
      ],
      howToCheck: "Check wire connection and measure continuity to chassis ground.",
    },
    // === FLAME FAILURE BRANCH (wh_7 → flame goes out) ===
    {
      id: "wh_7a",
      question: "Flame failure branch: How long does flame stay lit before going out? (seconds)",
      prerequisites: ["wh_7"],
      branchId: "flame_failure",
      matchPatterns: [
        /(?:\d+)\s*(?:sec|second)/i,
        /(?:instant|immediate|few|several)/i,
      ],
      howToCheck: "Time from flame ignition to lockout. <10 sec often = flame sensor. >30 sec often = gas supply.",
    },
    {
      id: "wh_7b",
      question: "Flame failure branch: Thermocouple/flame sensor millivolt reading when flame is present?",
      prerequisites: ["wh_7a"],
      branchId: "flame_failure",
      matchPatterns: [
        /(?:\d+)\s*(?:mv|millivolt)/i,
        /(?:no|unable|can't)\s*(?:measure|read)/i,
      ],
      howToCheck: "Measure DC mV across thermocouple leads with flame lit. Need 20-30mV minimum to hold gas valve.",
    },
    {
      id: "wh_7c",
      question: "Flame failure branch: Thermocouple positioning — tip centered in flame path? Not touching burner metal?",
      prerequisites: ["wh_7a"],
      branchId: "flame_failure",
      matchPatterns: [
        /(?:position|centered|tip).*(?:ok|good|yes|no|off|touching)/i,
      ],
      howToCheck: "Thermocouple tip should be in hottest part of flame (1/2\" above burner). Not touching any metal.",
    },
    // === GAS FLOW BRANCH (wh_8 → no gas) ===
    {
      id: "wh_8a",
      question: "No gas flow branch: Is 12V present at gas valve solenoid coil when attempting ignition?",
      prerequisites: ["wh_5"],
      branchId: "no_gas",
      matchPatterns: [
        /(?:12v|voltage).*(?:solenoid|coil|valve)/i,
        /(?:no|yes)\s*(?:12v|voltage|power)/i,
      ],
      howToCheck: "Measure DC voltage across solenoid coil terminals during ignition cycle.",
    },
    {
      id: "wh_8b",
      question: "No gas flow branch: Gas valve solenoid coil resistance? (should be 30-200 ohms)",
      prerequisites: ["wh_8a"],
      branchId: "no_gas",
      matchPatterns: [
        /(?:\d+)\s*(?:ohm|Ω)/i,
        /(?:open|short|infinite|ol)/i,
      ],
      howToCheck: "Disconnect coil wires. Measure resistance across coil terminals. OL = open coil = replace valve.",
    },
    {
      id: "wh_8c",
      question: "No gas flow branch: Manual valve assembly — any debris visible in inlet screen?",
      prerequisites: ["wh_4"],
      branchId: "no_gas",
      matchPatterns: [
        /(?:debris|screen|inlet).*(?:clean|blocked|dirty|clear)/i,
        /(?:no|yes)\s*(?:debris|blockage)/i,
      ],
      howToCheck: "Disconnect gas line at valve inlet. Check inlet screen for debris or corrosion.",
    },
    // === MAIN FLOW CONTINUES (only if branches not triggered) ===
    // Step 8: Gas at valve outlet (triggers no_gas branch)
    {
      id: "wh_8",
      question: "With 12V confirmed at the gas valve solenoid: is gas flowing through? (Brief smell test at burner tube, or manometer reading)",
      prerequisites: ["wh_5"],
      matchPatterns: [
        /(?:gas|smell|flow|odor).*(?:yes|no|present|none)/i,
        /(?:газ|запах).*(?:да|нет|есть)/i,
        /manometer.*(?:\d+|0)/i,
      ],
      howToCheck: "SAFETY: Brief sniff only. If 12V is at valve but no gas flows, valve solenoid may be stuck or failed.",
    },
    // Step 9: Thermocouple/ECO check
    {
      id: "wh_9",
      question: "Thermocouple / flame sensor: Clean and properly positioned in flame path? Millivolt reading when flame present?",
      prerequisites: ["wh_7"],
      matchPatterns: [
        /(?:thermocouple|flame\s*sensor|eco).*(?:clean|dirty|position|mv|millivolt|\d+)/i,
        /(?:термопар|датчик).*(?:чист|грязн|позиц|\d+)/i,
      ],
      howToCheck: "With flame present, measure DC millivolts across thermocouple leads. Should be 20-30mV minimum.",
    },
    // Step 10: Burner/orifice inspection
    {
      id: "wh_10",
      question: "Burner tube and orifice condition: Any blockage, corrosion, insect debris, or damage visible?",
      prerequisites: ["wh_4"],
      matchPatterns: [
        /(?:burner|orifice|tube|nozzle|форсунк|горел).*(?:clean|blocked|clogged|damage|debris|corrosion|insect|spider|обгор|засор|грязн|паук)/i,
        /(?:blockage|засор|debris)/i,
        /(?:clean|clear|good|ok|чист|норм)/i,
      ],
      howToCheck: "Remove burner tube access cover. Look inside with flashlight. Spider webs and mud dauber nests are common blockages.",
    },
    // Step 11: For combo units - electric element check
    {
      id: "wh_11",
      question: "For COMBO units only: Does the electric heating element work? 120V present at element when switch is ON?",
      prerequisites: ["wh_1"],
      matchPatterns: [
        /(?:element|electric|120v|ac).*(?:work|yes|no|voltage|\d+)/i,
        /(?:тэн|электр).*(?:работ|да|нет|напряж)/i,
        /combo.*(?:electric|element)/i,
      ],
      howToCheck: "With electric mode ON, measure 120VAC at the heating element terminals. Element resistance should be 10-16 ohms.",
    },
    // Step 12: High limit / ECO reset
    {
      id: "wh_12",
      question: "Has the high-limit (ECO) reset button been checked/pressed? Located on gas valve or near thermostat.",
      prerequisites: ["wh_5"],
      matchPatterns: [
        /(?:eco|high\s*limit|reset).*(?:press|check|yes|no|trip)/i,
        /(?:кнопк|сброс).*(?:нажа|провер|да|нет)/i,
      ],
      howToCheck: "Find the small red reset button on the gas valve assembly. Press firmly. If it clicks, the ECO had tripped.",
    },
    // === NO 12V SUPPLY BRANCH (wh_5 → no board power) ===
    {
      id: "wh_5a",
      question: "No 12V supply branch: Check the water heater fuse/breaker, battery disconnect, and interior ON/OFF feed. Is battery voltage available upstream of the control board?",
      prerequisites: ["wh_5"],
      branchId: "no_12v_supply",
      matchPatterns: [
        /(?:fuse|breaker|disconnect|switch|feed).*(?:12v|voltage|power|ok|good|bad|open|blown|present|missing)/i,
        /(?:blown|tripped|open)\s*(?:fuse|breaker)/i,
      ],
      howToCheck: "Measure DC voltage on both sides of the water heater fuse/breaker, then at the battery disconnect and interior ON/OFF feed. Battery voltage should be present at each upstream point before the control board.",
    },
    {
      id: "wh_5b",
      question: "No 12V supply branch: Verify ground continuity and inspect wiring/connectors from the fuse/switch path to the control board. Any open, corrosion, or loose connection?",
      prerequisites: ["wh_5a"],
      branchId: "no_12v_supply",
      matchPatterns: [
        /(?:ground|continuity|wiring|wire|connector|splice|corrosion|loose|open).*(?:ok|good|bad|found|yes|no)/i,
        /(?:open|loose|corrosion|burnt|damaged).*(?:wire|wiring|connector|ground|splice)/i,
      ],
      howToCheck: "Check continuity from the board ground to chassis, then inspect the harness, connectors, and splices for corrosion, heat damage, or looseness. Repair any open or high-resistance connection.",
    },
    {
      id: "wh_5c",
      question: "No 12V supply branch: After upstream feed checks or repair, is 12V DC now restored at the water heater control board? Exact reading?",
      prerequisites: ["wh_5b"],
      branchId: "no_12v_supply",
      matchPatterns: [
        /(?:\d+(?:\.\d+)?)\s*v(?:olts?|dc)?/i,
        /(?:restored|back|present|still\s*(?:dead|missing|no)).*(?:12v|voltage|power)/i,
      ],
      howToCheck: "After correcting any fuse, switch, disconnect, ground, or wiring issue, re-measure DC voltage directly at the control-board 12V input. Voltage should be restored before continuing to ignition checks.",
    },
  ],
  // P1.5: Branch definitions
  branches: [
    {
      id: "no_12v_supply",
      displayName: "No 12V Supply",
      triggerStepId: "wh_5",
      triggerPattern: /(?:\b(?:no|without)\b.{0,20}(?:12v|12\s*volt|voltage|dc\s*power|power)|\b0(?:\.0+)?\s*v(?:olts?|dc)?\b|(?:нет|отсутств(?:ует|уют)).{0,20}(?:12\s*в|12v|напряжени|питани)|(?:напряжени|питани).{0,20}(?:нет|отсутств)|^\s*(?:no|nope|nah|нет|неа)\s*[.!?]*\s*$)/i,
      entryStepId: "wh_5a",
      mutuallyExclusive: [],
    },
    {
      id: "no_ignition",
      displayName: "No Ignition / No Spark",
      triggerStepId: "wh_6",
      // English + Russian (нет щелчка/искры/свечения) + Spanish (sin clic/chispa)
      triggerPattern: /(?:no|nothing|none|didn't|doesn't|not|нет|не\s*(?:слышно|слышал|вижу|было|работает|щёлк|щелч|искр|свеч)|sin|no\s+hay).*(?:click|spark|glow|ignit|щелч|искр|свеч|clic|chispa|encend|зажига|розжи|поджи)|(?:не\s+щёлк|не\s+щелч|не\s+искр|не\s+свет|не\s+зажига|не\s+работает\s+поджи)|^\s*(?:no|nope|nah|нет|неа)\s*[.!?]*\s*$/i,
      entryStepId: "wh_6a",
      mutuallyExclusive: ["flame_failure"], // Can't have flame failure if no ignition
    },
    {
      id: "flame_failure",
      displayName: "Flame Lights Then Fails",
      triggerStepId: "wh_7",
      // English + Russian (пламя гаснет/тухнет) + Spanish (llama se apaga)
      triggerPattern: /(?:flame|fire|пламя|огонь|llama|fuego).*(?:goes?\s*out|drops?\s*out|dies|fails?|shuts?\s*off|won'?t\s*stay|гаснет|тухнет|не\s*держится|не\s*горит|гасн|se\s*apaga|se\s*va|apag)|(?:гаснет|тухнет|гасн\w+)\s*(?:пламя|огонь)?/i,
      entryStepId: "wh_7a",
      mutuallyExclusive: ["no_ignition"], // Can't have no ignition if flame lights
    },
    {
      id: "no_gas",
      displayName: "No Gas Flow",
      triggerStepId: "wh_8",
      // English + Russian (нет газа/запаха) + Spanish (sin gas)
      triggerPattern: /(?:no|none|nothing|can'?t\s*smell|нет|не\s*(?:чувств|слышно|идёт|идет|запах)|no\s+hay|sin).*(?:gas|flow|smell|odor|газ|запах|течёт|течет|поступ)|(?:газ\s*не\s*(?:идёт|идет|поступает|чувствуется))/i,
      entryStepId: "wh_8a",
      mutuallyExclusive: [], // Can coexist with other branches
    },
  ],
});

// ── Furnace ─────────────────────────────────────────────────────────

reg({
  system: "furnace",
  displayName: "Furnace",
  complex: true,
  variant: "STANDARD",
  steps: [
    {
      id: "furn_1",
      question: "When furnace calls for heat, does the blower motor attempt to run?",
      prerequisites: [],
      matchPatterns: [/blower.*(?:run|spin|start|attempt|nothing|dead|no)/i, /motor.*(?:run|spin|nothing)/i],
    },
    {
      id: "furn_2",
      question: "Does the igniter glow or spark? What color?",
      prerequisites: ["furn_1"],
      matchPatterns: [/ignit.*(?:glow|spark|orange|red|white|no|nothing)/i],
      howToCheck: "With furnace calling for heat, observe the igniter through the sight glass. Hot surface igniters glow orange/white within 15-30 sec. Spark igniters click rapidly.",
    },
    {
      id: "furn_3",
      question: "Is the gas valve opening? Click and brief gas odor at startup?",
      prerequisites: ["furn_2"],
      matchPatterns: [/gas\s*valve.*(?:open|click|odor|smell|no|nothing)/i, /(?:click|snap)\s*(?:at|when|during)/i],
      howToCheck: "Listen near the gas valve during ignition sequence. You should hear a click when valve opens. Brief gas odor at burner is normal. No click = valve not energizing.",
    },
    {
      id: "furn_4",
      question: "Flame sensor — clean and properly positioned in flame path?",
      prerequisites: ["furn_2"],
      matchPatterns: [/flame\s*sensor.*(?:clean|dirty|position|replaced|check)/i],
      howToCheck: "Remove flame sensor rod. Clean with fine steel wool or emery cloth — no sandpaper. Rod should extend into flame path without touching metal. Reinstall securely.",
    },
    {
      id: "furn_5",
      question: "Error codes on control board? How many LED flashes?",
      prerequisites: [],
      matchPatterns: [/(?:error|fault|code|led|flash|blink).*(?:\d+|no|none)/i],
    },
    {
      id: "furn_6",
      question: "Exhaust vent clear and unobstructed?",
      prerequisites: [],
      matchPatterns: [/exhaust.*(?:clear|blocked|obstruct|clean)/i, /vent.*(?:clear|blocked)/i],
    },
    {
      id: "furn_7",
      question: "Limit switch — tripped? Try resetting.",
      prerequisites: ["furn_1"],
      matchPatterns: [/limit\s*switch.*(?:trip|reset|ok|good)/i],
      howToCheck: "Locate the high-limit switch on the furnace plenum or heat exchanger. Press the reset button firmly. If it clicks, the limit had tripped due to overheat condition.",
    },
    {
      id: "furn_8",
      question: "Sail switch functioning? Blower creating enough airflow?",
      prerequisites: ["furn_1"],
      matchPatterns: [/sail\s*switch/i, /airflow.*(?:enough|good|poor|weak)/i],
      howToCheck: "The sail switch closes when blower airflow is adequate. Check that blower runs at full speed. Blocked return air or dirty filters cause low airflow and sail switch issues.",
    },
    {
      id: "furn_9",
      question: "LP tank valve open and tank not empty?",
      prerequisites: [],
      matchPatterns: [/(?:lp|propane|gas)\s*tank.*(?:open|full|empty|level)/i],
    },
    {
      id: "furn_10",
      question: "All wire connections secure on control board and components?",
      prerequisites: [],
      matchPatterns: [/wire.*(?:secure|loose|connection|tight)/i, /control\s*board.*(?:connection|wire)/i],
    },
  ],
});

// ── Roof AC / Heat Pump ─────────────────────────────────────────────

reg({
  system: "roof_ac",
  displayName: "Roof AC / Heat Pump",
  complex: true,
  variant: "STANDARD",
  steps: [
    {
      id: "ac_1",
      question: "When AC is turned on, does the compressor attempt to start? Humming, clicking, or buzzing from outside unit?",
      prerequisites: [],
      matchPatterns: [/compressor.*(?:start|hum|click|buzz|nothing|no|dead)/i],
    },
    {
      id: "ac_2",
      question: "Is the indoor blower fan running? Any airflow from vents?",
      prerequisites: [],
      matchPatterns: [/(?:indoor\s*)?(?:blower|fan).*(?:run|airflow|yes|no|nothing)/i, /(?:no|yes)\s*airflow/i],
    },
    {
      id: "ac_3",
      question: "Is the outdoor condenser fan running? Spinning freely or struggling?",
      prerequisites: [],
      matchPatterns: [/(?:outdoor|condenser)\s*fan.*(?:run|spin|struggle|no|dead)/i],
    },
    {
      id: "ac_4",
      question: "Thermostat settings — set to COOL mode, temperature below current room temp?",
      prerequisites: [],
      matchPatterns: [/thermostat.*(?:cool|set|temp|below|correct)/i],
    },
    {
      id: "ac_5",
      question: "Check capacitor visually — any bulging, leaking, or burn marks?",
      prerequisites: ["ac_1"],
      matchPatterns: [/capacitor.*(?:bulg|leak|burn|ok|good|visual)/i],
    },
    {
      id: "ac_6",
      question: "Voltage at compressor terminals? Within spec?",
      prerequisites: ["ac_1"],
      matchPatterns: [/(?:compressor\s*)?(?:voltage|terminal).*(?:\d+|spec|within|low|high)/i],
    },
    {
      id: "ac_7",
      question: "Contactor — does it engage (click) when AC is called? Contact points burnt or pitted?",
      prerequisites: ["ac_1"],
      matchPatterns: [/contactor.*(?:click|engage|burnt|pitted|ok|good)/i],
    },
    {
      id: "ac_8",
      question: "Air filters clean? Return air path unobstructed?",
      prerequisites: [],
      matchPatterns: [/filter.*(?:clean|dirty|clogged|replaced|ok)/i, /return\s*air/i],
    },
    {
      id: "ac_9",
      question: "Evaporator coils — frozen or excessively dirty?",
      prerequisites: ["ac_2"],
      matchPatterns: [/evaporator.*(?:frozen|dirty|ice|clean|ok)/i, /coil.*(?:frozen|ice|dirty)/i],
    },
    {
      id: "ac_10",
      question: "Error codes or fault lights on the control board?",
      prerequisites: [],
      matchPatterns: [/(?:error|fault|code|led|light).*(?:\d+|no|none|blink)/i],
    },
  ],
});

// ── Refrigerator ────────────────────────────────────────────────────

reg({
  system: "refrigerator",
  displayName: "Refrigerator",
  complex: true,
  variant: "STANDARD",
  steps: [
    {
      id: "ref_1",
      question: "Refrigerator completely dead, or powers on but not cooling?",
      prerequisites: [],
      matchPatterns: [/(?:dead|no\s*power|powers?\s*on|not\s*cool|warm)/i],
    },
    {
      id: "ref_2",
      question: "What power mode — LP gas, 120V AC, or 12V DC?",
      prerequisites: ["ref_1"],
      matchPatterns: [/(?:lp|gas|propane|120v|ac|12v|dc|electric)/i],
    },
    {
      id: "ref_3",
      question: "If on LP gas — igniter clicking? Visible flame?",
      prerequisites: ["ref_2"],
      matchPatterns: [/(?:igniter|flame|click|spark|gas).*(?:yes|no|visible)/i],
    },
    {
      id: "ref_4",
      question: "If on 120V AC — power reaching heating element? Voltage?",
      prerequisites: ["ref_2"],
      matchPatterns: [/(?:120v|element|heating|voltage).*(?:\d+|yes|no|present)/i],
    },
    {
      id: "ref_5",
      question: "Cooling unit hot at the back? Feel the absorber area.",
      prerequisites: ["ref_1"],
      matchPatterns: [/(?:cooling\s*unit|absorber|back).*(?:hot|warm|cold|cool|nothing)/i],
    },
    {
      id: "ref_6",
      question: "Thermistor reading — what temperature?",
      prerequisites: ["ref_1"],
      matchPatterns: [/thermistor.*(?:\d+|reading|temp)/i],
    },
    {
      id: "ref_7",
      question: "Ventilation adequate? Roof vent and lower vent clear?",
      prerequisites: [],
      matchPatterns: [/vent.*(?:clear|blocked|adequate|ok)/i],
    },
    {
      id: "ref_8",
      question: "RV level? Absorption refrigerators need to be level.",
      prerequisites: [],
      matchPatterns: [/level.*(?:yes|no|ok|tilted|parked)/i],
    },
    {
      id: "ref_9",
      question: "Ammonia smell near the refrigerator?",
      prerequisites: [],
      matchPatterns: [/ammonia.*(?:smell|odor|yes|no|none)/i],
    },
    {
      id: "ref_10",
      question: "Control board error codes or fault indicators?",
      prerequisites: [],
      matchPatterns: [/(?:error|fault|code|indicator).*(?:\d+|no|none)/i],
    },
  ],
});

// ── Slide-Out ───────────────────────────────────────────────────────

reg({
  system: "slide_out",
  displayName: "Slide-Out System",
  complex: true,
  variant: "STANDARD",
  steps: [
    { id: "so_1", question: "When slide-out is activated, motor running? Any noise?", prerequisites: [], matchPatterns: [/(?:slide|motor).*(?:run|noise|nothing|dead|hum)/i] },
    { id: "so_2", question: "If motor runs, does slide move at all? In or out?", prerequisites: ["so_1"], matchPatterns: [/slide.*(?:move|stuck|partial|in|out|no)/i] },
    { id: "so_3", question: "Apply 12V directly to motor terminals — motor operates when powered directly?", prerequisites: ["so_1"], matchPatterns: [/(?:direct|12v|motor).*(?:operate|run|work|no|yes)/i] },
    { id: "so_4", question: "Gear mechanism engaged properly? Stripped or missing teeth?", prerequisites: ["so_2"], matchPatterns: [/gear.*(?:engaged|stripped|teeth|ok|miss)/i] },
    { id: "so_5", question: "Controller sending signal? Voltage at motor connector when activated?", prerequisites: ["so_1"], matchPatterns: [/controller.*(?:signal|voltage|\d+|yes|no)/i] },
    { id: "so_6", question: "Obstructions in slide track? Debris or bent rails?", prerequisites: [], matchPatterns: [/(?:obstruct|debris|bent|track|rail).*(?:yes|no|clear)/i] },
    { id: "so_7", question: "Synchronization — for dual-motor slides, both sides equal?", prerequisites: ["so_2"], matchPatterns: [/(?:sync|dual|both\s*sides?).*(?:equal|uneven|ok)/i] },
    { id: "so_8", question: "Slide room seal causing excessive drag?", prerequisites: [], matchPatterns: [/seal.*(?:drag|tight|ok|damage)/i] },
  ],
});

// ── Leveling / Jacks ────────────────────────────────────────────────

reg({
  system: "leveling",
  displayName: "Leveling / Jack System",
  complex: true,
  variant: "STANDARD",
  steps: [
    { id: "lv_1", question: "When leveling system is activated, pump motor running?", prerequisites: [], matchPatterns: [/(?:pump|motor).*(?:run|nothing|dead|hum)/i] },
    { id: "lv_2", question: "Jacks extending/retracting, or completely unresponsive?", prerequisites: ["lv_1"], matchPatterns: [/jack.*(?:extend|retract|unresponsive|stuck|nothing)/i] },
    { id: "lv_3", question: "Hydraulic fluid level in reservoir — proper level?", prerequisites: [], matchPatterns: [/(?:hydraulic|fluid|reservoir).*(?:level|low|full|ok)/i] },
    { id: "lv_4", question: "Any visible hydraulic leaks at jacks, lines, or fittings?", prerequisites: [], matchPatterns: [/(?:hydraulic\s*)?leak.*(?:yes|no|visible|none)/i] },
    { id: "lv_5", question: "Error codes or lights on leveling control panel?", prerequisites: [], matchPatterns: [/(?:error|code|light|panel).*(?:\d+|no|none|blink)/i] },
    { id: "lv_6", question: "Manual override working? Can you extend/retract jacks manually?", prerequisites: ["lv_2"], matchPatterns: [/manual.*(?:override|work|extend|retract|yes|no)/i] },
    { id: "lv_7", question: "Pump building adequate pressure?", prerequisites: ["lv_1"], matchPatterns: [/(?:pump|pressure).*(?:adequate|low|good|build)/i] },
    { id: "lv_8", question: "All solenoid valves clicking when jacks are commanded?", prerequisites: ["lv_1"], matchPatterns: [/solenoid.*(?:click|valve|yes|no)/i] },
    { id: "lv_9", question: "Battery voltage sufficient?", prerequisites: [], matchPatterns: [/battery.*(?:voltage|sufficient|\d+|low|ok)/i] },
    { id: "lv_10", question: "Ground connections at pump and control unit?", prerequisites: [], matchPatterns: [/ground.*(?:connect|pump|control|ok|good)/i] },
  ],
});

// ── Inverter / Converter ────────────────────────────────────────────

reg({
  system: "inverter_converter",
  displayName: "Inverter / Converter",
  complex: true,
  variant: "STANDARD",
  steps: [
    { id: "ic_1", question: "Inverter/converter completely dead, or showing power but not functioning correctly?", prerequisites: [], matchPatterns: [/(?:dead|power|function|not\s*working)/i] },
    { id: "ic_2", question: "DC input voltage from batteries? Should be 12V-14V.", prerequisites: ["ic_1"], matchPatterns: [/(?:dc|battery|input).*(?:voltage|\d+)/i] },
    { id: "ic_3", question: "If inverter — AC output voltage? Should be approximately 120V.", prerequisites: ["ic_1"], matchPatterns: [/(?:ac\s*output|120v|inverter).*(?:voltage|\d+|no|present)/i] },
    { id: "ic_4", question: "If converter — DC charging voltage? Should be 13.6V-14.4V.", prerequisites: ["ic_1"], matchPatterns: [/(?:charging|converter|dc\s*output).*(?:voltage|\d+)/i] },
    { id: "ic_5", question: "Error lights or fault codes?", prerequisites: [], matchPatterns: [/(?:error|fault|code|light).*(?:\d+|no|none|blink)/i] },
    { id: "ic_6", question: "Cooling fan running? Any overheating?", prerequisites: ["ic_1"], matchPatterns: [/(?:fan|cooling|overheat).*(?:run|hot|yes|no)/i] },
    { id: "ic_7", question: "Load on system? Overloaded?", prerequisites: ["ic_1"], matchPatterns: [/(?:load|overload).*(?:yes|no|heavy|normal)/i] },
    { id: "ic_8", question: "All connections — DC input, AC output, ground?", prerequisites: [], matchPatterns: [/connection.*(?:tight|loose|good|ok|secure)/i] },
    { id: "ic_9", question: "Batteries in good condition? Individual battery voltage?", prerequisites: ["ic_2"], matchPatterns: [/batter.*(?:condition|good|bad|\d+|volt)/i] },
    { id: "ic_10", question: "Transfer switch functioning correctly?", prerequisites: [], matchPatterns: [/transfer\s*switch.*(?:function|work|ok|yes|no)/i] },
  ],
});

// ── 12V Electrical ──────────────────────────────────────────────────

reg({
  system: "electrical_12v",
  displayName: "12V Electrical System",
  complex: false,
  variant: "STANDARD",
  steps: [
    {
      id: "e12_1",
      question: "Is 12V DC supply present at the main distribution panel / battery disconnect? Measure battery voltage.",
      prerequisites: [],
      matchPatterns: [/(?:battery|supply|panel|disconnect).*(?:\d+|present|ok|dead|no\s*power)/i, /(?:\d+(?:\.\d+)?)\s*v/i],
      howToCheck: "Set multimeter to DC volts (20V range). Measure across battery terminals or main 12V bus at the distribution panel. Expected: 12.4V–12.8V (resting) or 13.6V–14.4V (charging).",
    },
    {
      id: "e12_2",
      question: "Check the circuit breaker or fuse for this circuit. Intact and properly seated? Any signs of tripping or burn marks?",
      prerequisites: [],
      matchPatterns: [/(?:breaker|fuse).*(?:intact|trip|burn|ok|blown|good|bad)/i],
      howToCheck: "Locate the fuse/breaker for this circuit in the 12V panel. Visually inspect for discoloration or a broken element. Use a multimeter on continuity mode across the fuse — it should beep. If a breaker, toggle off then back on.",
    },
    {
      id: "e12_3",
      question: "Is the switch or control for this circuit functioning properly? Does it click or change state?",
      prerequisites: ["e12_2"],
      matchPatterns: [/switch.*(?:function|work|ok|yes|no|click)/i, /control.*(?:work|ok|function)/i],
      howToCheck: "Toggle the switch while measuring voltage on the output side. You should see 12V appear/disappear. If no change, the switch contacts may be corroded or open.",
    },
    {
      id: "e12_4",
      question: "Verify ground continuity between the component housing and chassis. Clean and secure?",
      prerequisites: ["e12_2"],
      matchPatterns: [/ground.*(?:good|ok|clean|continu|secure)/i, /(?:no|bad|poor)\s*ground/i, /(?:\d+(?:\.\d+)?)\s*ohm/i],
      howToCheck: "Set multimeter to continuity/ohms. Place one probe on the component's ground terminal and the other on a known-good chassis ground point. Should read < 0.5 ohm.",
    },
    {
      id: "e12_5",
      question: "Measure voltage at the component terminals with the switch ON. Is 12V DC present? Exact reading?",
      prerequisites: ["e12_3", "e12_4"],
      matchPatterns: [/(?:\d+(?:\.\d+)?)\s*v(?:olts?|dc)?/i, /(?:no\s*)?(?:voltage|power)/i],
      howToCheck: "With the switch ON, measure DC voltage directly at the component's power and ground terminals. Expected: within 0.5V of battery voltage.",
    },
    {
      id: "e12_6",
      question: "Apply 12V directly to the component (bypass switch and wiring). Does it operate?",
      prerequisites: ["e12_5"],
      matchPatterns: [/(?:direct|bypass|jump).*(?:operate|run|work|yes|no|nothing)/i, /(?:motor|component).*(?:run|spin|work|dead)/i],
      howToCheck: "Disconnect the component from vehicle wiring. Using jumper wires from the battery (with an inline fuse), connect +12V and ground directly to the component terminals. If it runs, the component is good — fault is upstream.",
    },
    {
      id: "e12_7",
      question: "Any visible signs of damaged wiring, loose connections, or corrosion?",
      prerequisites: [],
      matchPatterns: [/(?:wiring|connection|corrosion).*(?:damage|loose|ok|good|clean)/i],
      howToCheck: "Visually trace the wiring from the panel to the component. Look for chafed insulation, green/white corrosion on terminals, melted connectors, loose spade terminals.",
    },
  ],
});

// ── Awning (12V Electric) ───────────────────────────────────────────

reg({
  system: "awning",
  displayName: "Electric Awning (12V)",
  complex: false,
  variant: "STANDARD",
  steps: [
    {
      id: "awn_1",
      question: "Is 12V DC supply present at the battery / main panel? Battery voltage reading?",
      prerequisites: [],
      matchPatterns: [/(?:battery|supply|panel|12v).*(?:\d+|present|ok|dead|no\s*power)/i, /(?:\d+(?:\.\d+)?)\s*v/i],
      howToCheck: "Measure DC voltage across battery terminals. Expected: 12.4–12.8V resting, 13.6–14.4V charging.",
    },
    {
      id: "awn_2",
      question: "Is the awning fuse or circuit breaker intact? Any signs of tripping or burn?",
      prerequisites: [],
      matchPatterns: [/(?:fuse|breaker).*(?:intact|trip|burn|ok|blown|good|bad)/i],
      howToCheck: "Locate the awning fuse in the 12V panel (typically 15–20A). Check continuity across the fuse with a multimeter — it should beep. If blown, replace with the same rated fuse.",
    },
    {
      id: "awn_3",
      question: "Does the awning switch or control respond? Click or state change when pressed?",
      prerequisites: ["awn_2"],
      matchPatterns: [/switch.*(?:click|work|respond|yes|no|nothing)/i, /control.*(?:work|respond|yes|no)/i, /button.*(?:press|click|nothing)/i],
      howToCheck: "Press the extend/retract button while listening for a relay click. If using a wall switch, measure voltage on the output side while toggling. No voltage change = switch fault.",
    },
    {
      id: "awn_4",
      question: "Verify ground continuity between the awning motor housing and chassis. Clean and secure?",
      prerequisites: ["awn_2"],
      matchPatterns: [/ground.*(?:good|ok|clean|continu|secure)/i, /(?:no|bad|poor)\s*ground/i],
      howToCheck: "Multimeter on continuity. One probe on the motor housing or ground wire, other on a known chassis ground. Should read < 0.5 ohm.",
    },
    {
      id: "awn_5",
      question: "Measure voltage at the awning motor terminals with the switch activated. Is 12V DC present?",
      prerequisites: ["awn_3", "awn_4"],
      matchPatterns: [/(?:motor\s*)?(?:terminal|voltage).*(?:\d+|present|no|yes)/i, /(?:\d+(?:\.\d+)?)\s*v/i],
      howToCheck: "With the switch pressed (extend direction), measure DC voltage at the motor connector. Expected: battery voltage (±0.5V). 0V at motor but 12V at switch = open wiring.",
    },
    {
      id: "awn_6",
      question: "Apply 12V directly to the awning motor (bypass switch and wiring). Does the motor operate?",
      prerequisites: ["awn_5"],
      matchPatterns: [/(?:direct|bypass|jump).*(?:operate|run|work|yes|no|nothing)/i, /motor.*(?:run|spin|work|dead|seized)/i],
      howToCheck: "Disconnect the motor connector. Using jumper wires from the battery (with a 20A inline fuse), connect +12V and ground directly to the motor. Reverse polarity to test both directions. Motor runs = fault is upstream. Motor dead = motor failure confirmed.",
    },
  ],
});

// ── AC Electrical ───────────────────────────────────────────────────

reg({
  system: "electrical_ac",
  displayName: "AC Electrical (120V)",
  complex: false,
  variant: "STANDARD",
  steps: [
    { id: "eac_1", question: "Check the outlet with a multimeter or tester. Is 120V AC present? Reading?", prerequisites: [], matchPatterns: [/(?:outlet|120v|ac).*(?:present|\d+|reading|no\s*power)/i] },
    { id: "eac_2", question: "Check the GFCI and breaker. ON position? Try resetting.", prerequisites: [], matchPatterns: [/(?:gfci|breaker).*(?:on|trip|reset|ok)/i] },
    { id: "eac_3", question: "Measure voltage at component terminals. Power reaching the unit?", prerequisites: ["eac_1"], matchPatterns: [/(?:terminal|component).*(?:voltage|power|\d+|reach)/i] },
    { id: "eac_4", question: "Any tripped indicators, burn marks, or unusual smells?", prerequisites: [], matchPatterns: [/(?:trip|burn|smell).*(?:yes|no|indicator|mark)/i] },
    { id: "eac_5", question: "All wire connections tight and secure at outlet and panel?", prerequisites: [], matchPatterns: [/(?:wire|connection).*(?:tight|secure|loose|ok)/i] },
  ],
});

// ── Consumer Appliance ──────────────────────────────────────────────

reg({
  system: "consumer_appliance",
  displayName: "Consumer Appliance",
  complex: false,
  variant: "STANDARD",
  steps: [
    { id: "ca_1", question: "Does the unit power on at all? Any indicator lights or display?", prerequisites: [], matchPatterns: [/(?:power|light|display|indicator).*(?:on|off|yes|no|nothing)/i] },
    { id: "ca_2", question: "Voltage at the outlet supplying the unit? 120V AC present?", prerequisites: [], matchPatterns: [/(?:outlet|120v|voltage).*(?:present|\d+|ok|no)/i] },
    { id: "ca_3", question: "Any output from the unit (picture, sound, heat)? Or powers on with no function?", prerequisites: ["ca_1"], matchPatterns: [/(?:output|picture|sound|heat|function).*(?:yes|no|nothing|none)/i] },
    { id: "ca_4", question: "Any visible damage, burn marks, or unusual smells from the unit?", prerequisites: ["ca_1"], matchPatterns: [/(?:damage|burn|smell).*(?:yes|no|visible)/i] },
  ],
});

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get the diagnostic procedure for a system.
 * Returns a default generic procedure if system is unknown.
 */
export function getProcedure(system: string): DiagnosticProcedure | null {
  return PROCEDURES.get(system) ?? null;
}

/**
 * Get the list of all registered systems.
 */
export function getRegisteredSystems(): string[] {
  return [...PROCEDURES.keys()];
}

/**
 * Get the next valid step in a procedure, considering completed and unable-to-verify steps.
 * Returns null if all steps are done or unreachable.
 * 
 * IMPORTANT: This is the LEGACY flat function. For branch-aware step resolution,
 * use getNextStepBranchAware() which considers active branch state.
 */
export function getNextStep(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
): DiagnosticStep | null {
  const doneOrSkipped = new Set([...completedIds, ...unableIds]);

  for (const step of procedure.steps) {
    if (doneOrSkipped.has(step.id)) continue;
    if (step.branchId) continue;

    // Check prerequisites: all must be completed or unable-to-verify
    const prereqsMet = step.prerequisites.every((p) => doneOrSkipped.has(p));
    if (prereqsMet) return step;
  }

  return null;
}

/**
 * Branch-aware step resolution (P1.5)
 * 
 * Rules:
 * 1. If activeBranchId is set, ONLY steps in that branch are considered
 * 2. If no active branch, only main-flow steps (branchId undefined) are considered
 * 3. Locked-out branches are excluded entirely
 * 4. Prerequisites must still be met
 * 
 * @param procedure - The diagnostic procedure
 * @param completedIds - Steps that have been completed
 * @param unableIds - Steps that cannot be verified
 * @param activeBranchId - Currently active branch (null = main flow)
 * @param lockedOutBranches - Branches that can no longer be entered
 */
export function getNextStepBranchAware(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
  activeBranchId: string | null,
  lockedOutBranches: Set<string>,
): DiagnosticStep | null {
  const doneOrSkipped = new Set([...completedIds, ...unableIds]);

  for (const step of procedure.steps) {
    if (doneOrSkipped.has(step.id)) continue;

    // Branch filtering
    const stepBranch = step.branchId ?? null;
    
    if (activeBranchId !== null) {
      // We're in a branch — only consider steps in THIS branch
      if (stepBranch !== activeBranchId) continue;
    } else {
      // We're in main flow — ONLY consider main-flow steps.
      // Branch steps are entered EXCLUSIVELY via processResponseForBranch() trigger,
      // never by falling through from step eligibility alone.
      // This prevents accidental branch entry and ensures distinct step-ID identity.
      if (stepBranch !== null) continue;
    }

    // Check prerequisites: all must be completed or unable-to-verify
    const prereqsMet = step.prerequisites.every((p) => doneOrSkipped.has(p));
    if (prereqsMet) return step;
  }

  return null;
}

/**
 * Detect if a technician response triggers a branch.
 * 
 * @returns The branch to enter, or null if no branch is triggered
 */
export function detectBranchTrigger(
  procedure: DiagnosticProcedure,
  stepId: string,
  technicianResponse: string,
): ProcedureBranch | null {
  if (!procedure.branches) return null;
  
  for (const branch of procedure.branches) {
    if (branch.triggerStepId !== stepId) continue;
    if (branch.triggerPattern.test(technicianResponse)) {
      return branch;
    }
  }
  
  return null;
}

/**
 * Get branches that would be locked out if a given branch is entered.
 */
export function getMutuallyExclusiveBranches(
  procedure: DiagnosticProcedure,
  branchId: string,
): string[] {
  const branch = procedure.branches?.find(b => b.id === branchId);
  return branch?.mutuallyExclusive ?? [];
}

/**
 * Parse the technician's initial message and map to completed steps.
 * Only maps steps where the match is unambiguous (at least one matchPattern hits).
 *
 * Returns the set of step IDs that can be marked as completed.
 */
export function mapInitialMessageToSteps(
  message: string,
  procedure: DiagnosticProcedure,
): string[] {
  const completed: string[] = [];

  for (const step of procedure.steps) {
    if (step.matchPatterns.some((p) => p.test(message))) {
      completed.push(step.id);
    }
  }

  return completed;
}

/**
 * Get the how-to-check instruction for a specific step.
 * Returns null if the step has no instruction or the step is not found.
 */
export function getStepHowToCheck(
  procedure: DiagnosticProcedure,
  stepId: string,
): string | null {
  const step = procedure.steps.find((s) => s.id === stepId);
  return step?.howToCheck ?? null;
}

/**
 * Build a procedure context string for prompt injection.
 * 
 * AUTHORITATIVE MODE: When activeStepId is provided, only the active step
 * question is sent to the LLM. The LLM's role is to render the question,
 * not to decide which step comes next.
 */
export function buildProcedureContext(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
  options?: { howToCheckRequested?: boolean; activeStepId?: string | null; language?: Language },
): string {
  const totalSteps = procedure.steps.length;
  const doneCount = completedIds.size + unableIds.size;
  const language = options?.language ?? "EN";

  // --- Authoritative mode: only show the active step ---
  if (options?.activeStepId) {
    const activeStep = procedure.steps.find(s => s.id === options.activeStepId);
    if (!activeStep) {
      // Step ID mismatch — fall back to computed next step
      const nextStep = getNextStep(procedure, completedIds, unableIds);
      if (!nextStep) {
        return buildAllCompleteContext(procedure, doneCount, totalSteps, language);
      }
      return buildActiveStepContext(procedure, nextStep, doneCount, totalSteps, options);
    }
    return buildActiveStepContext(procedure, activeStep, doneCount, totalSteps, options);
  }

  // --- No active step: check if all main-flow steps are done ---
  const nextStep = getNextStep(procedure, completedIds, unableIds);
  if (!nextStep) {
    return buildAllCompleteContext(procedure, doneCount, totalSteps, language);
  }

  // Fallback: show the computed next step (should not happen in authoritative mode)
  return buildActiveStepContext(procedure, nextStep, doneCount, totalSteps, options);
}

function buildActiveStepContext(
  procedure: DiagnosticProcedure,
  step: DiagnosticStep,
  doneCount: number,
  totalSteps: number,
  options?: { howToCheckRequested?: boolean; language?: Language },
): string {
  const language = options?.language ?? "EN";
  const labels = getProcedureContextLabels(language);
  const localizedProcedureName = getLocalizedProcedureDisplayName(procedure, language);
  const localizedQuestion = getLocalizedStepQuestion(procedure, step, language);
  const localizedHowToCheck = getLocalizedStepHowToCheck(procedure, step, language);

  const lines: string[] = [
    `${labels.activeProcedure}: ${localizedProcedureName} (${procedure.variant})`,
    labels.progress(doneCount, totalSteps),
    "",
    `${labels.currentStep}: ${step.id}`,
    `${labels.askExactly}: "${localizedQuestion}"`,
  ];

  // If technician asked "how to check?" — provide the instruction and re-ask
  if (options?.howToCheckRequested && localizedHowToCheck) {
    lines.push("");
    lines.push(`${labels.howToCheckHeader}:`);
    lines.push(localizedHowToCheck);
    lines.push("");
    lines.push("After providing this instruction, re-ask the SAME step for the result.");
    lines.push("Do NOT close this step. Do NOT advance to the next step.");
  }

  lines.push("");
  lines.push("RULES:");
  lines.push("- Ask ONLY the question above. Do NOT skip ahead or go back.");
  lines.push("- Do NOT invent diagnostic steps outside this procedure.");
  lines.push("- Do NOT list completed steps or remaining steps.");
  lines.push("- Do NOT ask about systems other than " + localizedProcedureName + ".");
  lines.push("- Any user-facing label or quoted procedure text MUST be rendered in the session language.");
  lines.push("- Render the question in the session language. Do NOT switch languages.");

  return lines.join("\n");
}

function buildAllCompleteContext(
  procedure: DiagnosticProcedure,
  doneCount: number,
  totalSteps: number,
  language: Language = "EN",
): string {
  const labels = getProcedureContextLabels(language);
  const localizedProcedureName = getLocalizedProcedureDisplayName(procedure, language);
  const lines: string[] = [
    `${labels.activeProcedure}: ${localizedProcedureName} (${procedure.variant})`,
    labels.progress(doneCount, totalSteps),
    "",
    labels.allStepsComplete,
    labels.completionSummary,
    labels.completionWait,
  ];
  return lines.join("\n");
}
