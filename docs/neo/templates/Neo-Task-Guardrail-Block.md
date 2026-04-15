# Neo Task Guardrail Block

Use this block inside every Neo coding task.

```text
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