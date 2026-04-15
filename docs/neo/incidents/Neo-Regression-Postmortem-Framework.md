# Neo Regression Postmortem Framework

## Purpose

Use this framework whenever behavior got worse after Neo-delivered changes, even if tests were green.

This is not a blame document.
This is a control document to find:
- where regression entered,
- why it was not detected,
- what guardrail must be added so it does not happen again.

---

## 1. Incident Summary

- Feature / flow affected:
- Date regression was noticed:
- Reported by:
- Current severity:
  - [ ] Critical
  - [ ] High
  - [ ] Medium
  - [ ] Low
- User-visible impact:
- Internal impact:

---

## 2. Expected vs Actual Behavior

### Expected behavior
Describe what should happen in one concrete scenario.

### Actual behavior
Describe what happens now in the same scenario.

### Minimal reproduction
1.
2.
3.

### Evidence
- Screenshots:
- Logs:
- Prompt / request example:
- Failing test names:
- Session notes:

---

## 3. Regression Window

Identify the smallest known window where behavior changed.

- Last known good commit:
- First known bad commit:
- Compared branch(es):
- Neo task / PR / session involved:
- Was the task started from a fresh base branch?
  - [ ] Yes
  - [ ] No
  - [ ] Unknown

---

## 4. Change Scope Review

List what the task was supposed to change.

### Intended files
- 

### Actually changed files
- 

### Unrelated files touched
- 

### Scope verdict
- [ ] Scope stayed clean
- [ ] Scope drift happened
- [ ] Contamination files were included
- [ ] Unknown

If scope drift happened, describe it precisely.

---

## 5. Root Cause Analysis

Check all that apply.

### A. Task framing problem
- [ ] Task was too broad
- [ ] Success condition was vague
- [ ] Allowed file list was missing
- [ ] Forbidden file list was missing
- [ ] Base branch was not explicitly defined

### B. Agent execution problem
- [ ] Neo modified unrelated files
- [ ] Neo performed opportunistic cleanup
- [ ] Neo refactored adjacent logic without request
- [ ] Neo silently assumed requirements
- [ ] Neo reported completion without enough proof

### C. Review problem
- [ ] Review focused on prose summary, not git diff
- [ ] Review did not inspect changed file list first
- [ ] Review accepted contamination files
- [ ] Review did not compare against exact base branch

### D. Test problem
- [ ] Tests passed but did not reflect real behavior
- [ ] No regression test was added
- [ ] No manual scenario verification was done
- [ ] Existing tests were too shallow
- [ ] Edge cases were not covered

### E. Process problem
- [ ] Multiple changes were stacked before behavior verification
- [ ] Main already contained hidden degradation
- [ ] No rollback checkpoint existed
- [ ] Session/container state was trusted too much

---

## 6. Primary Root Cause

Write one sentence only.

Example:
Regression entered because the task allowed adjacent cleanup, review accepted the diff without checking against the exact base branch, and tests did not cover the real technician flow.

Primary root cause:
`...`

---

## 7. Recovery Plan

### Immediate containment
- [ ] Reproduce reliably
- [ ] Identify first bad commit
- [ ] Revert or isolate suspect change
- [ ] Restore last known good behavior
- [ ] Block further merges in affected area

### Permanent prevention
- [ ] Add regression test
- [ ] Tighten Neo task prompt
- [ ] Strengthen forbidden paths rule
- [ ] Add changed-file gate to review
- [ ] Add behavior checklist before merge
- [ ] Update protocol docs

---

## 8. Required Artifacts Before Closure

Do not close the postmortem until all are attached.

- [ ] Exact reproduction steps
- [ ] Last known good vs first known bad reference
- [ ] Diff file list
- [ ] Root cause statement
- [ ] Fix PR / commit
- [ ] New regression test
- [ ] Updated guardrail or protocol

---

## 9. Lessons Learned

### What failed
-

### What should have caught it
-

### What we will change now
-

---

## 10. Closure Decision

- [ ] Closed
- [ ] Follow-up required

Owner:
Date: