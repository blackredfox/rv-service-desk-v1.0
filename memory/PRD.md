# PRD / Task Handoff

## Original problem statement
Add a proper forgot-password flow to RV Service Desk.

Key requirements:
- keep the PR narrow to auth/UI/test files only
- reuse the existing Firebase-based auth model
- do not reveal whether an email exists
- add a forgot-password path from the login UI
- use the generic success message: "If an account exists for that email, a reset link has been sent."
- if repo configuration is incomplete, explain the blocker before introducing any custom reset-token system

## Architecture decisions
- Kept the implementation inside the existing auth surface: `src/lib/auth.ts`, an auth API route, the existing `LoginScreen`, and focused auth tests.
- Used Firebase Identity Toolkit's native password reset email flow (`accounts:sendOobCode`) instead of adding a parallel reset-token store.
- Reused the current app redirect behavior by passing through the existing app URL when present, otherwise allowing Firebase/provider defaults.
- Avoided user enumeration by swallowing Firebase `EMAIL_NOT_FOUND` in the auth helper and returning the same generic success payload from the route.
- Made Firebase Admin and Prisma imports lazy inside `src/lib/auth.ts` so the new forgot-password route does not hard-fail on unrelated Prisma client loading.

## Implemented
- Added `POST /api/auth/forgot-password` in `src/app/api/auth/forgot-password/route.ts`.
- Added `requestFirebasePasswordReset()` to `src/lib/auth.ts` using Firebase-native reset email flow.
- Updated `src/components/login-screen.tsx` with:
  - forgot-password link from sign-in mode
  - email-only reset request form
  - generic success/confirmation state
  - back-to-sign-in actions
  - data-testid coverage for new interactive elements
- Added focused tests:
  - `tests/auth-routes.test.ts`
  - `tests/login-screen.test.tsx`
  - `tests/auth-password-reset.test.ts`
- Verified targeted test suite passes: 15/15 passing.
- Verified UI flow visually in the browser; live success-state email delivery is currently blocked by missing Firebase runtime config.

## Current blocker
- Live forgot-password email dispatch is blocked in the current runtime because `FIREBASE_WEB_API_KEY` is not configured.
- No custom reset-token system was introduced.

## Prioritized backlog
### P0
- Add `FIREBASE_WEB_API_KEY` to the runtime environment and retest live forgot-password submit.
- Confirm the live browser flow shows the exact generic success message after the API is configured.
- Add a branded Firebase password-reset email template if product wants a polished provider-managed email.

### P1
- Add one more browser-level auth regression that exercises forgot-password against a configured environment.
- Decide whether login/register should share a small auth API env-health check for faster diagnostics.

### P2
- Add lightweight analytics around reset-request attempts without storing sensitive reset data.
- Add optional resend UX if product wants a second-step confirmation helper.

## Next tasks
- Provide the missing Firebase web API key in runtime.
- Rerun live forgot-password submit after env is available.
- Keep future auth changes scoped to the same auth/UI/test surface.
