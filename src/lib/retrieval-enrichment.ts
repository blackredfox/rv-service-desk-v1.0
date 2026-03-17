/**
 * Retrieval Enrichment Layer
 *
 * Provides bounded, optional, failure-tolerant enrichment for the active
 * diagnostic step based on equipment identity (manufacturer/model).
 *
 * CONSTRAINTS:
 * - Enrichment is ADDITIVE only — it cannot alter the active step or sequence.
 * - If no enrichment data is available, returns null (generic path continues).
 * - Must never throw — all failures return null.
 * - Must never reference steps other than the one provided.
 */

import type { EquipmentIdentity } from "./context-engine/types";

export type StepEnrichment = {
  /** Manufacturer-specific hint for the active step */
  hint: string;
  /** Source label (for traceability) */
  source: string;
};

// ── Enrichment Knowledge Base ───────────────────────────────────────
//
// Keyed by: manufacturer → system → stepId → enrichment
// This is a static lookup. In the future, this could be backed by a
// vector store or external API, but the contract remains the same.

type EnrichmentEntry = {
  hint: string;
  /** Optional: only apply if model matches (substring) */
  modelFilter?: string;
};

const ENRICHMENT_DB: Record<string, Record<string, Record<string, EnrichmentEntry[]>>> = {
  Suburban: {
    water_heater: {
      wh_1: [{ hint: "Suburban gas water heaters use DSI (Direct Spark Ignition). Common models: SW6DE (6-gal), SW10DE (10-gal), SW16DE (16-gal). The 'D' means DSI, 'E' means electric element (combo)." }],
      wh_5: [{ hint: "Suburban 12V power enters through a 2-pin connector on the back of the gas valve/ECO assembly. Check for corroded pins." }],
      wh_6: [
        { hint: "Suburban DSI uses a spark electrode near the burner tube. You should hear rapid clicking when the board calls for ignition. If no click, check electrode gap (1/8\") and wiring to the board.", modelFilter: "SW" },
        { hint: "Suburban water heaters use Direct Spark Ignition (DSI). Listen for clicking from the spark electrode when the unit calls for heat." },
      ],
      wh_8: [{ hint: "Suburban gas valves are solenoid-operated. With 12V at the valve and no gas flow, the solenoid coil may be open. Measure resistance across coil: expect 30-60 ohms." }],
      wh_9: [{ hint: "Suburban uses an electrode-style flame sensor (not a thermocouple). It must be clean and positioned in the flame path. The board monitors flame current — typically 1-4 microamps." }],
      wh_10: [{ hint: "Suburban burner tubes are prone to mud dauber nests and spider webs. Remove the outer door and inspect the tube with a flashlight. The orifice is brass and should not be drilled out — replace if damaged." }],
      wh_12: [{ hint: "Suburban ECO reset is a small red button on the gas valve body. It trips at ~180°F. If it keeps tripping, check for blocked flue or thermostat failure." }],
      wh_13: [{ hint: "Suburban units are sensitive to low LP pressure. At the inlet fitting, expect 11\" WC. Below 10\" WC will cause ignition failure or weak flame." }],
    },
    furnace: {
      furn_1: [{ hint: "Suburban furnaces: the blower has a time delay — board energizes igniter first, then opens gas valve, then starts blower after flame is confirmed." }],
      furn_2: [{ hint: "Suburban furnaces use DSI (spark ignition). The electrode is near the burner orifice. Check gap and wire connection to the board." }],
    },
  },
  Atwood: {
    water_heater: {
      wh_1: [{ hint: "Atwood (now Dometic) gas water heaters use a pilot or DSI system depending on model. G6A/G10 series are pilot; GC series are DSI." }],
      wh_6: [
        { hint: "Atwood GC-series uses DSI with a spark electrode. Listen for clicking. Older G6A/G10 models use a standing pilot — check if pilot is lit.", modelFilter: "GC" },
        { hint: "Atwood G6A/G10 pilot models: check if the pilot is lit. If not, try relighting per label instructions. Thermocouple must be in pilot flame.", modelFilter: "G" },
      ],
      wh_9: [{ hint: "Atwood pilot models use a standard thermocouple (not flame sensor). Expected output: 25-35mV in flame. Replace if below 20mV." }],
      wh_10: [{ hint: "Atwood burner tubes: the inner burner assembly can be removed for cleaning. Check the orifice and venturi for blockage." }],
    },
  },
  Dometic: {
    water_heater: {
      wh_1: [{ hint: "Dometic water heaters (successor to Atwood): newer models have electronic control boards with LED fault codes. Check the board first." }],
    },
    roof_ac: {
      ac_1: [{ hint: "Dometic Brisk/Penguin AC: if compressor hums but won't start, check the run capacitor. Common failure on these units." }],
      ac_5: [{ hint: "Dometic AC capacitors are dual-run type (serves both compressor and fan). Check both microfarad ratings." }],
    },
    refrigerator: {
      ref_1: [{ hint: "Dometic absorption refrigerators: completely dead usually means the control board has failed. Check for 12V at the board." }],
      ref_5: [{ hint: "Dometic cooling units: the boiler area (back, lower) should be hot to the touch during operation. If cold, the cooling unit has likely failed (ammonia leak)." }],
    },
  },
  Norcold: {
    refrigerator: {
      ref_1: [{ hint: "Norcold refrigerators: check for recall status first (some models had fire risk). If the unit shows a 'no co' or flashing code, the control board needs replacement." }],
      ref_5: [{ hint: "Norcold cooling units: feel the absorber coils at the back. Should be warm/hot on LP or AC. If cold, cooling unit failure is likely." }],
    },
  },
  Lippert: {
    slide_out: {
      so_1: [{ hint: "Lippert (LCI) slide-outs: Schwintek systems use small in-wall motors. If motor runs but slide doesn't move, the gear rack may have stripped teeth." }],
      so_4: [{ hint: "Lippert Schwintek gear racks: inspect the nylon gear teeth along the slide rail. Stripped teeth appear as a flat spot. Replace the entire rack section." }],
    },
    leveling: {
      lv_1: [{ hint: "Lippert leveling: the pump is usually under the frame near the battery. If no motor sound, check the main relay on the control box." }],
    },
  },
  Carefree: {
    awning: {
      awn_1: [{ hint: "Carefree electric awnings: 12V power comes from the coach battery through a dedicated fuse. Check the awning fuse in the 12V panel first." }],
      awn_6: [{ hint: "Carefree awning motors: if motor is dead with direct 12V, the motor has failed. Carefree motors are replaceable without removing the entire awning." }],
    },
  },
  Shurflo: {
    water_pump: {
      wp_1: [{ hint: "Shurflo 4008/4048 series: these pumps have a built-in pressure switch. If pump runs but doesn't stop, the switch diaphragm may be torn." }],
      wp_2: [{ hint: "Shurflo pumps draw 4-7A at 12V. If voltage is present but pump doesn't run, check for a thermal overload reset (small button on pump body)." }],
    },
  },
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Look up enrichment for a diagnostic step given the equipment identity.
 *
 * Returns null if:
 * - No manufacturer is known
 * - No enrichment exists for this manufacturer/system/step
 * - An error occurs (failure-tolerant)
 */
export function getStepEnrichment(
  stepId: string,
  system: string,
  identity: EquipmentIdentity,
): StepEnrichment | null {
  try {
    if (!identity.manufacturer) return null;

    const mfgData = ENRICHMENT_DB[identity.manufacturer];
    if (!mfgData) return null;

    const systemData = mfgData[system];
    if (!systemData) return null;

    const entries = systemData[stepId];
    if (!entries || entries.length === 0) return null;

    // Find the best match: prefer model-filtered entry, fall back to generic
    let bestEntry: EnrichmentEntry | null = null;

    for (const entry of entries) {
      if (entry.modelFilter && identity.model) {
        if (identity.model.toUpperCase().startsWith(entry.modelFilter.toUpperCase())) {
          bestEntry = entry;
          break; // Model-specific match takes priority
        }
      } else if (!entry.modelFilter) {
        // Generic entry (no model filter) — use if no better match found
        if (!bestEntry) bestEntry = entry;
      }
    }

    if (!bestEntry) {
      // Fall back to first entry with no model filter
      bestEntry = entries.find(e => !e.modelFilter) ?? null;
    }

    if (!bestEntry) return null;

    return {
      hint: bestEntry.hint,
      source: `${identity.manufacturer}${identity.model ? ` ${identity.model}` : ""} knowledge base`,
    };
  } catch {
    // Failure-tolerant: never throw
    return null;
  }
}
