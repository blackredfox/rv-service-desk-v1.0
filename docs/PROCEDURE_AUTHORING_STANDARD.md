# PROCEDURE_AUTHORING_STANDARD.md

**Project:** RV Service Desk  
**Version:** 1.0  
**Status:** Authoring Guidelines (Pre-Implementation)  
**Created:** 2026-01-XX

---

# 1. Purpose

This document defines **how to write diagnostic procedures** for the RV Service Desk Procedure Catalog.

All new procedures and procedure rewrites MUST follow these standards.

---

# 2. Naming Conventions

## 2.1 Procedure ID

Format: `{family}_{subtype}_{variant}`

| Component | Format | Examples |
|-----------|--------|----------|
| Family | snake_case | `water_heater`, `furnace`, `roof_ac` |
| Subtype | snake_case | `gas_only`, `combo`, `dsi` |
| Variant | snake_case | `standard`, `suburban_sw6` |

**Examples:**
```
water_heater_gas_dsi_standard
water_heater_combo_standard
furnace_standard
roof_ac_dometic_standard
```

## 2.2 Step ID

Format: `{family_abbrev}_{subtype_abbrev}_{number}`

| Family | Abbreviation |
|--------|--------------|
| water_heater | wh |
| water_pump | wp |
| furnace | furn |
| roof_ac | ac |
| refrigerator | ref |
| slide_out | so |
| leveling | lv |
| inverter_converter | ic |
| electrical_12v | e12 |
| electrical_ac | eac |
| lp_gas | lpg |

**Subtype Abbreviations:**
```
gas_only    → g
electric    → e
combo       → c
dsi         → d
manual      → m
standard    → (none)
```

**Examples:**
```
wh_g_1      → Water heater, gas-only, step 1
wh_c_d_3   → Water heater, combo, DSI, step 3
furn_5      → Furnace, step 5 (no subtype)
```

## 2.3 Branch ID

Format: `{family_abbrev}_branch_{condition}`

**Examples:**
```
wh_branch_no_spark
wh_branch_flame_dropout
furn_branch_no_ignition
ac_branch_compressor_fail
```

---

# 3. Step Writing Rules

## 3.1 Question Style

### DO:
- Ask ONE specific question per step
- Use technician-level language
- Be direct and concise
- Include expected response type when helpful

### DON'T:
- Ask compound questions ("Is X and also Y?")
- Use consumer language
- Include safety lectures
- Ask vague open-ended questions

**Good:**
```
"Does the pump attempt to run when a faucet is opened? Any noise or humming?"
"Is 12V present at the pump terminals with faucet open?"
"Burner flame color — blue, yellow, or no flame?"
```

**Bad:**
```
"Can you tell me more about what's happening with the water heater?"
"Please check the voltage and also the ground and also the connections."
"Make sure to wear safety glasses and then check if there's power."
```

## 3.2 Question Categories

Every step MUST be assigned a category:

### Default Steps

Questions that:
- Require no specialized tools
- Can be answered by observation, listening, or simple checks
- Are standard in typical RV service workflow

**Examples:**
```
"Does the blower motor run when furnace calls for heat?"
"Any clicking or sparking sound from the igniter?"
"Is the manual gas shutoff valve open?"
"Visible damage, corrosion, or debris?"
```

### Advanced Steps

Questions that:
- Require multimeter, pressure gauge, or specific tools
- Involve measurements with specific values
- Are not part of typical first-pass diagnosis

**Examples:**
```
"Measure voltage at pump terminals — reading?"
"Regulator output pressure at test port — WC reading?"
"Thermocouple millivolt reading with flame present?"
"Capacitor microfarad reading?"
```

### Expert Steps

Questions that:
- Require specialized equipment
- Are rarely performed in field service
- Typically require bench-level work

**Examples:**
```
"Oscilloscope reading on control board signal?"
"Refrigerant high-side pressure?"
"Sealed system vacuum test result?"
```

## 3.3 Category Assignment Rules

1. **Default steps ONLY in main flow** — advanced/expert require triggers
2. **Never assume tool availability** for advanced steps
3. **Advanced steps must accept "unable"** as valid response
4. **Expert steps should be rare** — most procedures have none
5. **When in doubt, mark as advanced**

---

# 4. Prerequisite Rules

## 4.1 Prerequisite Definition

Prerequisites define which steps must be completed before a step can be asked.

```typescript
{
  id: "wh_g_6",
  question: "Does the burner flame light?",
  prerequisites: ["wh_g_4", "wh_g_5"], // Gas valve AND 12V must be confirmed
}
```

## 4.2 Prerequisite Guidelines

### Required Prerequisites

| Step Type | Must Have Prerequisite |
|-----------|----------------------|
| Ignition check | Gas supply confirmed, 12V confirmed |
| Flame quality | Ignition confirmed |
| Component voltage | Power supply confirmed |
| Downstream check | Upstream check completed |

### Prerequisite Anti-Patterns

**Bad: No Prerequisites on Dependent Check**
```typescript
{
  id: "wh_g_7",
  question: "Flame sensor reading?",
  prerequisites: [], // WRONG — flame must exist first
}
```

**Bad: Circular Prerequisites**
```typescript
// Step A requires B, Step B requires A — impossible
```

**Bad: Over-Constrained Prerequisites**
```typescript
{
  id: "wh_g_2",
  question: "LP tank level?",
  prerequisites: ["wh_g_1", "wh_g_3", "wh_g_4"], // Too many for basic check
}
```

## 4.3 Prerequisite Chain Validation

Before a procedure is accepted:

1. All prerequisite references must exist
2. No circular dependencies
3. First step(s) must have empty prerequisites
4. Every step must be reachable from start

---

# 5. Subtype Gating Rules

## 5.1 When to Use Subtype Gates

Use subtype gates when a step:
- Only applies to specific fuel types (gas/electric/combo)
- Only applies to specific ignition types (DSI/manual)
- Only applies to specific configurations

## 5.2 Gate Definition

```typescript
{
  id: "wh_c_11",
  question: "For COMBO units: Does the electric element work?",
  subtypeGate: {
    level: "primary",
    key: "fuel_type",
    includes: ["combo"]
  }
}
```

## 5.3 Gate Hierarchy

Gates are evaluated in order:
1. Primary subtype gate
2. Secondary subtype gate (if defined)
3. Tertiary subtype gate (if defined)

All gates must pass for step to be valid.

## 5.4 Subtype Leakage Prevention

**Leakage** = A step appears when it shouldn't based on subtype.

**Example of Leakage:**
```
Technician says: "Gas-only water heater"
System asks: "Does the electric heating element work?"  // WRONG
```

**Prevention:**
- Every subtype-specific step MUST have explicit gate
- Review all steps during procedure authoring
- Test procedures with each subtype combination

---

# 6. Branching Rules

## 6.1 When to Define Branches

Define a branch when:
- A specific answer triggers a different diagnostic path
- Multiple failure modes exist for a symptom
- Findings require specialized follow-up

## 6.2 Branch Structure

```typescript
{
  id: "wh_branch_no_spark",
  displayName: "No Spark / No Click",
  triggerCondition: {
    sourceStepId: "wh_g_6",
    pattern: /no\s*(?:spark|click|ignition)/i
  },
  entryStepId: "wh_g_6a",
  exitConditions: [
    { type: "finding_confirmed", finding: "igniter_failure" },
    { type: "step_complete", stepId: "wh_g_6c" }
  ],
  mutuallyExclusive: ["wh_branch_flame_dropout"]
}
```

## 6.3 Branch Types

| Type | Trigger | Example |
|------|---------|---------|
| No-Power | No voltage at component | "0V at pump terminals" |
| No-Ignition | Ignition failure | "No spark, no click" |
| No-Fuel | Fuel delivery failure | "No gas flow" |
| Flame-Failure | Flame lights then fails | "Flame drops out after 5 seconds" |
| Mechanical | Physical/mechanical failure | "Motor seized" |
| Control | Control system failure | "Board not sending signal" |

## 6.4 Mutual Exclusivity

Some branches cannot be active simultaneously:

```
no_spark vs flame_dropout        // Can't have flame if no spark
no_fuel vs flame_quality         // Can't check flame quality without fuel
motor_seized vs motor_runs       // Contradictory states
```

Define mutual exclusivity in branch definition to prevent illogical states.

## 6.5 Branch Exit

A branch exits when:
1. A finding is confirmed (root cause found)
2. All branch steps complete (branch exhausted)
3. Unable-to-verify closes the branch path

After exit, branch steps are not re-asked.

---

# 7. How-To-Check Instructions

## 7.1 When to Include

Include `howToCheck` for:
- Steps involving specific measurement techniques
- Steps where location might be unclear
- Steps where procedure might vary by model

## 7.2 Writing How-To-Check

### DO:
- Keep it brief (2-3 sentences max)
- Be specific about tool settings
- Include expected values when relevant
- Use shop-appropriate language

### DON'T:
- Write tutorials
- Include safety warnings (technicians are trained)
- Reference specific models (use retrieval for that)
- Include multiple methods

**Good:**
```
"Set multimeter to DC volts (20V range). Measure across the 12V input terminals 
on the control board. Expected: 11.5-13.5V."
```

**Bad:**
```
"First, make sure you have a good quality multimeter. Digital is preferred but 
analog will work. Always wear safety glasses when working with electrical 
systems. To check voltage, you'll want to set your meter to the DC voltage 
setting, usually marked with a V and a straight line..."
```

## 7.3 How-To-Check and Step State

When technician asks "how do I check?":
1. Return the how-to-check instruction
2. Re-ask the SAME step for the result
3. Step remains OPEN (not completed)

---

# 8. Match Pattern Rules

## 8.1 Purpose

Match patterns detect when a technician's response answers a step.

## 8.2 Pattern Guidelines

### Include patterns for:
- Yes/no variations
- Measurement values
- Descriptive answers
- Common technician phrasing
- Multilingual support (EN/RU/ES)

### Pattern Examples

```typescript
matchPatterns: [
  /pump.*(?:run|noise|hum|vibrat|silent|nothing|dead)/i,
  /faucet.*open/i,
  /(?:yes|no|yeah|nope|si|da|нет|да)/i,
  /(?:\d+(?:\.\d+)?)\s*v(?:olts?)?/i,  // Voltage reading
]
```

## 8.3 Pattern Anti-Patterns

**Too Broad:**
```typescript
matchPatterns: [/./]  // Matches anything — BAD
```

**Too Narrow:**
```typescript
matchPatterns: [/^yes$/i]  // Only exact "yes" — BAD
```

**Missing Common Responses:**
```typescript
matchPatterns: [/yes/i]  // Missing "no", values, descriptions — BAD
```

---

# 9. Completion Criteria

## 9.1 Standard Completion

For most procedures, completion = all reachable steps done.

```typescript
completionCriteria: {
  allStepsComplete: true,
  minimumSteps: 3,
  requiredSteps: ["wh_g_1", "wh_g_5"]  // Must include type ID and 12V check
}
```

## 9.2 Key Finding Completion

Some findings allow early completion:

```typescript
completionCriteria: {
  allStepsComplete: false,
  keyFindingConfirmed: {
    findings: ["burnt_orifice", "cracked_tank", "seized_motor"],
    requiresVerification: true
  }
}
```

## 9.3 Complex System Requirements

For complex systems:
- Minimum steps must be higher
- Required steps must include key checks
- No early completion without verification

---

# 10. Destructive Finding Documentation

## 10.1 What Counts as Destructive

A finding is "destructive" if it indicates irreparable damage:

| Finding | Destructive? |
|---------|--------------|
| Burnt orifice | Yes |
| Cracked housing | Yes |
| Seized motor | Yes |
| Dirty burner | No (cleanable) |
| Tripped breaker | No (resettable) |
| Low LP level | No (refillable) |

## 10.2 Documenting Destructive Findings

```typescript
destructiveFindings: [
  {
    id: "burnt_orifice",
    pattern: /orifice.*(?:burnt|burned|melted|destroyed|damaged)/i,
    description: "Orifice visibly burnt or melted",
    componentAffected: "burner_orifice",
    allowsEarlyIsolation: true,
    requiresVisualConfirmation: true
  }
]
```

---

# 11. Forbidden Output Enforcement

## 11.1 Standard Forbidden List

Every procedure MUST include:

```typescript
forbiddenBeforeIsolation: [
  "root_cause",
  "repair_recommendation",
  "labor_estimate",
  "parts_list",
  "final_report",
  "authorization_text"
]
```

## 11.2 Procedure-Specific Additions

Some procedures may add specific forbidden outputs:

```typescript
// For complex systems, also forbid:
forbiddenBeforeIsolation: [
  ...standardForbidden,
  "component_replacement_recommendation",
  "warranty_language"
]
```

---

# 12. Realistic Flow Design

## 12.1 Flow Template

```
1. System identification (type, subtype)
2. Basic symptom confirmation
3. Power supply verification (visual → measurement)
4. Upstream checks (supply, valves, switches)
5. Component operation (run/no-run, ignite/no-ignite)
6. [Branch] Based on finding
7. Downstream verification
8. [Advanced, if needed] Measurements
9. Isolation confirmation
```

## 12.2 Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Advanced step first | Unrealistic flow | Move to conditional |
| Repeated advanced checks | Technician fatigue | Once answered, closed |
| Parallel incompatible branches | Illogical state | Use mutual exclusivity |
| No "unable" path | Blocks progress | Accept unable responses |
| Millivolt as default | Too technical for first pass | Mark as advanced |

---

# 13. Review Checklist

Before submitting a procedure:

### Structure
- [ ] Unique procedure ID following convention
- [ ] All step IDs follow naming convention
- [ ] Subtype definition complete
- [ ] All branches defined with entry/exit

### Steps
- [ ] Every step has correct category
- [ ] No advanced steps in default flow without trigger
- [ ] All prerequisites valid (no circular, no orphans)
- [ ] Subtype gates prevent leakage
- [ ] Match patterns cover common responses

### Realism
- [ ] Default flow uses only default checks
- [ ] Advanced checks are conditional
- [ ] "Unable" is valid for all advanced steps
- [ ] Flow follows logical diagnostic sequence

### Completion
- [ ] Completion criteria defined
- [ ] Destructive findings documented
- [ ] Forbidden outputs listed

---

# 14. Example: Water Heater Gas-Only DSI

```typescript
{
  id: "water_heater_gas_dsi_standard",
  family: "water_heater",
  displayName: "Water Heater (Gas-Only, DSI)",
  subtype: {
    primary: { key: "fuel_type", options: ["gas_only"], required: true },
    secondary: { key: "ignition_type", options: ["dsi"], appliesTo: ["gas_only"], required: true }
  },
  classification: "complex",
  variant: "STANDARD",
  requiredIntakeFacts: ["fuel_type", "symptom"],
  
  steps: [
    {
      id: "wh_g_d_1",
      question: "LP tank level — gauge reading? Main valve fully open?",
      category: "default",
      prerequisites: [],
      matchPatterns: [/tank.*(?:full|empty|open|closed|\d+)/i],
      howToCheck: "Check tank gauge or weigh tank. Valve handle parallel to pipe = open.",
      acceptsUnable: false
    },
    {
      id: "wh_g_d_2", 
      question: "Do other LP appliances work? (Stove, furnace)",
      category: "default",
      prerequisites: ["wh_g_d_1"],
      matchPatterns: [/(?:stove|furnace|other).*(?:work|yes|no)/i],
      acceptsUnable: true
    },
    // ... additional steps
  ],
  
  branches: [
    {
      id: "wh_branch_no_spark",
      displayName: "No Spark / No Click",
      triggerCondition: { sourceStepId: "wh_g_d_5", pattern: /no\s*(?:spark|click)/i },
      entryStepId: "wh_g_d_5a",
      exitConditions: [{ type: "finding_confirmed", finding: "igniter_failure" }],
      mutuallyExclusive: ["wh_branch_flame_dropout"]
    }
  ],
  
  completionCriteria: {
    allStepsComplete: true,
    minimumSteps: 5,
    requiredSteps: ["wh_g_d_1", "wh_g_d_4"]
  },
  
  destructiveFindings: [
    {
      id: "burnt_orifice",
      pattern: /orifice.*(?:burnt|melted|damaged)/i,
      description: "Burner orifice visibly damaged",
      componentAffected: "burner_orifice",
      allowsEarlyIsolation: true,
      requiresVisualConfirmation: true
    }
  ],
  
  forbiddenBeforeIsolation: [
    "root_cause", "repair_recommendation", "labor_estimate",
    "parts_list", "final_report", "authorization_text"
  ]
}
```

---

# 15. Summary

Procedure authoring follows strict standards:

1. **Naming** — Consistent ID format for procedures, steps, branches
2. **Questions** — Direct, single-focus, category-appropriate
3. **Prerequisites** — Logical chains, no circular dependencies
4. **Subtype Gates** — Prevent wrong questions for wrong types
5. **Branches** — Explicit triggers, exits, mutual exclusivity
6. **How-To-Check** — Brief, practical, shop-appropriate
7. **Completion** — Clear criteria, destructive findings documented
8. **Realism** — Default steps first, advanced conditional only

**Following these standards ensures consistent, shop-realistic diagnostic procedures.**
