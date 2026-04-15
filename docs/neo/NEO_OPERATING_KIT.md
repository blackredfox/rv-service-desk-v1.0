# Neo Operating Kit

## Purpose

This document defines the minimum safe operating protocol for using Neo in Emergent on this project.

It exists to prevent:
- branch contamination,
- unrelated file changes,
- scope drift,
- repeated cleanup loops,
- behavior regressions reaching main,
- over-trusting agent summaries instead of git evidence.

This is not a style guide.
This is an execution and review safety protocol.

---

# 1. Core Operating Principles

1. Git diff is the source of truth, not the agent's prose summary.
2. Never trust "task completed" without checking changed files and behavior.
3. A clean implementation is not only correct code, but also correct scope.
4. Passing tests are not enough if real behavior got worse.
5. Main must be protected from contamination and silent regressions.

---

# 2. Branch Hygiene Protocol

## Core Rule

Never give Neo `main` directly for implementation work.

Instead:
1. create a fresh base branch from clean local `main`
2. push that branch
3. select that fresh branch in Emergent
4. constrain allowed file edits in the prompt
5. verify diff against that exact base branch before PR

## Local Preflight (required before every new task)

Run locally before starting any new Neo task:

```bash
# dir: rv-service-desk-v1.0/
git checkout main
git pull
git status --short

Expected result:

local main is up to date
working tree is clean

If not clean, stop and resolve that first.

Base Branch Rule

Create a dedicated Neo base branch for each task.

Recommended naming:

neo-base/<short-task-name>-<date>

Example:

neo-base/fix-clarification-regression-2026-04-15

Push that branch and use it as the exact comparison base for all review.

Session Rule

One Neo tab/session = one PR.

Do not reuse a Neo session for a new implementation task if the container state differs from the intended clean base.

3. Known Contamination Patterns

Treat these as recurring environment contamination unless explicitly requested by the task:

.emergent/**
memory/**
.gitignore
package.json
unrelated docs
unrelated tests
unrelated runtime/config files

Important:
Neo may solve the coding task correctly while still introducing unrelated files from its own workspace.
Those files are not part of the implementation result.

4. Neo Task Guardrail Block

Use this inside every Neo coding task.

Execution rules for this task:

Base branch: `<neo-base-branch-name>`

Allowed file changes only:
- <file-1>
- <file-2>

Forbidden changes:
- .emergent/**
- memory/**
- .gitignore
- package.json
- unrelated tests
- unrelated docs
- unrelated runtime/config files

Rules:
1. Change only files required for this task.
2. Do not perform opportunistic cleanup or side refactors.
3. If requirements are ambiguous, state assumptions before implementation.
4. Define the exact success condition before editing code.
5. Before reporting completion, provide:
   - `git branch --show-current`
   - `git status --short`
   - `git diff --name-only <neo-base-branch-name>...HEAD`
6. If any forbidden or unrelated file was touched, report it explicitly and exclude it from the implementation result.
5. Definition of Done for Neo Tasks

A Neo task is not done unless all of the following are true:

only allowed files appear in the diff against the exact base branch
no contamination files are included
no scope drift occurred
the success condition is explicitly stated
at least one behavior-relevant verification exists
the result is reviewable from git evidence, not just from narrative summary
6. Merge Review Checklist

Use this before accepting any Neo-delivered change.

Step 1 — File Hygiene
Review git diff --name-only <neo-base-branch-name>...HEAD
Only intended files are present
No .emergent/**
No memory/**
No .gitignore change unless explicitly requested
No unrelated tests/docs/config/runtime files
Step 2 — Scope Hygiene
Diff matches the requested task only
No opportunistic cleanup
No adjacent refactor without explicit approval
No hidden behavior changes outside target scope
Step 3 — Behavioral Proof
Exact success condition is stated
At least one regression-sensitive scenario was checked
Tests prove the intended change, not just syntax or rendering
Manual behavior check was done if agent/runtime flow is involved
Step 4 — Merge Decision

Choose one:

Safe to merge
Needs cleanup before merge
Needs rollback
Needs redesign
7. Regression Postmortem Framework

Use this whenever behavior became worse after Neo-delivered changes, even if tests were green.

This is not a blame document.
This is a control document to identify:

where regression entered,
why it was not detected,
what guardrail must be added.
7.1 Incident Summary
Feature / flow affected:
Date regression was noticed:
Reported by:
Severity:
Critical / High / Medium / Low
User-visible impact:
Internal impact:
7.2 Expected vs Actual Behavior
Expected behavior

Describe what should happen in one concrete scenario.

Actual behavior

Describe what happens now in the same scenario.

Minimal reproduction
Evidence
screenshots
logs
prompt / request example
failing test names
session notes
7.3 Regression Window
Last known good commit:
First known bad commit:
Compared branch(es):
Neo task / PR / session involved:
Was the task started from a fresh base branch?
Yes / No / Unknown
7.4 Change Scope Review
Intended files
Actually changed files
Unrelated files touched
Scope verdict
Scope stayed clean
Scope drift happened
Contamination files were included
Unknown
7.5 Root Cause Analysis

Check all that apply.

Task framing problem
task was too broad
success condition was vague
allowed file list was missing
forbidden file list was missing
base branch was not explicitly defined
Agent execution problem
Neo modified unrelated files
Neo performed opportunistic cleanup
Neo refactored adjacent logic without request
Neo silently assumed requirements
Neo reported completion without enough proof
Review problem
review focused on prose summary, not git diff
review did not inspect changed file list first
review accepted contamination files
review did not compare against exact base branch
Test problem
tests passed but did not reflect real behavior
no regression test was added
no manual scenario verification was done
existing tests were too shallow
edge cases were not covered
Process problem
multiple changes were stacked before behavior verification
main already contained hidden degradation
no rollback checkpoint existed
session/container state was trusted too much
7.6 Primary Root Cause

Write one sentence only.

Example:
Regression entered because the task allowed adjacent cleanup, review accepted the diff without checking against the exact base branch, and tests did not cover the real technician flow.

Primary root cause:
...

7.7 Recovery Plan
Immediate containment
reproduce reliably
identify first bad commit
revert or isolate suspect change
restore last known good behavior
block further merges in affected area
Permanent prevention
add regression test
tighten Neo task prompt
strengthen forbidden paths rule
add changed-file gate to review
add behavior checklist before merge
update protocol docs
7.8 Required Artifacts Before Closure

Do not close the postmortem until all are attached:

exact reproduction steps
last known good vs first known bad reference
diff file list
root cause statement
fix PR / commit
new regression test
updated guardrail or protocol
7.9 Lessons Learned
What failed
What should have caught it
What we will change now
Closure
Closed
Follow-up required

Owner:
Date:

8. Recovery Strategy for Suspected Main Regression

When main behavior appears worse than an earlier known-good state, do not reset main immediately.

Use this order:

Identify the last known good behavior checkpoint.
Find the commit, PR, or merge date associated with that checkpoint.
Create a recovery branch from current main for investigation.
Create a second comparison branch from the last known good commit.
Reproduce the same scenario on both branches.
Confirm whether the older branch is truly better.
Compare the diff window between good and bad states.
Decide whether to:
revert a specific change,
cherry-pick safe UI work onto the good baseline,
or rebuild the intended fix more carefully.

Important:
Do not destroy newer work before proving which change caused the degradation.

9. Practical Rules for Rollback Decisions

Prefer this order of response:

Case A — One bad change is identifiable

Use targeted revert.

Case B — A small range contains the regression

Use investigation branch + diff review + selective revert.

Case C — Main drifted across many merges

Use last known good branch as behavioral recovery baseline and forward-port only validated changes.

Case D — UI is valuable but behavior is broken

Preserve UI separately and re-apply it only after restoring behavior.

Behavior-first recovery is preferable to keeping a visually improved but functionally degraded system.

10. Minimum Evidence Required Before Merge

Before any merge that touches agent/runtime/procedure logic, require all of the following:

exact changed file list
exact success condition
behavior-sensitive test or scenario
proof that no unrelated files are included
reviewer confirmation against the base branch diff

If any of these are missing, the change is not ready.

11. Final Rule

The goal is not to make Neo "behave perfectly".
The goal is to make contamination, scope drift, and regressions unable to pass unnoticed into main.

Process quality must protect the project even when agent behavior is imperfect.