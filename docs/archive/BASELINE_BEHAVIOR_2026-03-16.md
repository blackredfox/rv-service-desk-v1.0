# Baseline Behavior Report — 2026-03-16

## Repository State

- **Branch:** main
- **Commit:** b321ddc (Merge pull request #35)
- **Working tree:** Clean (no local unmerged changes)
- **Stable state confirmed:** Yes

## Test Suite Status (Baseline)

**Total Tests:** 605
**Passed:** 588
**Failed:** 17

### Known Pre-existing Test Failures

These failures exist in the stable repository state and are documented here for reference:

#### 1. tests/input-language-lock.test.ts (6 failures)
- `should detect Russian from Cyrillic text`
- `should detect Spanish from Spanish markers`
- `should default to English for non-Cyrillic/non-Spanish text`
- `should use explicit RU when selected`
- `should use explicit ES when selected`
- `should use explicit EN when selected`

#### 2. tests/retention.test.ts (5 failures)
- `storage.createCase returns retention fields`
- `storage.listCases returns retention fields`
- `appendMessage updates lastActivityAt`
- `timeLeftSeconds is approximately 30 days for new case`
- `new cases appear in listings`

#### 3. tests/mode-validators.test.ts (1 failure)
- `should default to EN for unknown/undefined language`

#### 4. tests/prompt-enforcement.test.ts (5 failures)
- `should detect English during Russian diagnostics`
- `should detect translation separator during diagnostics`
- `should detect multiple questions`
- `should detect missing translation separator`
- `should detect numbered lists in Cause output`

---

## Behavioral Scenarios (Baseline Defects)

### Scenario A — Water Heater Regression Case

**Input sequence:**
1. water heater not working
2. gas Suburban
3. spark yes
4. no flame
5. no gas smell
6. 12V at valve
7. low inlet pressure

**Baseline Status:** CANNOT TEST (requires running server with OPENAI_API_KEY)

**Known Defects (from session report):**
- `route.ts` is not the primary root cause for the water heater case
- Real defect is in the diagnostic layer
- LLM appears to influence diagnostic step selection too much
- Fallback report quality is generic and unacceptable
- Water heater procedure is missing an upstream restriction branch

---

### Scenario B — Clarification Flow

**Test case:** Technician asks "How do I check that?"

**Expected behavior:**
- System answers briefly with how-to-check instruction
- Same step remains active
- Assistant returns to the same diagnostic step

**Implementation status:**
- `detectHowToCheck()` function exists in `diagnostic-registry.ts` (lines 96-108)
- `howToCheckRequested` flag is tracked in registry entry
- `buildProcedureContext()` includes HOW-TO-CHECK INSTRUCTION when flagged
- Re-ask instruction: "After providing this instruction, re-ask the SAME step for the result"

---

### Scenario C — Explicit Final Report

**Expected behavior:**
- No final report before explicit command
- Final report appears after explicit command only
- Translation block rules still hold

**Implementation status (from route.ts):**
- Mode commands detected via `detectModeCommand()` (line 770-775)
- Explicit mode transitions tracked: `currentMode → commandMode`
- Auto-transition only triggered by `detectTransitionSignal()` or `pivotTriggered`
- Translation enforcement via `enforceLanguagePolicy()` (line 188-193)

---

### Scenario D — Senior-tech Tone Snapshot

**Tone requirements:**
- Sounds like experienced RV technician
- Not chatbot-like
- Not form-terminal-like
- Concise and practical

**Implementation status:**
- Tone controlled by system prompts in `prompts/` directory
- Mode-specific prompts composed via `composePromptV2()` in `prompt-composer.ts`

---

## Architecture Summary

### Key Files

| File | Responsibility |
|------|----------------|
| `app/api/chat/route.ts` | HTTP boundary, orchestration, SSE streaming (~1767 lines) |
| `lib/context-engine/` | SINGLE FLOW AUTHORITY for diagnostic decisions |
| `lib/diagnostic-registry.ts` | DATA PROVIDER for step metadata (not flow control) |
| `lib/diagnostic-procedures.ts` | Procedure catalog, step definitions |
| `lib/prompt-composer.ts` | System prompt composition |
| `lib/mode-validators.ts` | Output validation, safe fallbacks |
| `lib/lang.ts` | Language detection, policy resolution |

### Architectural Rules (from ARCHITECTURE_RULES.md)

1. **Explicit-only mode transitions** — Server must not infer mode transitions from meaning
2. **Single diagnostic authority** — Context Engine is the ONLY flow authority
3. **Registry is data-only** — Diagnostic registry provides step metadata, NOT flow control
4. **No dual state machines** — Route helpers must not introduce hidden flow logic

---

## Conclusion

The repository is in a stable state with:
- Clean working tree
- No local unmerged changes from previous session
- 17 pre-existing test failures (documented above)
- Core diagnostic architecture intact

**Ready to proceed with Task 02 — Safe Decomposition**
