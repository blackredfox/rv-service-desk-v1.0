# PROCEDURE_CATALOG_FRAMEWORK.md

**Project:** RV Service Desk  
**Version:** 1.0  
**Status:** Framework Definition (Pre-Implementation)  
**Created:** 2026-01-XX

---

# 1. Purpose

This document defines the **Procedure Catalog Framework** — a structured, scalable system for authoring and managing diagnostic procedures across RV equipment families.

The goal is to replace ad-hoc procedure fixes with a **consistent, deterministic, shop-realistic** procedure system.

---

# 2. What is a Procedure?

A **Procedure** is a structured diagnostic sequence for a specific RV system.

A procedure defines:

- The **equipment family** (e.g., water_heater, furnace)
- The **subtype hierarchy** (e.g., gas-only → DSI → tank)
- The **ordered steps** a technician must follow
- The **branch conditions** that control flow
- The **completion criteria** for isolation
- The **forbidden outputs** before isolation is complete

**Principle:**

```
Procedure is law.
The procedure chooses the step.
The LLM renders the step.
Retrieval enriches wording only.
```

---

# 3. Procedure Schema

## 3.1 Top-Level Structure

Every procedure MUST contain:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique procedure identifier (e.g., `water_heater_gas_dsi`) |
| `family` | string | Yes | Equipment family (e.g., `water_heater`) |
| `displayName` | string | Yes | Human-readable name |
| `subtype` | SubtypeDefinition | Yes | Hierarchical subtype structure |
| `classification` | `complex` \| `non_complex` | Yes | Determines diagnostic rigor |
| `variant` | `STANDARD` \| `MANUFACTURER` | Yes | Procedure source |
| `requiredIntakeFacts` | string[] | Yes | Facts needed before step 1 |
| `firstStepLogic` | FirstStepRule[] | Yes | Rules for selecting initial step |
| `steps` | ProcedureStep[] | Yes | Ordered step definitions |
| `branches` | BranchDefinition[] | Yes | Conditional branch rules |
| `completionCriteria` | CompletionCriteria | Yes | When isolation is complete |
| `destructiveFindings` | DestructiveFinding[] | No | Findings that may shortcut diagnosis |
| `forbiddenBeforeIsolation` | string[] | Yes | Outputs blocked until isolation |

---

## 3.2 Subtype Definition

Subtypes are **hierarchical** and **gated**.

```
Family → Subtype → Variant
```

### Structure

```typescript
type SubtypeDefinition = {
  // Level 1: Primary subtype (required)
  primary: {
    key: string;           // e.g., "fuel_type"
    options: string[];     // e.g., ["gas_only", "electric_only", "combo"]
    required: boolean;     // Must be known before proceeding
  };
  
  // Level 2: Secondary subtype (optional, conditional)
  secondary?: {
    key: string;           // e.g., "ignition_type"
    appliesTo: string[];   // e.g., ["gas_only", "combo"]
    options: string[];     // e.g., ["dsi", "manual", "hot_surface"]
    required: boolean;
  };
  
  // Level 3: Tertiary subtype (optional, conditional)
  tertiary?: {
    key: string;           // e.g., "tank_type"
    appliesTo: string[];   // e.g., ["gas_only", "combo"]
    options: string[];     // e.g., ["tank", "tankless"]
    required: boolean;
  };
};
```

### Example: Water Heater

```
Primary:    fuel_type     → gas_only | electric_only | combo
Secondary:  ignition_type → dsi | manual | hot_surface (applies to gas_only, combo)
Tertiary:   tank_type     → tank | tankless (applies to gas_only, combo)
```

### Subtype Gating Rules

1. Steps MAY declare `subtypeGate` — a condition that must be true for the step to be valid
2. If `subtypeGate` is not met, the step is **skipped** (not asked, not blocked)
3. Subtype-gated steps MUST NOT leak into incompatible paths
4. Unknown subtype = ask for clarification ONCE, then proceed with conservative defaults

---

## 3.3 Step Definition

Each step represents a single diagnostic question or action.

### Required Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique step ID (e.g., `wh_gas_3`) |
| `question` | string | Yes | Exact question to ask |
| `category` | StepCategory | Yes | `default` \| `advanced` \| `expert` |
| `prerequisites` | string[] | Yes | Step IDs that must be completed first |
| `subtypeGate` | SubtypeCondition \| null | No | Subtype condition for step validity |
| `matchPatterns` | RegExp[] | Yes | Patterns indicating step is answered |
| `howToCheck` | string \| null | No | Instruction if technician asks "how?" |
| `acceptsUnable` | boolean | Yes | Whether "can't check" is valid |
| `branchTriggers` | BranchTrigger[] | No | Conditions that trigger branch changes |

### Step Categories

| Category | Description | When to Use |
|----------|-------------|-------------|
| `default` | Normal shop-floor check | Visual, audible, simple tool checks |
| `advanced` | Requires specific tools/measurements | Multimeter readings, pressure gauges |
| `expert` | Specialized bench-level check | Rarely performed in normal service |

**Rule:** Only `default` steps may appear in the initial diagnostic flow. `advanced` and `expert` steps require explicit conditions or technician request.

### Subtype Condition

```typescript
type SubtypeCondition = {
  level: "primary" | "secondary" | "tertiary";
  key: string;
  includes?: string[];  // Step valid if subtype is one of these
  excludes?: string[];  // Step invalid if subtype is one of these
};
```

**Example:**

```typescript
subtypeGate: {
  level: "primary",
  key: "fuel_type",
  includes: ["gas_only", "combo"]
}
// This step only appears for gas or combo units
```

---

## 3.4 Branch Definition

Branches represent conditional diagnostic paths triggered by findings.

### Structure

```typescript
type BranchDefinition = {
  id: string;                    // e.g., "no_spark_branch"
  displayName: string;           // "No Spark / No Click"
  triggerCondition: BranchTrigger;
  entryStepId: string;           // First step of this branch
  exitConditions: ExitCondition[];
  mutuallyExclusive?: string[];  // Other branches that cannot be active
};

type BranchTrigger = {
  sourceStepId: string;          // Step that triggers branch
  pattern: RegExp;               // Pattern in technician response
  factRequired?: string;         // Fact that must be present
};

type ExitCondition = {
  type: "step_complete" | "finding_confirmed" | "unable_to_verify";
  stepId?: string;
  finding?: string;
};
```

### Branching Rules

1. **Mutual Exclusivity**: Some branches cannot be active simultaneously (e.g., "no spark" vs "flame lights then drops")
2. **Branch Entry**: A branch is entered when its trigger condition is met
3. **Branch Exit**: A branch is exited when its exit condition is met
4. **No Parallel Branches**: Only one diagnostic branch may be active at a time
5. **Branch Memory**: Once a branch is exited, its steps are marked complete (not re-asked)

### Standard Branch Types

| Branch Type | Description | Example |
|-------------|-------------|---------|
| `no_power` | No electrical power to component | 12V not present at terminals |
| `no_ignition` | Ignition system failure | No spark, no glow |
| `no_fuel` | Fuel delivery failure | No gas flow, blocked orifice |
| `flame_failure` | Flame lights but fails | Flame sensor, thermocouple |
| `mechanical` | Mechanical component failure | Seized motor, stripped gear |
| `control` | Control system failure | Bad board, failed relay |

---

## 3.5 Completion Criteria

Defines when diagnostic isolation is complete.

### Structure

```typescript
type CompletionCriteria = {
  // All steps complete (normal completion)
  allStepsComplete: boolean;
  
  // OR: Key finding confirmed
  keyFindingConfirmed?: {
    findings: string[];           // Any of these findings = complete
    requiresVerification: boolean; // Must be verified by specific step
  };
  
  // OR: Explicit technician declaration
  explicitDeclaration?: {
    commands: string[];           // e.g., ["isolation complete", "found the problem"]
  };
  
  // Minimum steps before completion allowed
  minimumSteps?: number;
  
  // Steps that MUST be complete before isolation
  requiredSteps?: string[];
};
```

### Completion Rules

1. Complex systems require **all prerequisite chains** to be satisfied
2. A key finding MAY allow early completion, but only if `requiresVerification` is met
3. Technician declaration alone is NOT sufficient for complex systems
4. Non-complex systems may complete with fewer checks

---

## 3.6 Destructive Findings

Findings that indicate component failure without further testing.

### Structure

```typescript
type DestructiveFinding = {
  id: string;
  pattern: RegExp;               // Pattern in technician message
  description: string;           // What was found
  componentAffected: string;     // Which component
  allowsEarlyIsolation: boolean; // Can skip remaining steps
  requiresVisualConfirmation: boolean;
};
```

### Examples

| Finding | Description | Early Isolation |
|---------|-------------|-----------------|
| Burnt orifice | Orifice visibly damaged | Yes |
| Cracked housing | Housing has visible crack | Yes |
| Seized motor | Motor locked, won't turn | Yes (after direct power test) |
| Spider debris | Burner blocked by debris | No (may be cleanable) |

### Destructive Finding Rules

1. Destructive findings MUST be acknowledged immediately
2. If `allowsEarlyIsolation` is true, remaining steps may be skipped
3. If `requiresVisualConfirmation` is true, technician must confirm visually
4. Destructive finding does NOT automatically generate cause — technician controls final report

---

## 3.7 Unable-to-Verify Handling

How the system handles "can't check" responses.

### Rules

1. Every step with `acceptsUnable: true` allows "can't check" as valid response
2. "Unable" responses close the step permanently (no re-asking)
3. If ALL paths are blocked by "unable", the procedure surfaces this to technician
4. "Unable" is NOT a loop trigger — it is a valid diagnostic state
5. Steps with `acceptsUnable: false` must be answered (or branch is blocked)

### Unable States

| State | Meaning | Action |
|-------|---------|--------|
| `unable_no_tool` | Technician lacks measurement tool | Skip to next step |
| `unable_no_access` | Cannot physically access | Skip, note limitation |
| `unable_unsafe` | Check would be unsafe | Skip, do not pursue |
| `unable_already_done` | Already checked elsewhere | Accept previous answer |

---

## 3.8 Forbidden Outputs Before Isolation

Outputs that MUST NOT be generated until isolation is complete.

### Default Forbidden List

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

### Rules

1. These outputs are blocked at the **Context Engine** level
2. LLM prompts include explicit prohibition
3. If LLM violates, output is rejected and regenerated
4. The block may only be released through a server-owned, legality-gated
   transition. Approved trigger paths include:
   - explicit technician commands (e.g., `START FINAL REPORT`),
   - server-approved natural-language aliases that deterministically
     normalize to an approved trigger class,
   - server-owned, legality-gated CTA/button controls that resolve to
     the same approved transition class.
   In all cases the relevant readiness/legality gate must be satisfied
   server-side. LLM wording or client-side heuristics MUST NOT release
   the block on their own. See `docs/CUSTOMER_BEHAVIOR_SPEC.md` and
   `ARCHITECTURE_RULES.md` (Rules M1, M1a, M1b).

---

# 4. Retrieval Boundary

## 4.1 What Retrieval Can Do

- Provide location hints ("The gas valve is behind the access panel on the right side")
- Provide naming variations ("Atwood calls this the 'ECO reset', Suburban uses 'high-limit'")
- Provide common failure notes ("This model is known for spider debris in the burner tube")
- Provide torque specs, clearances, or adjustment values

## 4.2 What Retrieval Cannot Do

- Pick the next diagnostic step
- Change the procedure branch
- Skip steps based on model
- Override procedure logic
- Declare isolation complete

## 4.3 Retrieval Unavailable

If retrieval returns no results:

- Procedure continues unchanged
- Generic step wording is used
- No blocking, no loop, no error

**Principle:** Retrieval is enhancement, not control.

---

# 5. Realism Standard

## 5.1 Step Categories in Practice

### Default Steps (Always Acceptable)

- Visual inspection (damage, corrosion, debris)
- Audible checks (click, hum, spark sound)
- Tactile checks (vibration, heat, airflow)
- Simple position checks (valve open/closed, switch on/off)
- Basic continuity (fuse good/bad)
- Presence checks (flame present, pump running)

### Advanced Steps (Conditional Only)

- Voltage measurements at specific points
- Pressure readings (LP, water)
- Resistance measurements
- Current draw readings
- Thermocouple millivolt readings

### Expert Steps (Rare, On-Request Only)

- Oscilloscope readings
- Board-level diagnostics
- Refrigerant pressures
- Sealed system tests

## 5.2 Realism Rules

1. **Default flow uses default steps only** — advanced steps require explicit trigger
2. **Never assume technician has specialized tools** unless confirmed
3. **"Unable to measure" is always valid** for advanced steps
4. **Never repeat advanced checks** — once answered or unable, closed permanently
5. **Millivolt readings are ADVANCED** — not default flame sensor check
6. **Pressure readings are ADVANCED** — not default LP check

## 5.3 Realistic Step Sequencing

**Good (Realistic):**
```
1. Does the pump run when faucet opened? (audible/visual)
2. Any humming or clicking? (audible)
3. Check fuse condition (visual/continuity)
4. [If power confirmed] Voltage at pump terminals? (advanced, conditional)
```

**Bad (Unrealistic):**
```
1. Measure voltage at pump terminals (advanced as first step)
2. Check pressure switch output voltage (advanced)
3. Measure ground resistance to chassis (advanced)
```

---

# 6. Stop Conditions

## 6.1 When Procedure Stops

| Condition | Action |
|-----------|--------|
| All steps complete | Summarize, prompt for final report |
| Key finding confirmed | Acknowledge, offer to continue or stop |
| Destructive finding | Acknowledge, note as isolation candidate |
| Technician requests stop | Accept, summarize current state |
| All branches blocked (unable) | Surface limitation, offer partial report |

## 6.2 When Procedure Does NOT Stop

| Condition | Action |
|-----------|--------|
| Single finding noted | Continue remaining checks |
| Advanced check skipped | Continue with default path |
| Subtype unknown | Use conservative defaults |
| Retrieval unavailable | Continue with generic wording |

---

# 7. Manufacturer/Model Variations

## 7.1 How Variations Are Handled

Manufacturer-specific procedures are separate procedure definitions:

```
water_heater_standard      (default)
water_heater_suburban_sw6  (manufacturer-specific)
water_heater_atwood_g6a    (manufacturer-specific)
```

## 7.2 Selection Logic

1. If manufacturer/model known → use manufacturer procedure if available
2. If manufacturer procedure not available → fall back to standard
3. If manufacturer unknown → use standard, do not block

## 7.3 What Variations Can Change

- Step wording (location, naming)
- Step order (if manufacturer has different sequence)
- Additional steps (model-specific checks)
- Different completion criteria

## 7.4 What Variations Cannot Change

- Architecture rules (procedure chooses step)
- Forbidden outputs
- Subtype gating logic
- Branch mutual exclusivity

---

# 8. Framework Compliance Checklist

Every procedure MUST pass:

- [ ] Has unique ID following naming convention
- [ ] Has complete subtype definition
- [ ] All steps have valid category assignment
- [ ] No advanced steps in default flow without trigger
- [ ] All branches have entry and exit conditions
- [ ] Completion criteria defined
- [ ] Forbidden outputs list present
- [ ] No subtype leakage (steps gated correctly)
- [ ] Destructive findings documented
- [ ] "Unable" handling defined for all advanced steps

---

# 9. Migration Strategy

## 9.1 Current System Strengths

- Procedure-driven architecture is correct
- Step prerequisites already implemented
- Match patterns for step completion exist
- How-to-check support exists
- Context Engine authority is established

## 9.2 Current System Gaps

- No subtype hierarchy (flat structure)
- No step categories (default/advanced/expert)
- No branch definitions (implicit only)
- No completion criteria (all-steps-only)
- Advanced checks mixed with default checks
- No destructive finding shortcuts
- No forbidden output enforcement at procedure level

## 9.3 Migration Path

**Phase 1:** Add schema types (non-breaking)
**Phase 2:** Migrate water_heater to new schema (first full rewrite)
**Phase 3:** Validate with testing, iterate
**Phase 4:** Migrate remaining procedures in priority order
**Phase 5:** Deprecate old flat procedure format

---

# 10. Summary

The Procedure Catalog Framework provides:

1. **Structured schema** for all procedure definitions
2. **Hierarchical subtype control** preventing wrong questions
3. **Step categorization** ensuring realistic default flows
4. **Branch definitions** for deterministic conditional paths
5. **Completion criteria** for proper isolation detection
6. **Retrieval boundaries** keeping procedure in control
7. **Realism standards** for shop-appropriate questions

**This framework enables systematic procedure development instead of ad-hoc fixes.**
