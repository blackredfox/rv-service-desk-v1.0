/**
 * Procedure Catalog Schema
 * 
 * Type definitions for the Procedure Catalog Framework.
 * 
 * IMPORTANT:
 * - These are TYPE DEFINITIONS ONLY
 * - No runtime logic
 * - No breaking changes to existing system
 * - Reflects the framework structure from PROCEDURE_CATALOG_FRAMEWORK.md
 * 
 * @see /docs/PROCEDURE_CATALOG_FRAMEWORK.md
 * @see /docs/PROCEDURE_AUTHORING_STANDARD.md
 */

// ── Step Categories ─────────────────────────────────────────────────

/**
 * Step category determines when a step can appear in diagnostic flow.
 * 
 * - default: Normal shop-floor check (visual, audible, simple tools)
 * - advanced: Requires specific tools/measurements (multimeter, gauge)
 * - expert: Specialized bench-level check (rarely in field service)
 */
export type StepCategory = "default" | "advanced" | "expert";

// ── Subtype Definitions ─────────────────────────────────────────────

/**
 * Subtype level in the hierarchy.
 * Primary → Secondary → Tertiary
 */
export type SubtypeLevel = "primary" | "secondary" | "tertiary";

/**
 * A single level in the subtype hierarchy.
 */
export type SubtypeLevelDefinition = {
  /** Key identifier for this subtype level (e.g., "fuel_type", "ignition_type") */
  key: string;
  /** Valid options for this subtype (e.g., ["gas_only", "electric_only", "combo"]) */
  options: string[];
  /** Whether this subtype must be known before proceeding */
  required: boolean;
  /** For secondary/tertiary: which primary/secondary values this applies to */
  appliesTo?: string[];
};

/**
 * Complete subtype hierarchy for a procedure.
 * Supports up to 3 levels: primary (required), secondary (optional), tertiary (optional)
 */
export type SubtypeDefinition = {
  /** Primary subtype (always required) */
  primary: SubtypeLevelDefinition;
  /** Secondary subtype (optional, conditional on primary) */
  secondary?: SubtypeLevelDefinition;
  /** Tertiary subtype (optional, conditional on secondary) */
  tertiary?: SubtypeLevelDefinition;
};

/**
 * Condition for subtype gating on a step.
 * Determines when a step is valid based on subtype values.
 */
export type SubtypeCondition = {
  /** Which level of subtype to check */
  level: SubtypeLevel;
  /** Key of the subtype (e.g., "fuel_type") */
  key: string;
  /** Step is valid if subtype value is in this list */
  includes?: string[];
  /** Step is invalid if subtype value is in this list */
  excludes?: string[];
};

// ── Branch Definitions ──────────────────────────────────────────────

/**
 * Condition that triggers entry into a branch.
 */
export type BranchTrigger = {
  /** Step ID whose response triggers this branch */
  sourceStepId: string;
  /** Pattern in technician response that activates branch */
  pattern: RegExp;
  /** Optional: fact that must be present to trigger */
  factRequired?: string;
};

/**
 * Types of exit conditions for a branch.
 */
export type ExitConditionType = "step_complete" | "finding_confirmed" | "unable_to_verify";

/**
 * Condition that exits a branch.
 */
export type ExitCondition = {
  /** Type of exit condition */
  type: ExitConditionType;
  /** Step ID (for step_complete) */
  stepId?: string;
  /** Finding key (for finding_confirmed) */
  finding?: string;
};

/**
 * A diagnostic branch definition.
 * Branches represent conditional paths triggered by specific findings.
 */
export type BranchDefinition = {
  /** Unique branch identifier */
  id: string;
  /** Human-readable branch name */
  displayName: string;
  /** Condition that triggers entry into this branch */
  triggerCondition: BranchTrigger;
  /** First step ID when entering this branch */
  entryStepId: string;
  /** Conditions that exit this branch */
  exitConditions: ExitCondition[];
  /** Branch IDs that cannot be active simultaneously */
  mutuallyExclusive?: string[];
};

// ── Step Definitions ────────────────────────────────────────────────

/**
 * Trigger that can change branch state from a step response.
 */
export type StepBranchTrigger = {
  /** Pattern in response that triggers branch */
  pattern: RegExp;
  /** Branch ID to enter */
  branchId: string;
  /** Optional finding to record */
  finding?: string;
};

/**
 * A single diagnostic step.
 */
export type ProcedureStep = {
  /** Unique step ID within the procedure */
  id: string;
  /** Exact question to ask the technician */
  question: string;
  /** Step category (default/advanced/expert) */
  category: StepCategory;
  /** Step IDs that must be completed before this step */
  prerequisites: string[];
  /** Subtype condition for step validity (null = always valid) */
  subtypeGate: SubtypeCondition | null;
  /** Patterns indicating this step is answered */
  matchPatterns: RegExp[];
  /** Instruction if technician asks "how to check?" */
  howToCheck: string | null;
  /** Whether "can't check" is a valid response */
  acceptsUnable: boolean;
  /** Conditions that trigger branch changes from this step */
  branchTriggers?: StepBranchTrigger[];
};

// ── Completion Criteria ─────────────────────────────────────────────

/**
 * Key finding that can allow early completion.
 */
export type KeyFindingCriteria = {
  /** Finding keys that satisfy completion */
  findings: string[];
  /** Whether finding must be verified by specific step */
  requiresVerification: boolean;
};

/**
 * Explicit declaration criteria for completion.
 */
export type ExplicitDeclarationCriteria = {
  /** Commands that indicate completion (e.g., ["isolation complete"]) */
  commands: string[];
};

/**
 * Criteria for determining when diagnostic isolation is complete.
 */
export type CompletionCriteria = {
  /** Whether all reachable steps must be complete */
  allStepsComplete: boolean;
  /** Key findings that can allow early completion */
  keyFindingConfirmed?: KeyFindingCriteria;
  /** Explicit technician declaration */
  explicitDeclaration?: ExplicitDeclarationCriteria;
  /** Minimum number of steps before completion allowed */
  minimumSteps?: number;
  /** Step IDs that MUST be complete before isolation */
  requiredSteps?: string[];
};

// ── Destructive Findings ────────────────────────────────────────────

/**
 * A destructive finding indicates component failure without further testing.
 */
export type DestructiveFinding = {
  /** Unique finding identifier */
  id: string;
  /** Pattern in technician message */
  pattern: RegExp;
  /** Human-readable description */
  description: string;
  /** Component affected by this finding */
  componentAffected: string;
  /** Whether this finding allows skipping remaining steps */
  allowsEarlyIsolation: boolean;
  /** Whether technician must visually confirm */
  requiresVisualConfirmation: boolean;
};

// ── First Step Logic ────────────────────────────────────────────────

/**
 * Rule for determining the first step based on initial conditions.
 */
export type FirstStepRule = {
  /** Condition for this rule (null = default) */
  condition: SubtypeCondition | null;
  /** Step ID to start with when condition is met */
  stepId: string;
};

// ── Procedure Variant ───────────────────────────────────────────────

/**
 * Procedure variant type.
 * - STANDARD: Generic procedure, no manufacturer-specific info
 * - MANUFACTURER: Manufacturer-specific procedure
 */
export type ProcedureVariant = "STANDARD" | "MANUFACTURER";

// ── Classification ──────────────────────────────────────────────────

/**
 * System classification for diagnostic rigor.
 * - complex: Requires thorough diagnosis, strict completion criteria
 * - non_complex: Simpler flow, may complete earlier
 */
export type SystemClassification = "complex" | "non_complex";

// ── Forbidden Outputs ───────────────────────────────────────────────

/**
 * Output types that are forbidden before isolation is complete.
 */
export type ForbiddenOutput = 
  | "root_cause"
  | "repair_recommendation"
  | "labor_estimate"
  | "parts_list"
  | "final_report"
  | "authorization_text"
  | "component_replacement_recommendation"
  | "warranty_language";

// ── Complete Procedure Definition ───────────────────────────────────

/**
 * Complete procedure definition following the Procedure Catalog Framework.
 * 
 * This is the main type for defining a diagnostic procedure.
 */
export type CatalogProcedure = {
  /** Unique procedure identifier (e.g., "water_heater_gas_dsi_standard") */
  id: string;
  /** Equipment family (e.g., "water_heater", "furnace") */
  family: string;
  /** Human-readable display name */
  displayName: string;
  /** Subtype hierarchy definition */
  subtype: SubtypeDefinition;
  /** System classification (complex/non_complex) */
  classification: SystemClassification;
  /** Procedure variant (STANDARD/MANUFACTURER) */
  variant: ProcedureVariant;
  /** Facts required before starting procedure */
  requiredIntakeFacts: string[];
  /** Rules for selecting the first step */
  firstStepLogic: FirstStepRule[];
  /** Ordered step definitions */
  steps: ProcedureStep[];
  /** Conditional branch definitions */
  branches: BranchDefinition[];
  /** Criteria for completion */
  completionCriteria: CompletionCriteria;
  /** Destructive findings that may shortcut diagnosis */
  destructiveFindings: DestructiveFinding[];
  /** Outputs forbidden before isolation complete */
  forbiddenBeforeIsolation: ForbiddenOutput[];
};

// ── Runtime State Types ─────────────────────────────────────────────

/**
 * Resolved subtype values for a case.
 */
export type ResolvedSubtype = {
  primary: string | null;
  secondary: string | null;
  tertiary: string | null;
};

/**
 * Step state in runtime.
 */
export type StepState = "pending" | "asked" | "completed" | "unable" | "skipped";

/**
 * Branch state in runtime.
 */
export type BranchState = "inactive" | "active" | "exited";

/**
 * Runtime procedure state for a case.
 */
export type ProcedureRuntimeState = {
  /** Active procedure ID */
  procedureId: string;
  /** Resolved subtype values */
  resolvedSubtype: ResolvedSubtype;
  /** Step states by step ID */
  stepStates: Map<string, StepState>;
  /** Branch states by branch ID */
  branchStates: Map<string, BranchState>;
  /** Currently active branch (null = main flow) */
  activeBranchId: string | null;
  /** Currently active step ID */
  activeStepId: string | null;
  /** Recorded findings */
  findings: string[];
  /** Whether isolation is complete */
  isolationComplete: boolean;
};

// ── Validation Types ────────────────────────────────────────────────

/**
 * Result of procedure validation.
 */
export type ProcedureValidationResult = {
  /** Whether procedure is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
};

/**
 * Result of step gating evaluation.
 */
export type StepGateResult = {
  /** Whether step is valid for current subtype */
  valid: boolean;
  /** Reason if invalid */
  reason?: string;
};

// ── Helper Types ────────────────────────────────────────────────────

/**
 * Equipment family identifiers.
 */
export type EquipmentFamily =
  | "water_heater"
  | "water_pump"
  | "furnace"
  | "roof_ac"
  | "refrigerator"
  | "slide_out"
  | "leveling"
  | "inverter_converter"
  | "electrical_12v"
  | "electrical_ac"
  | "lp_gas"
  | "awning"
  | "consumer_appliance";

/**
 * Standard branch types.
 */
export type StandardBranchType =
  | "no_power"
  | "no_ignition"
  | "no_fuel"
  | "flame_failure"
  | "mechanical"
  | "control";

/**
 * Unable-to-verify reason types.
 */
export type UnableReason =
  | "unable_no_tool"
  | "unable_no_access"
  | "unable_unsafe"
  | "unable_already_done";

// ── Default Values ──────────────────────────────────────────────────

/**
 * Default forbidden outputs for all procedures.
 */
export const DEFAULT_FORBIDDEN_OUTPUTS: ForbiddenOutput[] = [
  "root_cause",
  "repair_recommendation",
  "labor_estimate",
  "parts_list",
  "final_report",
  "authorization_text",
];

/**
 * Default completion criteria for complex systems.
 */
export const DEFAULT_COMPLEX_COMPLETION: CompletionCriteria = {
  allStepsComplete: true,
  minimumSteps: 5,
};

/**
 * Default completion criteria for non-complex systems.
 */
export const DEFAULT_NON_COMPLEX_COMPLETION: CompletionCriteria = {
  allStepsComplete: true,
  minimumSteps: 3,
};
