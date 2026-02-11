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
};

// ── System Detection ────────────────────────────────────────────────

const SYSTEM_PATTERNS: Array<{ system: string; patterns: RegExp[] }> = [
  { system: "water_pump", patterns: [/water\s*pump/i, /водяно[йе]\s*насос/i, /bomba\s*de\s*agua/i, /fresh\s*water\s*pump/i] },
  { system: "furnace", patterns: [/furnace/i, /heater(?!\s*pump)/i, /печ[ьк]/i, /калориф/i, /horno/i, /calefacc/i] },
  { system: "roof_ac", patterns: [/(?:roof\s*)?(?:ac|a\/c|air\s*condition)/i, /(?:heat\s*pump)/i, /кондицион/i, /aire\s*acondicionado/i] },
  { system: "refrigerator", patterns: [/refrig/i, /fridge/i, /холодильник/i, /refrigerador/i, /nevera/i] },
  { system: "slide_out", patterns: [/slide[\s-]*out/i, /слайд/i, /slide\s*room/i] },
  { system: "leveling", patterns: [/level(?:ing|er)?\s*(?:system|jack)/i, /jack\s*system/i, /выравнива/i, /nivelaci/i] },
  { system: "inverter_converter", patterns: [/inverter/i, /converter/i, /инвертер|инвертор|конвертер|конвертор/i] },
  { system: "lp_gas", patterns: [/lp\s*gas|propane|gas\s*(?:system|leak|line|valve|regulator|furnace)/i, /газ(?:ов)?/i, /gas\s*(?:lp|propano)/i] },
  { system: "electrical_ac", patterns: [/(?:120v|110v|ac)\s*(?:outlet|circuit|power|electrical)/i, /gfci/i, /outlet/i, /розетк/i] },
  { system: "electrical_12v", patterns: [/12v|12\s*volt|dc\s*(?:power|circuit|system)/i, /(?:light|fan|vent)\s*(?:not|won't|doesn't|don't)/i] },
  { system: "consumer_appliance", patterns: [/(?:tv|television|microwave|stereo|radio|dvd|blu[\s-]*ray)/i, /телевизор|микроволнов/i] },
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
    },
    {
      id: "lpg_3",
      question: "Gas leak detector applied at all connections from tank to appliance? Any bubbles or detector alerts?",
      prerequisites: ["lpg_1"],
      matchPatterns: [/(?:no|yes)\s*(?:leak|bubble)/i, /leak.*(?:test|detect|check)/i, /(?:clean|good|tight)\s*(?:connection|fitting)/i],
    },
    {
      id: "lpg_4",
      question: "Manual gas valve at the appliance — open? Verify gas flow reaches the appliance.",
      prerequisites: ["lpg_2"],
      matchPatterns: [/manual\s*(?:gas\s*)?valve.*(?:open|closed)/i, /gas.*(?:reach|flow|present)/i],
    },
    {
      id: "lpg_5",
      question: "Ignition sequence — does the igniter activate (spark or glow)? Timing correct?",
      prerequisites: ["lpg_4"],
      matchPatterns: [/ignit.*(?:spark|glow|work|fire|activate)/i, /(?:no|yes)\s*(?:spark|ignition)/i],
    },
    {
      id: "lpg_6",
      question: "Flame present after ignition? Color and stability? Blue and steady?",
      prerequisites: ["lpg_5"],
      matchPatterns: [/flame.*(?:present|blue|yellow|steady|unstable|no|none)/i, /(?:no|yes)\s*flame/i],
    },
    {
      id: "lpg_7",
      question: "Flame sensor / thermocouple — clean and positioned in flame path? Voltage reading?",
      prerequisites: ["lpg_6"],
      matchPatterns: [/(?:flame\s*sensor|thermocouple).*(?:clean|dirty|position|mv|millivolt|\d+)/i],
    },
    {
      id: "lpg_8",
      question: "Control board error codes or fault indicators? LED status?",
      prerequisites: [],
      matchPatterns: [/(?:error|fault|code|led|blink|flash)/i],
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
    },
    {
      id: "furn_3",
      question: "Is the gas valve opening? Click and brief gas odor at startup?",
      prerequisites: ["furn_2"],
      matchPatterns: [/gas\s*valve.*(?:open|click|odor|smell|no|nothing)/i, /(?:click|snap)\s*(?:at|when|during)/i],
    },
    {
      id: "furn_4",
      question: "Flame sensor — clean and properly positioned in flame path?",
      prerequisites: ["furn_2"],
      matchPatterns: [/flame\s*sensor.*(?:clean|dirty|position|replaced|check)/i],
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
    },
    {
      id: "furn_8",
      question: "Sail switch functioning? Blower creating enough airflow?",
      prerequisites: ["furn_1"],
      matchPatterns: [/sail\s*switch/i, /airflow.*(?:enough|good|poor|weak)/i],
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
    { id: "e12_1", question: "Check the circuit breaker or fuse. Intact and properly seated? Any signs of tripping or burn marks?", prerequisites: [], matchPatterns: [/(?:breaker|fuse).*(?:intact|trip|burn|ok|blown)/i] },
    { id: "e12_2", question: "Measure voltage at the component terminals. Is 12V DC present? Exact reading?", prerequisites: ["e12_1"], matchPatterns: [/(?:\d+(?:\.\d+)?)\s*v/i, /(?:no\s*)?(?:voltage|power)/i] },
    { id: "e12_3", question: "Verify ground continuity. Clean and secure?", prerequisites: ["e12_1"], matchPatterns: [/ground.*(?:good|ok|clean|continu)/i, /(?:no|bad)\s*ground/i] },
    { id: "e12_4", question: "Any visible signs of damaged wiring, loose connections, or corrosion?", prerequisites: [], matchPatterns: [/(?:wiring|connection|corrosion).*(?:damage|loose|ok|good|clean)/i] },
    { id: "e12_5", question: "Is the switch or control functioning properly?", prerequisites: [], matchPatterns: [/switch.*(?:function|work|ok|yes|no)/i, /control.*(?:work|ok|function)/i] },
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
 */
export function getNextStep(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
): DiagnosticStep | null {
  const doneOrSkipped = new Set([...completedIds, ...unableIds]);

  for (const step of procedure.steps) {
    if (doneOrSkipped.has(step.id)) continue;

    // Check prerequisites: all must be completed or unable-to-verify
    const prereqsMet = step.prerequisites.every((p) => doneOrSkipped.has(p));
    if (prereqsMet) return step;
  }

  return null;
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
 * Build a procedure context string for prompt injection.
 * Shows the active procedure, completed steps, and the next step.
 */
export function buildProcedureContext(
  procedure: DiagnosticProcedure,
  completedIds: Set<string>,
  unableIds: Set<string>,
): string {
  const nextStep = getNextStep(procedure, completedIds, unableIds);
  const totalSteps = procedure.steps.length;
  const doneCount = completedIds.size + unableIds.size;

  const lines: string[] = [
    `ACTIVE DIAGNOSTIC PROCEDURE: ${procedure.displayName} (${procedure.variant})`,
    `System complexity: ${procedure.complex ? "COMPLEX — thorough diagnosis required" : "NON-COMPLEX"}`,
    `Progress: ${doneCount}/${totalSteps} steps completed`,
    "",
  ];

  // Show completed steps
  if (completedIds.size > 0) {
    lines.push("COMPLETED STEPS (do NOT ask again):");
    for (const step of procedure.steps) {
      if (completedIds.has(step.id)) {
        lines.push(`  [DONE] ${step.id}: ${step.question}`);
      }
    }
    lines.push("");
  }

  // Show unable-to-verify steps
  if (unableIds.size > 0) {
    lines.push("UNABLE TO VERIFY (closed — skip):");
    for (const step of procedure.steps) {
      if (unableIds.has(step.id)) {
        lines.push(`  [SKIP] ${step.id}: ${step.question}`);
      }
    }
    lines.push("");
  }

  // Show next step
  if (nextStep) {
    lines.push(`NEXT REQUIRED STEP: ${nextStep.id}`);
    lines.push(`Ask EXACTLY: "${nextStep.question}"`);
    lines.push("");
    lines.push("RULES:");
    lines.push("- Ask ONLY this question. Do NOT skip ahead.");
    lines.push("- Do NOT invent diagnostic steps outside this procedure.");
    lines.push("- Do NOT ask about systems other than " + procedure.displayName + ".");
  } else {
    lines.push("ALL STEPS COMPLETE — ready to transition.");
    lines.push("State isolation findings and output [TRANSITION: FINAL_REPORT].");
  }

  return lines.join("\n");
}
