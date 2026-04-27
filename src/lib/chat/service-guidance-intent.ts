import type { Language } from "@/lib/lang";

const SERVICE_GUIDANCE_PATTERNS: RegExp[] = [
  /\bslide\s*(?:&|and|\/)?\s*jack\s+service\b/i,
  /\bslide\s*(?:&|and|\/)?\s*jack\s+maintenance\b/i,
  /\b(?:service|maintenance)\b[^\n]{0,80}\b(?:how\s+to|correctly|first\s+time)\b/i,
  /\bhow\s+to\s+do\s+it\b/i,
  /(?:обслуживан|сервис)[^\n]{0,100}(?:slide|jack|слайд|домкрат)/iu,
  /(?:как\s+это\s+сделать\s+правильно|как\s+сделать\s+правильно)/iu,
];

const ACTIVE_FAULT_PATTERNS: RegExp[] = [
  /\b(?:not\s+working|doesn'?t\s+work|won'?t\s+(?:move|extend|retract|work)|stuck|broken|failed|leak(?:ing)?|no\s+power|fault|issue|problem)\b/i,
  /(?:не\s+работает|не\s+двигается|застрял|сломал|сломано|теч[её]т|нет\s+питания|неисправ|проблема)/iu,
  /\b(?:no\s+funciona|atascado|roto|falla|problema)\b/iu,
];

export function detectServiceGuidanceIntent(message: string): boolean {
  const asksForGuidance = SERVICE_GUIDANCE_PATTERNS.some((pattern) => pattern.test(message));
  if (!asksForGuidance) return false;
  const reportsFault = ACTIVE_FAULT_PATTERNS.some((pattern) => pattern.test(message));
  return !reportsFault;
}

export function buildServiceGuidanceResponse(language: Language): string {
  switch (language) {
    case "RU":
      return [
        "Да, это service/maintenance задача, не диагностика неисправности. Безопасный порядок для RV slide & jack service:",
        "1. Поставьте RV на ровную площадку, включите park brake, подложите chocks под колёса. Не работайте под coach, если он не поддержан надёжными опорами — одни hydraulic/electric jacks не считаются безопасной опорой.",
        "2. Определите тип системы: hydraulic или electric slides/jacks, модель контроллера и требования OEM manual.",
        "3. Осмотрите jacks, slide rails/arms, mounting hardware, hoses, wiring, connectors and fasteners. Ищите утечки, коррозию, ослабленные крепления, повреждённые провода и износ.",
        "4. Для hydraulic system проверьте уровень fluid по OEM procedure, состояние reservoir, hoses and fittings. Не смешивайте жидкости, если manual этого не допускает.",
        "5. Очистите открытые rails/arms/ram surfaces от грязи. Смазывайте только точки и продукты, разрешённые производителем; многие slide systems не требуют смазки на всех направляющих.",
        "6. Полностью cycle slides and jacks несколько раз, наблюдая за ровным движением, шумами, перекосом, drift-down и ошибками контроллера.",
        "7. После проверки задокументируйте findings, выполненное обслуживание, обнаруженные leaks/wear, и что требует отдельной диагностики или customer approval.",
        "Если скажете марку системы или тип jacks/slides, я могу сузить чеклист под конкретную конфигурацию.",
      ].join("\n");
    case "ES":
      return [
        "Sí — esto es una solicitud de servicio/mantenimiento, no una continuación de diagnóstico. Lista segura para RV slide & jack service:",
        "1. Coloque el RV en terreno nivelado, freno aplicado y ruedas calzadas. No trabaje debajo del coach sin soportes aprobados; los jacks por sí solos no son soporte seguro.",
        "2. Identifique el sistema: hidráulico o eléctrico, modelo del controlador y procedimiento del manual OEM.",
        "3. Inspeccione jacks, mecanismos de slide, herrajes, mangueras, cableado, conectores y sujetadores. Busque fugas, corrosión, desgaste y conexiones flojas.",
        "4. Si es hidráulico, revise nivel de fluido según OEM, depósito, hoses and fittings. No mezcle fluidos si el manual no lo permite.",
        "5. Limpie rails/arms/ram surfaces visibles. Lubrique solo puntos/productos aprobados por el fabricante.",
        "6. Cycle slides and jacks varias veces y verifique movimiento suave, ruidos, desalineación, drift-down y códigos del controlador.",
        "7. Documente hallazgos, servicio realizado y cualquier punto que requiera diagnóstico separado o aprobación del cliente.",
      ].join("\n");
    default:
      return [
        "Yes — this is a service/maintenance request, not an active fault diagnostic. Safe RV slide & jack service checklist:",
        "1. Park on level ground, set the parking brake, and chock the wheels. Never work under an unsupported coach; jacks alone are not a safe support.",
        "2. Identify the system type: hydraulic or electric slides/jacks, controller model, and OEM manual requirements.",
        "3. Inspect jacks, slide rails/arms, mounting hardware, hoses, wiring, connectors, and fasteners for leaks, corrosion, loose hardware, damage, and wear.",
        "4. If hydraulic, check fluid level by the OEM procedure and inspect the reservoir, hoses, and fittings. Do not mix fluids unless the manual allows it.",
        "5. Clean exposed rails/arms/ram surfaces. Lubricate only manufacturer-approved points with approved products.",
        "6. Cycle slides and jacks several times and verify smooth movement, no binding, no drift-down, normal noises, and no controller errors.",
        "7. Document findings, service performed, leaks/wear found, and anything needing separate diagnosis or customer approval.",
        "If you share the system brand/type, I can narrow this checklist to that setup.",
      ].join("\n");
  }
}