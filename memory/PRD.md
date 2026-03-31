# RVSD Procedure Contract Audit v1 - PRD

## Original Problem Statement
Build a Procedure Contract Audit v1 for RVSD procedure definitions - an offline audit/test layer to validate that procedures are structurally sound and safe to use.

## Goal
Validate procedure definitions as product-contract artifacts, detecting structural defects before runtime.

## What's Been Implemented (2026-01-28)

### Files Changed
- `tests/procedures/procedure-contract-audit.test.ts` (NEW) - 209 tests

### Checks Implemented

1. **Step ID Integrity**
   - Duplicate step IDs within procedure
   - Empty or malformed step IDs
   - Whitespace-only step IDs
   - Valid format validation (alphanumeric + underscore)

2. **Prerequisite Integrity**
   - Prerequisites referencing missing steps
   - Self-referential prerequisites
   - Circular prerequisite chains (DFS detection)

3. **Branch Integrity**
   - Branch trigger step validation
   - Branch entry step validation
   - Entry step branchId matching
   - Mutually exclusive branch references
   - Branch ID uniqueness
   - Orphaned branch steps

4. **Ordering/Reachability Sanity**
   - Root step existence (no prerequisites)
   - Main-flow step reachability from roots
   - Branch entry step prerequisite validity
   - Orphaned branch step detection

5. **howToCheck Coverage (Complex Procedures)**
   - Coverage check for procedures with `complex: true`
   - Main-flow steps with prerequisites
   - Branch step coverage reporting
   - Stricter enforcement for water_heater (50% minimum)

6. **Structural Consistency**
   - Non-empty questions
   - Match pattern presence
   - Procedure metadata validation
   - Valid RegExp patterns

7. **Cross-Procedure Consistency**
   - Registry integrity
   - No duplicate systems
   - Step ID prefix consistency (advisory)

### Existing Procedure Defects Discovered

**howToCheck Coverage Gaps** (advisory, not failures):
- `lp_gas`: 6 steps missing (lpg_2-7)
- `furnace`: 5 steps missing (furn_2-4, furn_7-8)
- `roof_ac`: 4 steps missing (ac_5-7, ac_9)
- `refrigerator`: 5 steps missing (ref_2-6)
- `slide_out`: 5 steps missing (so_2-5, so_7)
- `leveling`: 4 steps missing (lv_2, lv_6-8)
- `inverter_converter`: 6 steps missing (ic_2-4, ic_6-7, ic_9)

**No structural defects found** - all procedures pass:
- Step ID integrity ✓
- Prerequisite integrity ✓
- Branch integrity ✓
- Reachability sanity ✓

### Test Summary
- 209 tests total
- All tests pass
- Tests are deterministic and offline
- No runtime code changes

## Backlog / Future Work

### P0 (High Priority)
- Add howToCheck to complex procedure steps (35 steps identified)

### P1 (Medium Priority)
- Consider stricter howToCheck enforcement for all complex procedures
- Add branch step continuity checks

### P2 (Low Priority)
- Step ID naming convention enforcement
- Procedure versioning validation

## Suggested PR Title
`feat(tests): procedure contract audit v1 — structural integrity checks`
