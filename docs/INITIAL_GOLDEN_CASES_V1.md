# INITIAL_GOLDEN_CASES_V1.md

## Project

RV Service Desk

## Purpose

This document defines the first recommended set of golden cases for
regression testing.

These cases are designed to validate:

-   diagnostic flow
-   safety gates
-   output contracts
-   senior-tech conversation quality
-   report readability for real technicians

------------------------------------------------------------------------

## Case 01 --- Roof AC, manufacturer known

**System:** Roof AC\
**Complexity:** Complex\
**Input start:** "Dometic Penguin II AC not cooling."\
**Expected behavior:** - manufacturer-aware path selected if available -
no premature authorization - one clear next step - natural senior-tech
tone

**Readability expectation:** Final report must be short, direct, and
easy to scan.

------------------------------------------------------------------------

## Case 02 --- Roof AC, manufacturer unknown

**System:** Roof AC\
**Complexity:** Complex\
**Input start:** "Roof AC not cooling."\
**Expected behavior:** - agent asks one short brand/model question - if
technician says unknown, continue with generic roof AC procedure - no
blocking intake form

**Readability expectation:** No robotic wording.

------------------------------------------------------------------------

## Case 03 --- Refrigerator, unknown brand

**System:** Refrigerator\
**Complexity:** Complex\
**Input start:** "Fridge not cooling."\
**Expected behavior:** - one concise manufacturer/model inquiry if
useful - fallback to standard refrigerator procedure if unavailable - no
cause before isolation

**Readability expectation:** Final wording remains simple and shop-like.

------------------------------------------------------------------------

## Case 04 --- Water pump destructive finding

**System:** Water pump\
**Complexity:** Non-complex\
**Input start:** "Water pump has a cracked housing."\
**Expected behavior:** - recognize destructive finding - avoid deep
unnecessary teardown questions - prefer unit-level recommendation if
appropriate

**Readability expectation:** Clear, practical language.

------------------------------------------------------------------------

## Case 05 --- Slide-out motor direct power success

**System:** Slide-out\
**Complexity:** Complex\
**Input start:** "Slide motor runs on direct power but room will not
move."\
**Expected behavior:** - do not recommend motor replacement -
investigate control / linkage path - preserve mechanical guardrail

**Readability expectation:** No over-explaining, no academic tone.

------------------------------------------------------------------------

## Case 06 --- Post-repair failure

**System:** Furnace\
**Complexity:** Complex\
**Input start:** "Control board was replaced. Unit still does not
ignite."\
**Expected behavior:** - return to diagnostics - do not generate a new
cause immediately - ask next valid post-repair question

**Readability expectation:** Calm, direct, professional.

------------------------------------------------------------------------

## Case 07 --- Clarification: how-to-check

**System:** Roof AC\
**Complexity:** Complex\
**Input start:** Active step requires voltage check. Technician asks:
"How do I check that?"\
**Expected behavior:** - brief procedure-aligned how-to - same step
remains open - same step re-asked after explanation

**Readability expectation:** Short, practical, no long tutorial.

------------------------------------------------------------------------

## Case 08 --- Clarification: where is the part

**System:** Furnace\
**Complexity:** Complex\
**Input start:** Technician asks: "Where is the sail switch?"\
**Expected behavior:** - brief locate/explain response - return to
active step - no step closure from clarification alone

**Readability expectation:** Shop-appropriate wording.

------------------------------------------------------------------------

## Case 09 --- Explicit authorization request after partial isolation

**System:** Refrigerator\
**Complexity:** Complex\
**Input start:** Technician has partial isolation and explicitly asks
for authorization.\
**Expected behavior:** - authorization mode only by explicit command -
conservative wording - partial isolation stated clearly - no guarantee
language

**Readability expectation:** Professional but plain language.

------------------------------------------------------------------------

## Case 10 --- Explicit final report request

**System:** Water pump\
**Complexity:** Non-complex\
**Input start:** Diagnostics complete, technician explicitly requests
final report.\
**Expected behavior:** - final report mode only after explicit request -
correct section order - translation block present when required - no
further questions

**Readability expectation:** Very clear, technician-friendly report.

------------------------------------------------------------------------

## Case 11 --- New evidence after isolation

**System:** Roof AC\
**Complexity:** Complex\
**Input start:** Isolation was declared complete. Technician then
reports: "Found burnt wiring at the connector."\
**Expected behavior:** - prior conclusion invalidated - return to
diagnostics - explore new branch - no repeat of prior conclusion

**Readability expectation:** Clear explanation without drama.

------------------------------------------------------------------------

## Case 12 --- Consumer appliance replacement logic

**System:** Microwave\
**Complexity:** Consumer appliance\
**Input start:** "Microwave powers on but has no heat. Basic checks
complete."\
**Expected behavior:** - do not suggest board-level repair - prefer
unit-level replacement logic - concise diagnostic wording

**Readability expectation:** Simple, plain service language.

------------------------------------------------------------------------

## Case 13 --- No repeated completed step

**System:** Ceiling fan\
**Complexity:** Non-complex\
**Input start:** Technician provides multiple completed checks in first
message.\
**Expected behavior:** - completed steps are recognized - no repeated
question - direct move to next valid step

**Readability expectation:** No robotic summary dump.

------------------------------------------------------------------------

## Case 14 --- Anti-loop ambiguity handling

**System:** Lighting / 12V\
**Complexity:** Non-complex\
**Input start:** Technician gives ambiguous short answers.\
**Expected behavior:** - forward progress maintained - no repeated
"provide more information" - ask a specific next step instead of generic
requests

**Readability expectation:** Brief, practical, never vague.

------------------------------------------------------------------------

## Case 15 --- Final report readability stress test

**System:** Roof AC\
**Complexity:** Complex\
**Input start:** Fully isolated case requiring complete final report.\
**Expected behavior:** - final report is technically correct - report is
not academic, not too dense, not too formal - one fact per sentence
where practical - understandable on first read

**Readability expectation:** Score 4 or 5 only.

------------------------------------------------------------------------

## Recommended Review Columns

For each golden case, reviewers should record:

-   **Flow Correctness** (Pass/Fail)
-   **Safety Compliance** (Pass/Fail)
-   **Output Correctness** (Pass/Fail)
-   **Conversation Quality** (1--5)
-   **Report Readability** (1--5)
-   **Notes**

------------------------------------------------------------------------

## Readability Reminders for Reviewers

Fail or flag the case if the final report:

-   sounds academic
-   sounds like a legal memo
-   uses inflated vocabulary
-   contains long clause-heavy sentences
-   is hard to understand on first read

Pass the case if the report:

-   sounds like clear professional shop documentation
-   uses short direct sentences
-   is easy to scan quickly
-   would be understandable to an average technician

------------------------------------------------------------------------

## Initial Recommendation

Start by running all 15 cases manually.

Then turn the most stable checks into CI gates.

Use this set as the baseline for: - prompt bake-offs - persona
regression checks - release gating
