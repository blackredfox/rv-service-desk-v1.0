/**
 * Context Engine
 * 
 * Main orchestrator for diagnostic context management.
 * Integrates intent routing, loop protection, replan logic, and topic stack.
 */

import type {
  DiagnosticContext,
  Intent,
  ContextEngineResult,
  ResponseInstructions,
  ContextEngineConfig,
  AgentAction,
  Fact,
  Submode,
  Mode,
  LaborState,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { detectIntent, describeIntent, isClarificationRequest } from "./intent-router";
import { checkLoopViolation, generateAntiLoopDirectives, updateLoopState, isFallbackResponse } from "./loop-guard";
import { shouldReplan, executeReplan, buildReplanNotice, isInReplanState, clearReplanState } from "./replan";
import { pushTopic, popTopic, isInClarificationSubflow, buildReturnToMainInstruction, buildClarificationContext, shouldAutoPopTopic, getCurrentClarificationTopic } from "./topic-stack";
import { 
  markStepCompleted as registryMarkStepCompleted, 
  markStepUnable as registryMarkStepUnable,
  getNextStepId as registryGetNextStepId,
  processResponseForBranch as registryProcessResponseForBranch,
  exitBranch as registryExitBranch,
  scanMessageForSubtypeAssertions as registryScanSubtypeAssertions,
  getActiveProcedure as registryGetActiveProcedure,
} from "../diagnostic-registry";

// Re-export config
export { DEFAULT_CONFIG } from "./types";

// ── Terminal-State Engine (P1.7) ───────────────────────────────────────
//
// Three-phase progressive model:
//   Phase "normal"          — diagnostic in progress
//   Phase "fault_candidate" — strong fault identified, ONE restoration check allowed
//   Phase "terminal"        — fault + restoration confirmed → hard stop
//
// RESTORATION_PATTERNS require repair + working → proves all 3 conditions in one message.
// FAULT_PATTERNS identify a concrete fault → moves to fault_candidate.
// SIMPLE_RESTORATION_PATTERNS (used ONLY in fault_candidate) catch simple confirmations.
//
// Terminal state DOMINATES all step assignment. No code path may override it.

import type { TerminalPhase, TerminalState } from "./types";

const MIN_STEPS_FOR_COMPLETION = 1;

const RESTORATION_PATTERNS: RegExp[] = [
  // English: "after [repair] ... works/running/operational"
  /after.{0,80}(?:fix|repair|replac|restor|reconnect|rewir|splicin|replacing|repairing|fixing|restoring|reconnecting|rewiring).{0,100}(?:work(?:ing|s)?|operational|functional|running|heating|firing|started|back\s+up)/i,
  // English: "repaired/fixed/replaced ... now works"
  /(?:repair(?:ed)?|fix(?:ed)?|replac(?:ed)?|restor(?:ed)?|reconnect(?:ed)?|rewir(?:ed)?|spliced?).{0,80}(?:now\s+)?(?:work(?:ing|s)?|operational|running|heating|functional|back\s+up)/i,
  // English: "works/running after repair/fix"
  /(?:work(?:ing|s)?|operational|running|heating)\s*(?:now|again)?\s+(?:after|following)\s+(?:fix|repair|replac|restor|reconnect|rewir)/i,
  // Russian: "после [восстановления/замены/...] ... работает/заработал"
  /после.{0,60}(?:восстановлен|замен|ремонт|починк|устранен|подключен|отремонтир|починен).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился|включается|нагревает)/i,
  // Russian: "[repair verb] + работает" — core pattern for TestCase11/12
  /(?:восстановил|починил|заменил|отремонтировал|подключил|устранил).{0,80}(?:работает|работает\s*нормально|функционирует|заработал|запустился)/i,
  // Russian: explicit resolution phrasing after repair
  /(?:заменил|восстановил|починил|устранил).{0,120}(?:теперь\s+)?(?:водонагреватель|система|оборудование)?.{0,40}(?:работает|работает\s*нормально|функционирует|заработал).{0,40}(?:проблема\s+устранена|неисправность\s+устранена|исправен)/i,
  /(?:проблема\s+устранена|неисправность\s+устранена).{0,80}(?:работает|заработал|функционирует)|(?:работает|заработал|функционирует).{0,80}(?:проблема\s+устранена|неисправность\s+устранена)/i,
  // Russian (Case 108/109): "заменил X. (теперь) Y исправен / в порядке"
  // — fault repaired and equipment now reported operational without
  // explicitly using the verb "работает". Common technician phrasing
  // for fuse replacement in water-heater diagnostics.
  /(?:заменил|восстановил|починил|устранил|отремонтировал)[\s\S]{0,150}(?:теперь\s+)?(?:водонагреватель|система|оборудование|устройство|прибор)?[\s\S]{0,40}(?:исправен|исправно|в\s+порядке|готов(?:а|о)?\s+к\s+работе)/iu,
  // Russian: explicit "проблема устранена" / "неисправность устранена" anywhere
  // in the message after a repair-context cue elsewhere in the same message.
  /(?:заменил|восстановил|починил|устранил|отремонтировал|поменял)[\s\S]{0,200}(?:проблема\s+устранена|неисправность\s+устранена|неполадка\s+устранена)/iu,
  /(?:проблема\s+устранена|неисправность\s+устранена|неполадка\s+устранена)[\s\S]{0,200}(?:заменил|восстановил|починил|устранил|отремонтировал|поменял)/iu,
  // Russian (Case 109): standalone "восстановился / восстановилось / восстановилась"
  // — used by technicians as confirmation that the previously reported
  // condition (12V, питание, работа) is now restored after the repair.
  /(?:^|[\s.,!?;:])(?:восстановил(?:ся|ась|ось|ис[ьъ])|восстановлен[аоы]?)(?=[\s.,!?;:]|$)/iu,
  // Russian: "[unk repair] проводку + работает" — wiring-specific restoration
  /(?:заменил|восстановил|отремонтировал|починил)\s+проводку.{0,80}(?:работает|заработал|функционирует)/i,
  // Russian: loose "работает" after a temporal/causal sequence
  /(?:работает(?:\s+нормально)?|заработал).{0,40}после/i,
  // Spanish: "después/tras [repair] ... funciona"
  /(?:después\s+de|tras)\s+(?:reparar|reemplazar|restaurar|reconectar|arreglar|cambiar).{0,100}(?:funciona|opera|trabaja)/i,
  /(?:repar(?:é|e|ado)|reemplaz(?:é|ado)|restaur(?:é|ado)|arregl(?:é|ado)).{0,80}(?:funciona|opera|trabaja)/i,
];

const FAULT_PATTERNS: RegExp[] = [
  /\b(?:blown|failed|faulty|bad)\s+fuse\b/i,
  /\bfuse\b.{0,40}\b(?:blown|failed|faulty|bad)\b/i,
  // English: component first then state word (e.g. "the relay board is burnt")
  /\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b.{0,80}\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b/i,
  // English: state word first then component (e.g. "burnt relay board")
  /\b(?:burnt?|burned?|melted?|shorted?|blown?|seized|dead|failed)\b.{0,60}\b(?:board|motor|relay|valve|pump|module|capacitor|compressor|controller|component|igniter|electrode|wire|connector)\b/i,
  // English: sensor / switch-class component + fault state word (narrow).
  // Added to close the recognition gap for common real-tech phrases like
  // "flame sensor is bad", "thermocouple failed", "switch is defective".
  // Broader state words (bad|defective|faulty) are admitted ONLY when
  // paired with this narrow component list, mirroring the precedent
  // already set above for the `fuse` component. The state word alone
  // is NOT enough to match — a sensor/switch-class noun must be present.
  /\b(?:flame\s+sensor|sensor|thermocouple|thermistor|switch)\b.{0,40}\b(?:blown|failed|faulty|bad|defective|broken|dead)\b/i,
  /\b(?:blown|failed|faulty|bad|defective|broken|dead)\b\s+(?:flame\s+sensor|sensor|thermocouple|thermistor|switch)\b/i,
  // English: short circuit / open circuit in wiring
  /\b(?:short\s+circuit|open\s+circuit|wiring\s+fault|wiring\s+break|broken\s+wire|severed\s+wire)\b/i,
  // English: power+ground confirmed but component not responding
  /(?:power|voltage|12v|12\s*volt).{0,60}(?:confirmed|present|verified).{0,80}(?:motor|pump|board|relay|valve).{0,40}(?:not\s+run|not\s+work|won'?t\s+start|no\s+response|dead|nothing)/i,
  // Russian: "короткое замыкание" (short circuit) — Issue 1 in TestCase12
  /короткое\s+замыкание/i,
  /(?:неисправен|перегорел|сгорел)\s+предохранитель/i,
  /предохранитель.{0,40}(?:неисправен|перегорел|сгорел)/i,
  // Russian (Case 108): "предохранитель не работал / не работает" —
  // technicians often phrase fuse failure colloquially without the
  // formal diagnostic verbs above. Pair the component noun with a
  // failure-of-function clause to keep this conservative.
  /предохранитель[^.\n]{0,40}не\s+работ(?:ал|ает|ала)/iu,
  /не\s+работ(?:ал|ает|ала)[^.\n]{0,40}предохранитель/iu,
  // Russian: "обрыв проводки/провода/цепи" (wiring/circuit break)
  /обрыв\s+(?:проводки|провода|цепи|питания)/i,
  // Russian: "разрыв проводки/провода" (wiring break)
  /разрыв\s+(?:проводки|провода|цепи)/i,
  // Russian: "повреждение проводки" (wiring damage)
  /повреждение\s+(?:проводки|провода)/i,
  // Russian: "целостность проводки/провода/цепи ... нарушена" — wiring integrity compromised
  /целостност[ьи]\s+(?:проводки|провода|цепи).{0,40}наруш/i,
  /наруш(?:ена|ение)\s+целостност[ьи]\s+(?:проводки|провода|цепи)/i,
  // Russian: "проводка нарушена / повреждена / оборвана"
  /(?:проводк[аи]|провод[ао]?)\s+(?:наруш[а-яё]+|поврежд[а-яё]+|оборван[а-яё]*)/i,
  // Russian: destructive finding + component — NO \b (Cyrillic not in \w, \b is unreliable)
  /(?:^|[\s,—])(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил|неисправ[а-яё]+)(?:$|[\s,—]).{0,60}(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер)/i,
  // Russian: component + destructive finding
  /(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор|компрессор|контроллер).{0,60}(?:сгорел|оплавился|вздулся|перегорел|подгорел|расплавился|заклинил)/i,
  // Russian (simpler fallback for start-of-message): "сгорел мотор"
  /^(?:сгорел|оплавился|вздулся|перегорел|подгорел)\s+(?:плата|мотор|двигатель|реле|клапан|насос|модуль|конденсатор)/i,
  // Russian: sensor / switch-class component + fault state (narrow).
  // Mirrors the English sensor/switch-class gap-closure above.
  /(?:датчик(?:\s+пламени)?|термопара|термистор|переключатель|выключатель).{0,60}(?:неисправ[а-яё]+|сломан[а-яё]*|плох[а-яё]+|дефектн[а-яё]+|сгорел[а-яё]*|перегорел[а-яё]*)/i,
  /(?:неисправ[а-яё]+|сломан[а-яё]*|плох[а-яё]+|дефектн[а-яё]+|сгорел[а-яё]*|перегорел[а-яё]*)\s+(?:датчик(?:\s+пламени)?|термопара|термистор|переключатель|выключатель)/i,
  // Spanish: quemado/fundido + component
  /\b(?:quemado|fundido|dañado|cortocircuito)\b.{0,60}\b(?:placa|motor|relé|válvula|bomba|módulo|condensador)\b/i,
  // Spanish: sensor / switch-class component + fault state (narrow).
  /\b(?:sensor(?:\s+de\s+llama)?|termopar|termistor|interruptor)\b.{0,40}\b(?:malo|defectuoso|dañado|roto|quemado|fundido|fallado|fallido)\b/i,
  /\b(?:malo|defectuoso|dañado|roto|quemado|fundido|fallado|fallido)\b\s+(?:sensor(?:\s+de\s+llama)?|termopar|termistor|interruptor)\b/i,
];

// Used ONLY in fault_candidate phase — simpler patterns for restoration confirmation
// after the system asked "Is the system working now?"
const SIMPLE_RESTORATION_PATTERNS: RegExp[] = [
  // English: positive working confirmation
  /\b(?:work(?:ing|s)|operational|functional|running|heating|started|back\s+up|fixed|resolved)\b/i,
  // Russian: positive working confirmation
  /(?:работает|заработал|функционирует|запустился|включается|нагревает|исправен|починен|устранено|устранил)/i,
  // Spanish: positive working confirmation
  /(?:funciona|opera|trabaja|arreglado|resuelto|reparado)/i,
  // Simple affirmative when restoration check was explicitly asked
  // Allows prefix: "да, подтверждаю" (yes, I confirm), "yes, confirmed" etc.
  /^(?:да|yes|sí|si|yep|yup|ага|угу|correct|верно|точно|exactly|подтверждаю|confirmed|confirmo)/i,
];

// Negative restoration patterns — prevent false terminal state on denial
const NEGATIVE_RESTORATION: RegExp[] = [
  /(?:not|don'?t|doesn'?t|won'?t|can'?t|still\s+(?:not|doesn'?t|won'?t))\s+(?:work|run|start|heat|function|operat)/i,
  /(?:не\s+работает|не\s+запускается|не\s+включается|не\s+нагревает|всё\s+ещё\s+не|по-прежнему\s+не)/i,
  /(?:no\s+funciona|no\s+trabaja|no\s+opera|sigue\s+sin)/i,
  /^(?:нет|no|nope|nah)$/i,
];

// ── Case-88: Water-pump direct-power terminal evidence ──────────────
//
// In RV pump diagnostics, applying battery voltage directly to the pump
// terminals is itself the definitive isolation procedure: if 12V is
// confirmed at the pump and the pump still does not run when powered
// directly, the motor is mechanically/electrically failed and must be
// replaced. There is no further diagnostic step that can change this
// conclusion — restoration confirmation is not applicable in a
// pre-replacement warranty workflow.
//
// These patterns are NARROW on purpose:
//   - they require BOTH a "direct-power-applied" cue AND a
//     "pump-not-running" cue to co-occur in the technician's message;
//   - they only fire when the active procedure is `water_pump`;
//   - they bypass MIN_STEPS_FOR_COMPLETION because the direct-power
//     test is itself the diagnostic conclusion (no prior steps are a
//     prerequisite for it to be authoritative).
//
// Authority contract is preserved:
//   - Server (Context Engine) owns isolation. The LLM never sets it.
//   - The synthesized finding is grounded in the technician's own
//     transcript wording ("12V applied directly, pump does not run").
//
const DIRECT_POWER_APPLIED_PATTERNS: RegExp[] = [
  // English: "applied 12V directly to the pump", "powered the motor
  // directly with 12V", "ran 12V straight to the pump", etc.
  /(?:applied|connected|hooked(?:\s*up)?|powered|wired|jumper(?:ed)?|ran|put)\s+(?:\S+\s+){0,4}\b12\s*(?:v|volts?|vdc)\b\s+(?:\S+\s+){0,4}\b(?:direct(?:ly)?|straight)\b/i,
  /\b(?:direct(?:ly)?|straight)\b\s+(?:\S+\s+){0,4}\b12\s*(?:v|volts?|vdc)\b\s+(?:\S+\s+){0,4}(?:to|at|on)\s+(?:the\s+)?(?:pump|motor)/i,
  // Russian: "подключил/подал/подсоединил/запитал 12 в(олт) напрямую"
  // The unit alternates `в`, `вольт(а|ов)`, and the colloquial typo `волт`
  // (without soft sign), all of which appear in real technician transcripts.
  // NOTE: JS `\b` is ASCII-only — it does NOT recognize a Cyrillic letter
  // as a word boundary. We use an explicit non-letter lookahead instead.
  /(?:подал|подключил|подсоединил|подвёл|подвел|запитал|пустил|подача)\s+(?:\S+\s+){0,4}12\s*(?:в|вольт(?:а|ов)?|волт(?:а|ов)?|v|volts?|vdc)(?=[\s.,;:!?]|$)\s+(?:\S+\s+){0,4}(?:напрямую|непосредственно|прямо)/iu,
  // Russian: "напрямую к насосу 12 в" (reverse word order)
  /(?:напрямую|непосредственно|прямо)\s+(?:\S+\s+){0,4}12\s*(?:в|вольт(?:а|ов)?|волт(?:а|ов)?|v|volts?|vdc)(?=[\s.,;:!?]|$)\s+(?:\S+\s+){0,4}(?:к\s+насосу|на\s+насос|к\s+помпе|на\s+помпу|насос|помп(?:у|е))/iu,
  // Russian: "12 в напрямую к насосу" (no leading verb — the verb appeared
  // earlier in the same message but the locality window is too tight)
  /\b12\s*(?:в|вольт(?:а|ов)?|волт(?:а|ов)?|v|volts?|vdc)(?=[\s.,;:!?]|$)\s+(?:\S+\s+){0,3}(?:напрямую|непосредственно|прямо)\s+(?:\S+\s+){0,3}(?:к\s+насосу|на\s+насос|к\s+помпе|на\s+помпу)/iu,
  // Spanish: "apliqué 12V directamente a la bomba", "alimenté el motor con 12V directo"
  /(?:apliqu[eé]|conect[eé]|aliment[eé]|puse|cabl[eé])\s+(?:\S+\s+){0,4}\b12\s*(?:v|voltios?)\b\s+(?:\S+\s+){0,4}(?:direct(?:o|amente))/iu,
  /(?:direct(?:o|amente))\s+(?:\S+\s+){0,4}\b12\s*(?:v|voltios?)\b\s+(?:\S+\s+){0,4}(?:a\s+la\s+bomba|al\s+motor)/iu,
];

const PUMP_NO_RUN_PATTERNS: RegExp[] = [
  // English: "pump does not run", "motor is dead", "pump won't start", etc.
  /\b(?:pump|motor)\b[^.\n]{0,80}\b(?:not\s+(?:run(?:ning)?|operating|working)|won'?t\s+(?:run|start|operate)|does(?:n'?| no)t\s+(?:run|start|operate|work)|dead|no\s+response|nothing)\b/i,
  /\b(?:dead|failed|inoperative|bad)\b\s+(?:pump|motor)/i,
  // Russian: "насос не работает", "насос не рабочий", "помпа мертвая", "насос не запускается"
  /(?:насос|помпа)[^.\n]{0,80}(?:не\s+(?:работает|запускается|включается|крутит(?:ся)?|вращается|реагирует)|не\s+рабоч(?:ий|ая)|неисправ\S*|мертв\S*|сдох\S*)/iu,
  /(?:не\s+рабоч(?:ий|ая)|мертв\S*|неисправ\S*)\s+(?:насос|помпа)/iu,
  // Spanish: "la bomba no funciona", "el motor está muerto"
  /\b(?:bomba|motor)\b[^.\n]{0,80}(?:no\s+(?:funciona|arranca|gira|opera|trabaja)|no\s+responde|muert[ao])/iu,
];

/**
 * Detect Case-88-style water-pump terminal evidence:
 *   "12V applied directly to the pump AND pump does not run"
 *
 * Returns the synthesized isolation finding text, or `null` when no
 * direct-power isolation evidence is present in the message. Caller
 * is responsible for checking `activeProcedureId === "water_pump"`.
 */
export function detectWaterPumpDirectPowerIsolation(
  message: string,
): string | null {
  const hasDirectPower = DIRECT_POWER_APPLIED_PATTERNS.some((p) => p.test(message));
  if (!hasDirectPower) return null;
  const hasNoRun = PUMP_NO_RUN_PATTERNS.some((p) => p.test(message));
  if (!hasNoRun) return null;
  return "Water pump failed direct-power test — 12V applied directly to the pump, pump does not run; replacement required.";
}

// ── Generalized component-isolation detector (Cases 101–103) ────────
//
// Generalizes the Case-88 water-pump direct-power isolation pattern
// across ANY active procedure. Fires when the technician's message
// includes ALL THREE of:
//
//   - past-tense diagnostic verification: "проверил X" / "checked X" /
//     "revisé X" (the technician inspected something and is
//     reporting the result);
//   - component-level failure assertion: "X не работает" / "X bad" /
//     "no funciona" / "доxлый";
//   - future-replacement intent: "надо менять" / "requires replacement"
//     (the technician concluded the part needs to be replaced — but
//     has NOT yet replaced it. This is the pre-replacement warranty
//     workflow that Case-88 first solved for water_pump.).
//
// Returns the synthesized isolation finding text, or `null` when the
// pattern doesn't fully match. Caller is responsible for checking
// that an active procedure is bound — the ALL-THREE requirement
// keeps this conservative enough to trigger only on dense
// component-isolation messages.
//
// Authority contract:
//   - Server (Context Engine) owns the isolation flip. The LLM
//     never sets it.
//   - The synthesized finding is grounded in the technician's own
//     transcript wording (the matched component name + replacement
//     intent are echoed back into the finding text).
//
const GENERIC_DIAGNOSTIC_VERIFICATION_PATTERNS: RegExp[] = [
  /\b(?:checked|inspected|verified|tested|measured)\s+\S+/i,
  /(?:проверил(?:а)?|осмотрел(?:а)?|измерил(?:а)?|протестировал(?:а)?)\s+\S+/iu,
  /(?:revis[eé]|inspeccion[eé]|verifiqu[eé]|med[ií]|prob[eé])\s+\S+/iu,
];

const GENERIC_COMPONENT_FAILURE_PATTERNS: RegExp[] = [
  // English: "X is bad", "X does not work", "X failed", "X is dead"
  /\b\S+\s+(?:is|are)\s+(?:bad|dead|failed|inoperative|broken|defective)\b/i,
  /\b\S+\s+(?:does(?:n'?| no)t|won'?t|doesn'?t)\s+(?:work|operate|run|start)\b/i,
  /\b(?:bad|dead|failed|inoperative|broken|defective)\s+\S+/i,
  // Russian: "X не работает", "X неисправен", "X мёртв"
  // NOTE: JS `\b` is ASCII-only and does not recognize a Cyrillic
  // letter as a word boundary, so trailing `\b` after a Cyrillic verb
  // never fires. Use an explicit non-letter lookahead instead.
  /(?:^|\s)\S+\s+не\s+работает(?=[\s.,;:!?]|$)/iu,
  /(?:^|\s)\S+\s+(?:неисправ\S*|мертв\S*|сдох\S*)(?=[\s.,;:!?]|$)/iu,
  /(?:^|\s)(?:неисправ\S*|мертв\S*)\s+\S+/iu,
  // Spanish: "X no funciona", "X está dañado"
  /(?:^|\s)\S+\s+no\s+funciona(?=[\s.,;:!?]|$)/iu,
  /(?:^|\s)\S+\s+est[aá]\s+(?:dañad|roto|muert)/iu,
];

const FUTURE_REPLACEMENT_INTENT_PATTERNS_CTX: RegExp[] = [
  /\b(?:needs?|requires?|will\s+(?:need|require)|going\s+to|gonna|to\s+be)\s+(?:replaced|replacement|swapped|fixed|repaired)\b/i,
  /\b(?:replacement|repair)\s+(?:is\s+)?(?:required|needed|necessary)\b/i,
  /(?:требует(?:ся)?|нужн[аоы]?|надо|необходим\S*)\s+(?:замен\S*|поменя\S*|менять|ремонт\S*)/iu,
  /(?:requiere|necesita|hay\s+que)\s+(?:reemplaz\S*|cambi\S*|repar\S*)/iu,
];

/**
 * Detect generic component-isolation evidence (any equipment).
 * Returns the synthesized isolation finding text, or `null`.
 *
 * @param message — current technician message
 * @param activeProcedureLabel — used to compose a domain-aware
 *   isolation finding string (e.g. "water_heater" → "Water heater
 *   component-level isolation: ...").
 */
export function detectGenericComponentIsolation(
  message: string,
  activeProcedureLabel: string | null,
): string | null {
  if (!activeProcedureLabel) return null;
  const hasVerification = GENERIC_DIAGNOSTIC_VERIFICATION_PATTERNS.some((p) =>
    p.test(message),
  );
  if (!hasVerification) return null;
  const hasFailure = GENERIC_COMPONENT_FAILURE_PATTERNS.some((p) => p.test(message));
  if (!hasFailure) return null;
  const hasFutureRepair = FUTURE_REPLACEMENT_INTENT_PATTERNS_CTX.some((p) =>
    p.test(message),
  );
  if (!hasFutureRepair) return null;
  const display = activeProcedureLabel.replace(/_/g, " ");
  return `${display.charAt(0).toUpperCase() + display.slice(1)} component-level isolation: technician verified the component and confirmed it is failed; replacement required.`;
}



type TerminalStateUpdate = {
  changed: boolean;
  previousPhase: TerminalPhase;
  newPhase: TerminalPhase;
};

/**
 * P1.7 — Progressive terminal-state update.
 *
 * Checks each message against three conditions and accumulates them:
 *  1. RESTORATION_PATTERNS (repair + working) → proves all 3 in one message
 *  2. FAULT_PATTERNS → records fault, moves to fault_candidate
 *  3. SIMPLE_RESTORATION_PATTERNS (only in fault_candidate) → confirms restoration
 *
 * Once all 3 conditions are met, phase becomes "terminal".
 */
function updateTerminalState(
  message: string,
  context: DiagnosticContext,
): TerminalStateUpdate {
  const ts = context.terminalState;
  const previousPhase = ts.phase;

  // Already terminal — nothing to do
  if (ts.phase === "terminal") {
    return { changed: false, previousPhase, newPhase: "terminal" };
  }

  // Require minimum diagnostic work before considering terminal conditions
  const totalDone = context.completedSteps.size + context.unableSteps.size;
  if (totalDone < MIN_STEPS_FOR_COMPLETION) {
    return { changed: false, previousPhase, newPhase: ts.phase };
  }

  const now = new Date().toISOString();
  let changed = false;

  // ── Phase 1: Check full RESTORATION_PATTERNS ───────────────────────
  // These require repair action + operational confirmation → all 3 conditions implied
  if (!ts.restorationConfirmed) {
    for (const pattern of RESTORATION_PATTERNS) {
      if (pattern.test(message)) {
        const text = message.slice(0, 120).replace(/\s+/g, " ").trim();
        ts.correctiveAction = ts.correctiveAction || { text, detectedAt: now };
        ts.restorationConfirmed = { text, detectedAt: now };
        // Infer fault — you don't repair without one
        if (!ts.faultIdentified) {
          ts.faultIdentified = { text: `Inferred from repair: ${text}`, detectedAt: now };
        }
        changed = true;
        break;
      }
    }
  }

  // ── Phase 2: Check FAULT_PATTERNS ─────────────────────────────────
  // Records fault, moves to fault_candidate (ONE restoration check allowed)
  if (!ts.faultIdentified) {
    for (const pattern of FAULT_PATTERNS) {
      if (pattern.test(message)) {
        ts.faultIdentified = {
          text: message.slice(0, 120).replace(/\s+/g, " ").trim(),
          detectedAt: now,
        };
        changed = true;
        break;
      }
    }
  }

  // ── Phase 3: Simple restoration check (fault_candidate only) ──────
  // When a fault was already identified and system asked one restoration check,
  // simpler patterns like "works" or "да" confirm restoration.
  if (ts.phase === "fault_candidate" && ts.faultIdentified && !ts.restorationConfirmed) {
    const isNegative = NEGATIVE_RESTORATION.some(p => p.test(message));
    if (!isNegative) {
      for (const pattern of SIMPLE_RESTORATION_PATTERNS) {
        if (pattern.test(message)) {
          const text = message.slice(0, 120).replace(/\s+/g, " ").trim();
          ts.correctiveAction = ts.correctiveAction || { text, detectedAt: now };
          ts.restorationConfirmed = { text, detectedAt: now };
          changed = true;
          break;
        }
      }
    }
  }

  // ── Determine phase ───────────────────────────────────────────────
  if (ts.faultIdentified && ts.restorationConfirmed) {
    ts.phase = "terminal";
  } else if (ts.faultIdentified && ts.phase === "normal") {
    ts.phase = "fault_candidate";
  }

  return {
    changed: changed || ts.phase !== previousPhase,
    previousPhase,
    newPhase: ts.phase,
  };
}

// ── Context Store ───────────────────────────────────────────────────

const contextStore = new Map<string, DiagnosticContext>();

// ── Context Initialization ──────────────────────────────────────────

/**
 * Create a new diagnostic context for a case
 */
export function createContext(
  caseId: string,
  initialSystem?: string,
  classification?: "complex" | "non_complex",
): DiagnosticContext {
  const now = new Date().toISOString();
  
  const context: DiagnosticContext = {
    caseId,
    primarySystem: initialSystem || null,
    classification: classification || null,
    mode: "diagnostic",
    submode: "main",
    previousSubmode: null,
    topicStack: [],
    activeProcedureId: initialSystem || null,
    activeStepId: null,
    completedSteps: new Set(),
    unableSteps: new Set(),
    askedSteps: new Set(),
    // P1.5: Branch state initialization
    branchState: {
      activeBranchId: null,
      decisionPath: [],
      lockedOutBranches: new Set(),
    },
    // P1.7: Terminal state initialization
    terminalState: {
      phase: "normal",
      faultIdentified: null,
      correctiveAction: null,
      restorationConfirmed: null,
    },
    facts: [],
    hypotheses: [],
    contradictions: [],
    lastAgentActions: [],
    consecutiveFallbacks: 0,
    isolationComplete: false,
    isolationFinding: null,
    isolationInvalidated: false,
    replanReason: null,
    labor: {
      mode: "none",
      estimatedHours: null,
      confirmedHours: null,
      draftGeneratedAt: null,
      confirmationRequired: false, // Non-blocking by default
    },
    createdAt: now,
    updatedAt: now,
  };
  
  contextStore.set(caseId, context);
  return context;
}

/**
 * Get or create context for a case
 */
export function getOrCreateContext(
  caseId: string,
  initialSystem?: string,
  classification?: "complex" | "non_complex",
): DiagnosticContext {
  const existing = contextStore.get(caseId);
  if (existing) {
    // P1.7: Ensure terminalState exists (hot-reload migration safety)
    if (!existing.terminalState) {
      existing.terminalState = {
        phase: "normal",
        faultIdentified: null,
        correctiveAction: null,
        restorationConfirmed: null,
      };
    }
    // Update system/classification if provided and not already set
    if (initialSystem && !existing.primarySystem) {
      existing.primarySystem = initialSystem;
      existing.activeProcedureId = initialSystem;
    }
    if (classification && !existing.classification) {
      existing.classification = classification;
    }
    return existing;
  }
  return createContext(caseId, initialSystem, classification);
}

/**
 * Get context for a case (returns undefined if not found)
 */
export function getContext(caseId: string): DiagnosticContext | undefined {
  return contextStore.get(caseId);
}

/**
 * Update context in store
 */
export function updateContext(context: DiagnosticContext): void {
  context.updatedAt = new Date().toISOString();
  contextStore.set(context.caseId, context);
}

/**
 * Clear context for a case (for testing)
 */
export function clearContext(caseId: string): void {
  contextStore.delete(caseId);
}

// ── Main Processing Function ────────────────────────────────────────

/**
 * Process a technician message through the context engine.
 * This is the main entry point for the engine.
 */
export function processMessage(
  caseId: string,
  message: string,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): ContextEngineResult {
  let context = getOrCreateContext(caseId);
  const notices: string[] = [];
  let stateChanged = false;
  
  // 1. Detect intent
  const intent = detectIntent(message);
  console.log(`[ContextEngine] Intent: ${describeIntent(intent)}`);

  // 1a. Transcript-wide subtype assertion scan.
  // Explicit non-combo assertions ("это не COMBO", "not combo", "no es combo")
  // apply regardless of the current step and must block combo-only steps from
  // being served or re-served, including the step the assertion was made on.
  const newSubtypeExclusions = registryScanSubtypeAssertions(caseId, message);
  if (newSubtypeExclusions.length > 0) {
    notices.push(`Subtype exclusions added: ${newSubtypeExclusions.join(", ")}`);
    stateChanged = true;

    // If the currently active step is gated by a subtype that was just excluded
    // (e.g. wh_11 is combo-only and the technician just said "это не COMBO"),
    // the step must not be served or re-served. Mark it unable and let the
    // registry resolve the next eligible step through the normal subtype-aware
    // getNextStepId path.
    if (context.activeStepId) {
      const procedure = registryGetActiveProcedure(caseId);
      const activeStep = procedure?.steps.find((s) => s.id === context.activeStepId);
      if (
        activeStep?.subtypeGate &&
        newSubtypeExclusions.includes(activeStep.subtypeGate)
      ) {
        const skipped = context.activeStepId;
        context.unableSteps.add(skipped);
        registryMarkStepUnable(caseId, skipped);
        const nextId = registryGetNextStepId(caseId);
        context.activeStepId = nextId;
        notices.push(
          `Active step ${skipped} force-skipped (subtype '${activeStep.subtypeGate}' excluded); next=${nextId ?? "none"}`,
        );
      }
    }
  }
  
  // 2. Check for replan triggers (only if isolation was complete AND not terminal)
  // P1.7: Terminal state must not be undone by replan
  if (config.enableReplan && context.isolationComplete && context.terminalState.phase !== "terminal") {
    const replanResult = shouldReplan(message, context);
    if (replanResult.shouldReplan) {
      console.log(`[ContextEngine] Replan triggered: ${replanResult.reason}`);
      context = executeReplan(context, replanResult);
      notices.push(`Replan triggered: ${replanResult.reason}`);
      stateChanged = true;
    }
  }
  
  // 3. Handle clarification subflows
  if (config.enableClarificationSubflows) {
    if (intent.type === "LOCATE" || intent.type === "EXPLAIN" || intent.type === "HOWTO") {
      context = pushTopic(context, intent);
      stateChanged = true;
    }
  }
  
  // 4. Handle step completion signals
  // NOTE: CONFIRMATION in diagnostic mode with an active step is treated as MAIN_DIAGNOSTIC
  // (e.g. Russian "да" / "нет" answers to diagnostic questions should advance steps, not
  //  be misrouted as labor confirmations)
  const isConfirmationAsDiagnostic =
    intent.type === "CONFIRMATION" &&
    context.mode === "diagnostic" &&
    context.activeStepId !== null;

  if (
    intent.type === "MAIN_DIAGNOSTIC" ||
    intent.type === "ALREADY_ANSWERED" ||
    intent.type === "UNABLE_TO_VERIFY" ||
    isConfirmationAsDiagnostic
  ) {
    // If we're in a clarification subflow and got a diagnostic response, pop back
    if (isInClarificationSubflow(context) && (intent.type === "MAIN_DIAGNOSTIC" || isConfirmationAsDiagnostic)) {
      context = popTopic(context);
      stateChanged = true;
    }
    
    // Mark current step as completed or unable based on intent
    if (context.activeStepId) {
      if (intent.type === "UNABLE_TO_VERIFY") {
        const completedStepId = context.activeStepId;
        context.unableSteps.add(completedStepId);
        registryMarkStepUnable(caseId, completedStepId); // Sync to registry
        notices.push(`Step ${completedStepId} marked as UNABLE`);
        // Note: unable-to-verify typically does not trigger branches (no positive finding)
        // Get next step (branch-aware)
        const nextId = registryGetNextStepId(caseId);
        // Handle branch exit if all branch steps are exhausted
        if (nextId === null && context.branchState.activeBranchId !== null) {
          registryExitBranch(caseId, "Branch steps exhausted after UNABLE");
          context.branchState.activeBranchId = null;
          notices.push(`Branch exhausted (unable) — returning to main flow`);
          const mainFlowNext = registryGetNextStepId(caseId);
          context.activeStepId = mainFlowNext;
          if (mainFlowNext) notices.push(`Main flow resumed: ${mainFlowNext}`);
          else notices.push(`All procedure steps complete`);
        } else {
          context.activeStepId = nextId;
          if (nextId) notices.push(`Next step assigned: ${nextId}`);
          else notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      } else {
        // MAIN_DIAGNOSTIC, ALREADY_ANSWERED, or diagnostic-context CONFIRMATION
        // Technician answered the current step — mark it complete
        const completedStepId = context.activeStepId;
        context.completedSteps.add(completedStepId);
        registryMarkStepCompleted(caseId, completedStepId, message); // Sync to registry with message for subtype detection
        notices.push(`Step ${completedStepId} marked as COMPLETED`);

        // ── P1.5: Branch trigger check ─────────────────────────────
        // MUST happen BEFORE getNextStepId so the registry's activeBranchId is
        // updated when the next step is resolved.
        const branchResult = registryProcessResponseForBranch(caseId, completedStepId, message);
        if (branchResult.branchEntered) {
          notices.push(`Branch entered: ${branchResult.branchEntered.id}`);
          // Sync branch state to context engine state
          context.branchState.activeBranchId = branchResult.branchEntered.id;
          context.branchState.decisionPath.push({
            stepId: completedStepId,
            branchId: branchResult.branchEntered.id,
            reason: "Triggered by technician response",
            timestamp: new Date().toISOString(),
          });
          for (const lockedBranch of branchResult.lockedOut) {
            context.branchState.lockedOutBranches.add(lockedBranch);
          }
        }

        // Now resolve next step — branch-aware because registry.activeBranchId is updated
        const nextId = registryGetNextStepId(caseId);
        // Handle branch exit if all branch steps are exhausted
        if (nextId === null && context.branchState.activeBranchId !== null) {
          registryExitBranch(caseId, "Branch steps exhausted");
          context.branchState.activeBranchId = null;
          notices.push(`Branch exhausted — returning to main flow`);
          const mainFlowNext = registryGetNextStepId(caseId);
          context.activeStepId = mainFlowNext;
          if (mainFlowNext) notices.push(`Main flow resumed: ${mainFlowNext}`);
          else notices.push(`All procedure steps complete`);
        } else {
          context.activeStepId = nextId;
          if (nextId) notices.push(`Next step assigned: ${nextId}`);
          else notices.push(`All procedure steps complete`);
        }
        stateChanged = true;
      }
    }
    
    // Handle "already answered" — prevent re-asking
    if (intent.type === "ALREADY_ANSWERED") {
      notices.push("Technician indicated already answered — moving forward");
    }
  }
  
  // 4.5. P1.7 — Terminal-state progression
  // Runs after step completion so completedSteps count is up-to-date.
  // Progressive: accumulates fault/restoration across messages.
  // When terminal: sets isolationComplete + clears activeStepId.
  // When fault_candidate: clears activeStepId (no more diagnostic steps, ask restoration check).
  const tsUpdate = updateTerminalState(message, context);
  if (tsUpdate.changed) {
    if (context.terminalState.phase === "terminal") {
      context.isolationComplete = true;
      const systemDisplay = (context.primarySystem ?? "system").replace(/_/g, " ");
      const restorationText = context.terminalState.restorationConfirmed?.text ?? message.slice(0, 120);
      context.isolationFinding = `Verified restoration — ${systemDisplay}: ${restorationText}`;
      context.activeStepId = null;
      notices.push(`TERMINAL STATE reached: ${context.isolationFinding}`);
      stateChanged = true;
    } else if (context.terminalState.phase === "fault_candidate" && tsUpdate.previousPhase === "normal") {
      // Just entered fault_candidate — stop step progression, await restoration
      context.activeStepId = null;
      notices.push(`Strong fault identified: ${context.terminalState.faultIdentified!.text} — awaiting restoration confirmation`);
      stateChanged = true;
    }
  }

  // ── Case-88 — Water-pump direct-power isolation (server-owned) ─────
  // When the active procedure is `water_pump` AND the technician's
  // message provides direct-power terminal evidence (12V applied
  // directly + pump does not run), treat isolation as complete.
  // This is a domain-specific definitive isolation that does not
  // require subsequent restoration confirmation — replacement is the
  // only remaining action, and the technician may be requesting a
  // pre-replacement warranty report.
  //
  // Doctrine preserved:
  //   - Server still owns isolation. The LLM never sets it.
  //   - This bypasses MIN_STEPS_FOR_COMPLETION on purpose: the direct-
  //     power test IS itself the diagnostic conclusion for a pump.
  //   - It runs only when the registry-bound active procedure is
  //     `water_pump`, so unrelated systems are unaffected.
  if (
    !context.isolationComplete &&
    context.activeProcedureId === "water_pump"
  ) {
    const directPowerFinding = detectWaterPumpDirectPowerIsolation(message);
    if (directPowerFinding) {
      context.isolationComplete = true;
      context.isolationFinding = directPowerFinding;
      // Record fault for downstream observability without flipping
      // terminalState.phase to terminal (no restoration was confirmed).
      if (!context.terminalState.faultIdentified) {
        context.terminalState.faultIdentified = {
          text: directPowerFinding,
          detectedAt: new Date().toISOString(),
        };
      }
      context.activeStepId = null;
      notices.push(`Water-pump direct-power isolation: ${directPowerFinding}`);
      stateChanged = true;
    }
  }

  // Cases 101–103 generalization: generic component-level isolation.
  // Fires for ANY active procedure (e.g. water_heater gas-valve
  // solenoid, dimmer switch, inverter) when the technician's message
  // contains BOTH a past-tense diagnostic verification AND a
  // component-failure assertion AND a future-replacement intent.
  // This preserves the Case-88 design pattern (server-owned
  // isolation flip on dense component evidence) without case-by-case
  // hacks and without giving the LLM state authority.
  if (
    !context.isolationComplete &&
    context.activeProcedureId &&
    context.activeProcedureId !== "water_pump"
  ) {
    const genericFinding = detectGenericComponentIsolation(
      message,
      context.activeProcedureId,
    );
    if (genericFinding) {
      context.isolationComplete = true;
      context.isolationFinding = genericFinding;
      if (!context.terminalState.faultIdentified) {
        context.terminalState.faultIdentified = {
          text: genericFinding,
          detectedAt: new Date().toISOString(),
        };
      }
      context.activeStepId = null;
      notices.push(`Generic component-level isolation: ${genericFinding}`);
      stateChanged = true;
    }
  }

  // 5. Handle labor confirmation
  if (context.mode === "labor_confirmation" && intent.type === "CONFIRMATION") {
    if (intent.value === "accept" && context.labor.estimatedHours) {
      context.labor.confirmedHours = context.labor.estimatedHours;
      context.labor.mode = "confirmed";
    } else if (typeof intent.value === "number") {
      context.labor.confirmedHours = intent.value;
      context.labor.mode = "confirmed";
    }
    stateChanged = true;
  }
  
  // 6. Ensure active step is always assigned when a procedure is active
  //    (but NOT when isolation is complete or terminal state is non-normal —
  //     fault_candidate and terminal phases must never have a step assigned)
  if (!context.activeStepId && context.activeProcedureId && !context.isolationComplete && context.terminalState.phase === "normal") {
    const nextId = registryGetNextStepId(caseId);
    if (nextId) {
      context.activeStepId = nextId;
      notices.push(`Active step initialized: ${nextId}`);
      stateChanged = true;
    }
  }
  
  // ── P1.7 TERMINAL STATE FINAL ENFORCEMENT ─────────────────────────
  // This is the DOMINANT rule. No matter what steps 1-6 did above,
  // terminal state wins. No code path may assign a step in non-normal phase.
  if (context.terminalState.phase !== "normal") {
    context.activeStepId = null;
    if (context.terminalState.phase === "terminal") {
      context.isolationComplete = true;
    }
  }
  
  // 7. Build response instructions
  const responseInstructions = buildResponseInstructions(context, intent, config);
  
  // 8. Update context in store
  updateContext(context);
  
  return {
    context,
    intent,
    responseInstructions,
    stateChanged,
    notices,
  };
}

// ── Response Instructions Builder ───────────────────────────────────

function buildResponseInstructions(
  context: DiagnosticContext,
  intent: Intent,
  config: ContextEngineConfig,
): ResponseInstructions {
  const antiLoopDirectives = generateAntiLoopDirectives(context);
  const constraints: string[] = [];
  
  // Handle replan state
  if (isInReplanState(context)) {
    const replanNotice = buildReplanNotice(context);
    if (replanNotice) constraints.push(replanNotice);
    
    return {
      action: "replan_notice",
      replanReason: context.replanReason || undefined,
      previousConclusion: context.isolationFinding || undefined,
      constraints,
      antiLoopDirectives,
    };
  }
  
  // Handle clarification subflows
  if (isInClarificationSubflow(context)) {
    const topic = getCurrentClarificationTopic(context);
    const returnInstruction = buildReturnToMainInstruction(context);
    if (returnInstruction) constraints.push(returnInstruction);
    
    const clarificationContext = buildClarificationContext(
      context.submode,
      topic?.topic || "",
    );
    if (clarificationContext) constraints.push(clarificationContext);
    
    return {
      action: "provide_clarification",
      clarificationType: context.submode as "locate" | "explain" | "howto",
      clarificationQuery: topic?.topic,
      returnToStep: topic?.returnStepId,
      constraints,
      antiLoopDirectives,
    };
  }
  
  // Handle labor confirmation mode
  if (context.mode === "labor_confirmation") {
    if (context.labor.mode === "confirmed") {
      return {
        action: "generate_report",
        constraints: [
          `Labor confirmed: ${context.labor.confirmedHours} hours`,
          "Generate final report with this labor budget",
        ],
        antiLoopDirectives,
      };
    }
    return {
      action: "generate_labor",
      constraints: [
        "Generate labor estimate as a DRAFT",
        "Do NOT block diagnostics - this is non-blocking",
        "Technician can continue or confirm later",
      ],
      antiLoopDirectives,
    };
  }
  
  // Handle isolation complete — offer completion (P1.6/P1.7 terminal)
  // Must NOT auto-transition. Must NOT generate report. Must offer explicit command.
  if (context.isolationComplete && context.isolationFinding) {
    return {
      action: "offer_completion",
      constraints: [
        `ISOLATION FINDING: ${context.isolationFinding}`,
        "MANDATORY: Do NOT ask further diagnostic questions.",
        "MANDATORY: Provide a concise 1-2 sentence root cause / repair summary.",
        "MANDATORY: End with exactly: 'Send START FINAL REPORT and I will generate the report.'",
        "PROHIBITED: Do NOT generate the final report format.",
        "PROHIBITED: Do NOT include Complaint / Procedure / Verified Condition headers.",
        "PROHIBITED: Do NOT declare 'isolation complete' or 'conditions met'.",
        "PROHIBITED: Do NOT auto-transition modes.",
      ],
      antiLoopDirectives,
    };
  }

  // Handle fault_candidate — ask ONE restoration check (P1.7)
  // Fault identified but no restoration yet. No more diagnostic questions allowed.
  if (context.terminalState.phase === "fault_candidate" && context.terminalState.faultIdentified) {
    return {
      action: "ask_restoration_check",
      constraints: [
        `FAULT IDENTIFIED: ${context.terminalState.faultIdentified.text}`,
        "MANDATORY: Acknowledge the fault finding briefly.",
        "MANDATORY: Ask ONE question to confirm if repair was done and system is now operational.",
        "MANDATORY: This is the ONLY allowed question. Do NOT ask any other diagnostic question.",
        "PROHIBITED: Do NOT continue with more procedure steps.",
        "PROHIBITED: Do NOT expand into other diagnostic branches.",
        "PROHIBITED: Do NOT ask unrelated diagnostic subquestions.",
        "Example EN: 'Understood. Has the repair been completed? Is the system working now?'",
        "Example RU: 'Принято. Ремонт выполнен? Система работает?'",
      ],
      antiLoopDirectives,
    };
  }
  
  // Default: ask next step
  return {
    action: "ask_step",
    stepId: context.activeStepId || undefined,
    constraints,
    antiLoopDirectives,
  };
}

// ── Step Management ─────────────────────────────────────────────────

/**
 * Mark a step as completed
 */
export function markStepCompleted(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.completedSteps.add(stepId);
  context.activeStepId = null;
  updateContext(context);
}

/**
 * Mark a step as unable to verify
 */
export function markStepUnable(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.unableSteps.add(stepId);
  context.activeStepId = null;
  updateContext(context);
}

/**
 * Set the active step
 */
export function setActiveStep(caseId: string, stepId: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.activeStepId = stepId;
  context.askedSteps.add(stepId);
  updateContext(context);
}

/**
 * Mark isolation as complete
 */
export function markIsolationComplete(caseId: string, finding: string): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.isolationComplete = true;
  context.isolationFinding = finding;
  updateContext(context);
}

// ── Fact Management ─────────────────────────────────────────────────

/**
 * Add a fact to the context
 */
export function addFact(caseId: string, fact: Omit<Fact, "id" | "timestamp">): void {
  const context = getContext(caseId);
  if (!context) return;
  
  const newFact: Fact = {
    ...fact,
    id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  
  context.facts.push(newFact);
  updateContext(context);
}

// ── Agent Action Recording ──────────────────────────────────────────

/**
 * Record an agent action (for loop detection)
 */
export function recordAgentAction(
  caseId: string,
  action: Omit<AgentAction, "timestamp">,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): void {
  const context = getContext(caseId);
  if (!context) return;
  
  const fullAction: AgentAction = {
    ...action,
    timestamp: new Date().toISOString(),
  };
  
  const updatedContext = updateLoopState(context, fullAction, config);
  contextStore.set(caseId, updatedContext);
}

/**
 * Check if a proposed action would violate loop rules
 */
export function wouldViolateLoopRules(
  caseId: string,
  action: Omit<AgentAction, "timestamp">,
  config: ContextEngineConfig = DEFAULT_CONFIG,
): { violation: boolean; reason?: string } {
  const context = getContext(caseId);
  if (!context) return { violation: false };
  
  const fullAction: AgentAction = {
    ...action,
    timestamp: new Date().toISOString(),
  };
  
  return checkLoopViolation(fullAction, context, config);
}

// ── Labor Management ────────────────────────────────────────────────

/**
 * Set labor estimate as draft (non-blocking)
 */
export function setLaborDraft(caseId: string, estimatedHours: number): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.labor = {
    ...context.labor,
    mode: "draft",
    estimatedHours,
    draftGeneratedAt: new Date().toISOString(),
  };
  updateContext(context);
}

/**
 * Confirm labor hours
 */
export function confirmLaborHours(caseId: string, confirmedHours: number): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.labor = {
    ...context.labor,
    mode: "confirmed",
    confirmedHours,
  };
  updateContext(context);
}

/**
 * Check if labor confirmation is blocking
 */
export function isLaborBlocking(caseId: string): boolean {
  const context = getContext(caseId);
  if (!context) return false;
  return context.labor.confirmationRequired && context.labor.mode !== "confirmed";
}

// ── Mode Management ─────────────────────────────────────────────────

/**
 * Set the current mode
 */
export function setMode(caseId: string, mode: Mode): void {
  const context = getContext(caseId);
  if (!context) return;
  
  context.mode = mode;
  updateContext(context);
}

/**
 * Get the current mode
 */
export function getMode(caseId: string): Mode | undefined {
  return getContext(caseId)?.mode;
}

// ── Exports ─────────────────────────────────────────────────────────

export {
  detectIntent,
  describeIntent,
  isClarificationRequest,
} from "./intent-router";

export {
  checkLoopViolation,
  generateAntiLoopDirectives,
  isFallbackResponse,
} from "./loop-guard";

export {
  shouldReplan,
  executeReplan,
  buildReplanNotice,
  isInReplanState,
  clearReplanState,
} from "./replan";

export {
  pushTopic,
  popTopic,
  isInClarificationSubflow,
  getCurrentClarificationTopic,
  buildReturnToMainInstruction,
} from "./topic-stack";
