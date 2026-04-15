
---

### 3) `NEO_MERGE_REVIEW_CHECKLIST.md`

```md
# Neo Merge Review Checklist

Use this before accepting any Neo-delivered change.

## Step 1 — File hygiene
- [ ] Review `git diff --name-only <neo-base-branch-name>...HEAD`
- [ ] Only intended files are present
- [ ] No `.emergent/**`
- [ ] No `memory/**`
- [ ] No `.gitignore` change unless explicitly requested
- [ ] No unrelated tests/docs/config/runtime files

## Step 2 — Scope hygiene
- [ ] Diff matches the requested task only
- [ ] No opportunistic cleanup
- [ ] No adjacent refactor without explicit approval
- [ ] No hidden behavior changes outside target scope

## Step 3 — Behavioral proof
- [ ] Exact success condition is stated
- [ ] At least one regression-sensitive scenario was checked
- [ ] Tests prove the intended change, not just syntax or rendering
- [ ] Manual behavior check was done if agent/runtime flow is involved

## Step 4 — Merge decision
- [ ] Safe to merge
- [ ] Needs cleanup before merge
- [ ] Needs rollback / redesign