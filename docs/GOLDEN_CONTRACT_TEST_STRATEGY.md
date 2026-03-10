# GOLDEN_CONTRACT_TEST_STRATEGY.md

## Project

RV Service Desk

## Purpose

This document defines the **Golden Contract Test Strategy** for RV
Service Desk.

The goal is to ensure that the agent remains:

-   diagnostically correct
-   architecturally compliant
-   authorization-safe
-   technician-friendly
-   readable for real service-shop users

This strategy is designed to prevent regressions in:

-   diagnostic flow
-   mode transitions
-   final output formatting
-   conversational quality
-   report readability

------------------------------------------------------------------------

## 1. Why This Strategy Exists

RV Service Desk is not a free-form chatbot.

It is a controlled AI system where:

-   **Context Engine** controls diagnostic flow
-   **LLM** generates language only
-   **Server** validates output contracts

Because of this architecture, the most dangerous regressions are often
**behavioral**, not build-time failures.

Examples:

-   asking the wrong next step
-   repeating a completed step
-   generating authorization too early
-   producing robotic dialogue
-   producing reports that are too academic or too hard to read
-   losing translation block compliance
-   leaking diagnostic questions after final output

Standard unit tests do not catch all of these issues.

Golden contract tests exist to catch them.

------------------------------------------------------------------------

## 2. Test Layers

Every golden-case run should be evaluated across five layers:

1.  **Flow Correctness**
2.  **Safety Compliance**
3.  **Output Correctness**
4.  **Conversation Quality**
5.  **Report Readability**

------------------------------------------------------------------------

## 3. Layer A --- Flow Correctness

### Goal

Verify that the agent follows the correct procedure sequence and
respects Context Engine authority.

### Required checks

-   The next diagnostic step matches the active procedure.
-   No completed step is repeated.
-   No skipped prerequisites.
-   Clarification requests return to the same active step.
-   Replan occurs when new evidence changes the branch.
-   Post-repair failures return to diagnostics.
-   Post-final follow-up does not re-enter diagnostics unless a new case
    is started.

### Blocking failures

-   Wrong next step
-   Repeated completed step
-   Meaning-based mode switch
-   Diagnostic loop without forward progress
-   Off-procedure question

------------------------------------------------------------------------

## 4. Layer B --- Safety Compliance

### Goal

Ensure the agent never violates diagnostic and authorization guardrails.

### Required checks

-   No cause before isolation is complete for complex systems.
-   No labor estimate before allowed mode/state.
-   No repair recommendation before allowed point.
-   Mechanical direct-power rule preserved.
-   Consumer appliance replacement rules preserved.
-   No approval guarantee language.
-   No unauthorized final output generation.

### Blocking failures

-   Premature authorization
-   Premature final report
-   Guardrail violation
-   Unsafe or non-compliant warranty wording

------------------------------------------------------------------------

## 5. Layer C --- Output Correctness

### Goal

Ensure final outputs conform to strict product contract rules.

### Required checks

-   English-first block exists where required.
-   `--- TRANSLATION ---` block exists where required.
-   English block is English-only.
-   Final report sections are present in correct order.
-   Labor breakdown totals match stated total.
-   Output matches current mode.
-   No hidden service-state fields are exposed to the technician unless
    intentionally designed.

### Blocking failures

-   Missing translation block
-   Mixed language in English block
-   Missing required section
-   Invalid labor math
-   Wrong output type for current mode

------------------------------------------------------------------------

## 6. Layer D --- Conversation Quality

### Goal

Ensure the agent feels like a **senior RV technician helping another
technician**, not a dry terminal or a generic chatbot.

### Required checks

-   First response is natural and professional.
-   No robotic system-field dump such as:
    -   `System:`
    -   `Classification:`
    -   `Mode:`
    -   `Status:` unless intentionally exposed in the approved UX
-   The response sounds shop-appropriate.
-   The agent briefly explains why a check matters when useful.
-   Clarification answers are brief and practical.
-   The agent does not use fluffy chatbot filler.
-   The agent does not become too passive or too cold.

### Fail examples

-   "Tell me more."
-   "Provide additional information."
-   robotic checklist tone
-   service-terminal output
-   vague generic conversation

### Pass examples

-   direct, experienced, shop-floor phrasing
-   natural targeted question
-   brief reasoning before the next check

------------------------------------------------------------------------

## 7. Layer E --- Report Readability

### Goal

Ensure that final reports are understandable to real RV technicians and
service writers, many of whom have average or near-average formal
education.

The report must be:

-   professional
-   clear
-   easy to scan
-   easy to understand on first read
-   not academic
-   not legalistic
-   not overly sophisticated

### Required checks

-   Short, direct sentences
-   One fact per sentence whenever practical
-   No inflated or abstract language
-   No unnecessary jargon
-   No consulting/corporate tone
-   No academic phrasing
-   Clear description of:
    -   what was observed
    -   what was checked
    -   what was verified
    -   what action is needed

### Fail examples

-   "multifactorial operational inconsistency"
-   "probable latent degradation pattern"
-   "anomalous performance manifestation"
-   long, clause-heavy sentence chains

### Pass examples

-   "Voltage is present."
-   "Unit does not respond under load."
-   "Condition is not recoverable."
-   "Replace AC unit."

### Readability scoring rubric

**5** --- Very clear, shop-friendly, easy to read\
**4** --- Clear, slightly formal but acceptable\
**3** --- Understandable, but heavier than needed\
**2** --- Too dense or too technical\
**1** --- Hard to read, unnatural for technicians

### Heuristic checks

Optional automatic checks may include: - average sentence length -
percentage of long sentences - presence of deny-listed
academic/corporate words - readability threshold alerts

Heuristics do not replace human review.

------------------------------------------------------------------------

## 8. Golden Case Structure

Each golden case should include:

-   Case ID
-   System type
-   Complexity class
-   Input sequence
-   Expected procedure branch
-   Expected transitions
-   Forbidden outputs
-   Expected final mode
-   Required readability expectation
-   Notes on acceptable phrasing range

------------------------------------------------------------------------

## 9. Pass/Fail Model

### Blocking (must fail build/release)

-   Flow correctness failure
-   Safety compliance failure
-   Output correctness failure

### Non-blocking but tracked

-   Conversation quality degradation
-   Readability score drop
-   Increased robotic tone
-   Increased verbosity without value

### Release gate recommendation

A candidate release should meet:

-   **Flow Correctness:** 100%
-   **Safety Compliance:** 100%
-   **Output Correctness:** 98%+
-   **Conversation Quality:** no severe regression
-   **Readability:** no case below 3, target average 4+

------------------------------------------------------------------------

## 10. How to Use in CI and Manual Review

### In CI

Use the golden harness to run: - deterministic conversation
simulations - contract checks - formatting checks - regression
comparisons between current and candidate prompts

### In manual review

Use human reviewers to score: - conversation quality - readability -
"senior tech" feel - technician usability

------------------------------------------------------------------------

## 11. Recommended Reviewer Questions

For each reviewed case, ask:

### Flow

-   Did the agent ask the correct next question?
-   Did it avoid repeating answered steps?

### Safety

-   Did it avoid premature authorization or repair recommendation?
-   Did it preserve all guardrails?

### Persona

-   Did it sound like an experienced RV technician?
-   Did it avoid sounding robotic?

### Readability

-   Would an average technician understand this on first read?
-   Is the wording simple, direct, and professional?
-   Is the report too academic, too dense, or too formal?

------------------------------------------------------------------------

## 12. Initial Scope Recommendation

Start with **15--20 golden cases**.

Do not begin with hundreds.

The first version should cover:

-   complex systems
-   non-complex systems
-   manufacturer-known
-   manufacturer-unknown
-   clarification flow
-   post-repair flow
-   explicit authorization
-   explicit final report
-   report readability stress cases

------------------------------------------------------------------------

## 13. Success Criteria

This strategy is successful when:

-   prompt changes can be tested before UAT
-   architecture regressions are caught before merge
-   agent tone can improve without breaking safety
-   reports remain both precise and technician-readable
-   the system becomes demonstrably stable, not just "seems good"

------------------------------------------------------------------------

## 14. Final Principle

The RV Service Desk agent must be:

-   controlled, not loose
-   professional, not robotic
-   clear, not academic
-   helpful, not improvisational
-   readable, not over-engineered
