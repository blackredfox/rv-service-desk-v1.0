# PRD

## Original problem statement
PR6 — bounded LLM-powered in-step clarification. Sticky same-step clarification must remain the default while findings are missing, but same-step support should answer the technician’s actual related question more naturally within the active step. Progression must remain locked behind findings/results only. EN / ES / RU support. Deterministic fallback required if clarification output is invalid.

## Architecture decisions
- Kept Context Engine as the only authority for progression, branching, completion, terminal state, and mode transitions.
- Added a bounded same-step clarification LLM path in the chat route for active-step support turns.
- Validation, retry, and deterministic fallback happen inside a narrow step-guidance execution helper.
- Same-step classification remains a bounded gate; helper output does not emit flow decisions.

## What's implemented
- Route-level same-step clarification now prefers an LLM-powered bounded answer instead of always using the same static guidance block.
- The bounded clarification prompt receives only current-step context, technician message, language, and attachment presence.
- Same-step clarification remains sticky while findings are missing; clarification turns do not advance, complete, branch, or switch mode.
- Invalid clarification output retries once, then falls back to the safe deterministic current-step guidance response.
- Deterministic tests cover EN/RU/ES, question-aware support, fallback, and findings-gated progression.

## Prioritized backlog
### P0
- Modularize oversized route clarification/authority sections into smaller services without changing behavior.

### P1
- Add more contract tests around attachment/photo-specific clarification prompts.
- Add lightweight telemetry around clarification retry/fallback rates.

### P2
- Tune bounded clarification prompt wording for even more concise answers.
- Expand multilingual coverage beyond EN / ES / RU if product scope grows.

## Next tasks
- Keep PR6 regression suite mandatory for future route/intent changes.
- Optionally split step-guidance prompt construction out of route.ts into a dedicated helper if future edits continue here.
