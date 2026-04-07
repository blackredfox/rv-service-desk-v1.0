# PRD

## Original problem statement
NEO TASK — Tiny TypeScript Build Fix

Fix the pre-existing TypeScript build error in `src/app/api/chat/route.ts`.

Known build error:
`Type 'string[]' is not assignable to type 'RepairSummaryMissingField[]'. Type 'string' is not assignable to type 'RepairSummaryMissingField'.`

User constraints:
- tiny compiler-only fix
- default expectation is a one-file diff in `src/app/api/chat/route.ts`
- no behavior changes
- no refactor
- no lockfile changes
- only expand beyond one file if impossible, and report first
- base for proof: `origin/neo-base/route-ts-build-fix`

## Architecture decisions
- Kept scope to a single-file change in `src/app/api/chat/route.ts`
- Reused the existing exported `RepairSummaryMissingField` type from `@/lib/chat`
- Fixed only type inference for the fallback `missingReportFields` array; runtime logic unchanged

## What's been implemented
- Added `type RepairSummaryMissingField` to the existing `@/lib/chat` import
- Annotated `missingReportFields` as `RepairSummaryMissingField[]`
- Preserved the same fallback values and control flow
- Verified via `git diff` that the code change is limited to `src/app/api/chat/route.ts`
- Verified the original `string[]` → `RepairSummaryMissingField[]` error no longer appears in TypeScript output

## Prioritized backlog
### P0
- Resolve other pre-existing TypeScript errors still blocking `next build` in `src/app/api/chat/route.ts`:
  - implicit `any` on `msg` callbacks around lines 380-384
  - `string | null` assigned to `string` around line 818

### P1
- Re-run full production build after those unrelated route-level errors are fixed

### P2
- Add a dedicated typecheck script for faster targeted verification of future compiler-only fixes

## Next tasks
1. If approved, fix the remaining unrelated `route.ts` type errors that still block `next build`
2. Re-run `next build` and confirm the route compiles cleanly end-to-end
