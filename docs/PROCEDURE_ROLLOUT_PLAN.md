# PROCEDURE_ROLLOUT_PLAN.md

**Project:** RV Service Desk  
**Version:** 1.0  
**Status:** Rollout Planning (Pre-Implementation)  
**Created:** 2026-01-XX

---

# 1. Purpose

This document defines the **phased rollout plan** for converting existing procedures to the new Procedure Catalog Framework.

---

# 2. Priority Order

| Priority | Equipment Family | Status |
|----------|------------------|--------|
| P0 | Water Heater | First full rewrite |
| P1 | Water Pump | Reference baseline |
| P2 | Furnace | Next complex system |
| P3 | Roof AC | High complexity |
| P4 | Refrigerator | High complexity |
| P5 | Slide / Leveling | Mechanical focus |

---

# 3. Equipment Family Analysis

## 3.1 Water Heater (P0 — First Rewrite)

### Business Priority: HIGHEST

**Reasons:**
- Most problematic in current testing
- High volume of support cases
- Multiple subtypes create confusion
- Incorrect branch handling observed

### Complexity: HIGH

**Factors:**
- 3 primary subtypes (gas-only, electric-only, combo)
- 3 ignition types (DSI, manual, hot surface)
- 2 tank types (tank, tankless)
- Multiple failure modes (ignition, flame, gas, electric)

### Diagnostic Risk: HIGH

**Current Issues:**
- Asking electric-only steps on gas-only units
- Repeating advanced checks (millivolt readings)
- Parallel incompatible branches
- No clear completion criteria

### Recommended Rewrite Approach

1. **Phase 1:** Define subtype hierarchy
   - Primary: fuel_type (gas_only | electric_only | combo)
   - Secondary: ignition_type (dsi | manual | hot_surface) — gas/combo only
   - Tertiary: tank_type (tank | tankless) — gas/combo only

2. **Phase 2:** Rewrite gas-only DSI procedure
   - Default steps only in main flow
   - Advanced measurements conditional
   - Branch definitions for no-spark, flame-dropout, no-gas

3. **Phase 3:** Rewrite gas-only manual procedure
   - Different ignition sequence
   - Thermocouple-focused flame verification

4. **Phase 4:** Rewrite combo procedure
   - Gas path (inherits from gas-only)
   - Electric path (independent)
   - Dual-failure handling

5. **Phase 5:** Rewrite electric-only procedure
   - Simpler flow
   - Element and thermostat focus

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| WH-01 | Gas-only, DSI, no spark | Enter no-spark branch, check igniter, control board |
| WH-02 | Gas-only, DSI, flame dropout | Enter flame-dropout branch, check flame sensor |
| WH-03 | Combo, gas works, electric fails | Isolate to electric element path |
| WH-04 | Gas-only, technician says "can't measure millivolts" | Accept unable, continue without re-asking |
| WH-05 | Electric-only unit | No gas steps asked |
| WH-06 | Burnt orifice found early | Acknowledge, offer early isolation |
| WH-07 | Unknown subtype at start | Ask once, proceed with conservative default |

### Estimated Effort

- Subtype definition: 2 hours
- Gas-only DSI procedure: 4 hours
- Gas-only manual procedure: 2 hours
- Combo procedure: 3 hours
- Electric-only procedure: 2 hours
- Testing and validation: 4 hours
- **Total: ~17 hours**

---

## 3.2 Water Pump (P1 — Reference Baseline)

### Business Priority: MEDIUM

**Reasons:**
- Currently relatively stable
- Good reference for non-complex procedure
- Simple subtype structure

### Complexity: LOW

**Factors:**
- Single subtype (standard 12V pump)
- Linear diagnostic flow
- Few branch conditions

### Diagnostic Risk: LOW

**Current Issues:**
- Minor: some advanced checks in default flow
- Minor: match patterns could be improved

### Recommended Rewrite Approach

1. Review existing procedure
2. Re-categorize steps (default vs advanced)
3. Add explicit completion criteria
4. Use as template for other non-complex systems

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| WP-01 | Pump dead, no power | Check fuse, wiring, then pump |
| WP-02 | Pump runs, no flow | Check for blockage, pressure switch |
| WP-03 | Technician can't measure voltage | Accept, move to visual checks |

### Estimated Effort

- Review and re-categorize: 1 hour
- Update step definitions: 2 hours
- Testing: 1 hour
- **Total: ~4 hours**

---

## 3.3 Furnace (P2)

### Business Priority: HIGH

**Reasons:**
- Winter season critical
- Complex ignition sequences
- Multiple failure modes

### Complexity: HIGH

**Factors:**
- DSI vs hot surface ignition
- Blower + ignition + gas coordination
- Sail switch, limit switch, flame sensor
- Error code interpretation

### Diagnostic Risk: MEDIUM

**Current Issues:**
- Ignition type not explicitly gated
- Error code handling incomplete
- Flame sensor checks repeated

### Recommended Rewrite Approach

1. Define ignition type subtype (dsi | hot_surface)
2. Separate blower branch from ignition branch
3. Add error code lookup integration point
4. Define flame-failure branch explicitly

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| FN-01 | Blower runs, no ignition | Enter ignition-failure branch |
| FN-02 | Ignition, no flame | Check gas valve, orifice |
| FN-03 | Flame lights then drops | Flame sensor branch |
| FN-04 | Error code present | Acknowledge, guide based on code |
| FN-05 | Limit switch tripped | Reset path, check for root cause |

### Estimated Effort

- Subtype definition: 1 hour
- Procedure rewrite: 5 hours
- Branch definitions: 2 hours
- Testing: 3 hours
- **Total: ~11 hours**

---

## 3.4 Roof AC (P3)

### Business Priority: HIGH

**Reasons:**
- Summer season critical
- High complexity
- Multiple brands with different controls

### Complexity: VERY HIGH

**Factors:**
- Compressor + condenser fan + evaporator fan
- Capacitor, contactor, thermostat
- Refrigerant system (sealed)
- Brand variations (Dometic, Coleman, Advent)

### Diagnostic Risk: HIGH

**Current Issues:**
- Capacitor checks assumed too early
- No clear branch for "runs but no cool"
- Expert checks (refrigerant) mixed with default

### Recommended Rewrite Approach

1. Define control type subtype (analog | digital | smart)
2. Separate electrical branch from refrigerant branch
3. Mark all refrigerant checks as expert
4. Add brand-specific retrieval hooks

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| AC-01 | Compressor won't start | Capacitor, contactor, power checks |
| AC-02 | Compressor runs, no cooling | Coils, airflow, then refrigerant (expert) |
| AC-03 | Fan runs, compressor dead | Compressor-specific branch |
| AC-04 | Frozen coils | Identify, do not recommend DIY thaw |
| AC-05 | Error code on digital control | Guide based on code |

### Estimated Effort

- Subtype definition: 2 hours
- Procedure rewrite: 6 hours
- Branch definitions: 3 hours
- Testing: 4 hours
- **Total: ~15 hours**

---

## 3.5 Refrigerator (P4)

### Business Priority: MEDIUM

**Reasons:**
- Less urgent than HVAC
- Complex absorption system
- Sealed system = limited field repair

### Complexity: VERY HIGH

**Factors:**
- Three power modes (LP, 120V, 12V)
- Absorption cooling (sealed)
- Level sensitivity
- Ammonia leak detection

### Diagnostic Risk: HIGH

**Current Issues:**
- Power mode not properly gated
- Absorption system checks are expert-only
- Ammonia detection handling unclear

### Recommended Rewrite Approach

1. Define power mode subtype (lp | ac | dc | auto)
2. Mark all sealed system checks as expert
3. Add ammonia detection as destructive finding
4. Emphasize level and ventilation in default flow

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| RF-01 | Not cooling on LP | Igniter, flame, ventilation |
| RF-02 | Not cooling on 120V | Element, thermostat |
| RF-03 | Ammonia smell detected | Destructive finding, no field repair |
| RF-04 | Cooling unit warm but no cool | Expert path (sealed system) |
| RF-05 | RV not level | Identify as cause, recommend leveling |

### Estimated Effort

- Subtype definition: 2 hours
- Procedure rewrite: 5 hours
- Branch definitions: 2 hours
- Testing: 3 hours
- **Total: ~12 hours**

---

## 3.6 Slide / Leveling (P5)

### Business Priority: MEDIUM

**Reasons:**
- Mechanical focus different from others
- Important for setup/travel
- Hydraulic systems require care

### Complexity: HIGH

**Factors:**
- Hydraulic vs electric motor
- Single vs dual motor slides
- Leveling vs stabilizer jacks
- Controller variations

### Diagnostic Risk: MEDIUM

**Current Issues:**
- Motor function vs controller function unclear
- Direct power test critical but not emphasized
- Synchronization issues handling incomplete

### Recommended Rewrite Approach

1. Define actuation type subtype (hydraulic | electric)
2. Emphasize direct power test (motor function proof)
3. Add controller vs motor branch
4. Define synchronization checks for dual systems

### Test Cases

| Test ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| SL-01 | Slide won't extend | Motor vs controller isolation |
| SL-02 | Motor runs on direct power | Controller/wiring path, NOT motor replacement |
| SL-03 | Hydraulic leak visible | Destructive finding, locate leak |
| SL-04 | One side moves, other doesn't | Synchronization path |
| SL-05 | Leveling pump runs, no movement | Solenoid, fluid, leak checks |

### Estimated Effort

- Subtype definition: 1 hour
- Procedure rewrite (slide): 4 hours
- Procedure rewrite (leveling): 4 hours
- Testing: 3 hours
- **Total: ~12 hours**

---

# 4. Rollout Timeline

## Phase 1: Framework Foundation (Week 1)

- [x] Create PROCEDURE_CATALOG_FRAMEWORK.md
- [x] Create PROCEDURE_AUTHORING_STANDARD.md
- [x] Create PROCEDURE_ROLLOUT_PLAN.md
- [x] Create TypeScript schema types
- [ ] Team review and feedback

## Phase 2: Water Heater Rewrite (Weeks 2-3)

- [ ] Define water heater subtype hierarchy
- [ ] Rewrite gas-only DSI procedure
- [ ] Rewrite gas-only manual procedure
- [ ] Rewrite combo procedure
- [ ] Rewrite electric-only procedure
- [ ] Testing and validation
- [ ] Deploy to staging

## Phase 3: Water Pump Baseline (Week 4)

- [ ] Review and update water pump procedure
- [ ] Use as template validation
- [ ] Document lessons learned

## Phase 4: Furnace Rewrite (Weeks 5-6)

- [ ] Define furnace subtype hierarchy
- [ ] Rewrite furnace procedure
- [ ] Testing and validation

## Phase 5: Roof AC Rewrite (Weeks 7-8)

- [ ] Define roof AC subtype hierarchy
- [ ] Rewrite roof AC procedure
- [ ] Testing and validation

## Phase 6: Refrigerator Rewrite (Weeks 9-10)

- [ ] Define refrigerator subtype hierarchy
- [ ] Rewrite refrigerator procedure
- [ ] Testing and validation

## Phase 7: Slide/Leveling Rewrite (Weeks 11-12)

- [ ] Define slide/leveling subtype hierarchies
- [ ] Rewrite slide procedure
- [ ] Rewrite leveling procedure
- [ ] Testing and validation

## Phase 8: Cleanup and Deprecation (Week 13)

- [ ] Remove old flat procedure format
- [ ] Update all documentation
- [ ] Final validation pass

---

# 5. Success Criteria

## Per-Procedure Success

- [ ] No subtype leakage (wrong steps for wrong type)
- [ ] No repeated advanced checks
- [ ] No parallel incompatible branches
- [ ] "Unable" responses handled gracefully
- [ ] All test cases pass
- [ ] Shop-realistic default flow

## Overall Success

- [ ] All P0-P5 procedures converted
- [ ] Consistent authoring across procedures
- [ ] Framework documentation accurate
- [ ] No regression in existing functionality
- [ ] Reduced ad-hoc procedure fixes

---

# 6. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing behavior | Non-breaking schema additions first |
| Subtype explosion | Limit to 3-level hierarchy max |
| Over-engineering | Start with water heater, iterate |
| Testing gaps | Define test cases before rewrite |
| Team adoption | Document authoring standards clearly |

---

# 7. Dependencies

| Dependency | Owner | Status |
|------------|-------|--------|
| Framework documentation | Neo | Complete |
| TypeScript schema | Neo | Complete |
| Context Engine updates | TBD | Not started |
| Testing infrastructure | TBD | Existing |
| Retrieval integration | TBD | Not started |

---

# 8. Summary

**Immediate Next Steps:**

1. Review framework documents (team)
2. Begin water heater subtype definition
3. Write first procedure (gas-only DSI) to new schema
4. Validate with test cases
5. Iterate based on findings

**The goal is systematic procedure development, not ad-hoc fixes.**
