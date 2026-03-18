# NEO_TASK_BOOTSTRAP — RV Service Desk (MVP) — Option 2 (Next.js + Postgres)

## Repo
You are working inside this repo:
- https://github.com/blackredfox/rv-service-desk-v1.0
Branch: create a new branch from `main` (do NOT commit directly to main).

## Goal (MVP)
Build a ChatGPT-like web app for RV technicians:
- Left sidebar: list of “cases” (separate diagnostic/report threads)
- Center: chat thread + composer
- Dark/Light mode
- The assistant supports RU/ES/EN input
- Output must always include:
  1) English final report
  2) Full copy in the technician’s input language

MVP does NOT store images/files. Text only.

## Non-goals (strict)
Do NOT:
- change tech stack
- add external messenger integrations
- implement billing, auth/SSO, or shop admin
- build large file storage
- introduce complex state management frameworks

## Tech constraints
- Next.js App Router + TypeScript
- Postgres + Prisma
- Store ONLY text:
  - cases (threads)
  - messages
  - terms acceptance record

## Functional requirements
### Case management
- Create new case
- List cases (sidebar)
- Open a case (load messages)
- Soft delete a case
- Rename a case (optional for MVP, preferred)

### Search
- Search cases by title and message content (simple contains is fine for MVP)

### Chat (streaming)
- POST /api/chat must stream assistant output (SSE preferred) like ChatGPT “typing”
- Save user + assistant messages to DB
- Keep conversation context: last 30 messages for that case

### Terms & Privacy gate
- On first app use, user must accept Terms & Privacy (v1.0)
- Store acceptance in DB (TermsAcceptance table)
- If TERMS_VERSION changes, prompt acceptance again

## Safety / policy
- The assistant must not invent facts.
- Must ask short targeted questions if info is missing.
- Must not guarantee approvals.
- In warranty/insurance mode, avoid forbidden words:
  broken, failed, defective, damaged, worn, misadjusted, leaking

## Deliverables
1) Prisma schema with tables:
   - Case
   - Message
   - TermsAcceptance
2) API routes:
   - GET/POST /api/cases
   - GET/PATCH/DELETE /api/cases/:id
   - GET /api/search?q=
   - POST /api/chat (SSE streaming)
   - GET/POST /api/terms (or integrate into existing endpoints)
3) Minimal UI:
   - Sidebar + Search input + New Case button
   - Chat thread + Chat composer
   - Theme toggle
   - Terms gate modal/screen
4) Wire the production system prompt from:
   - src/lib/prompts/system-prompt-v1.ts

## Acceptance criteria (must pass)
- `npm run dev` starts without errors
- Create a case -> it appears in sidebar
- Send message -> assistant streams response
- Refresh page -> history persists (text only)
- Search finds cases by keyword
- Terms gate appears on fresh browser / after version bump

## Implementation notes
- Keep components simple; use basic Tailwind.
- Prefer server components where possible; client components only for interactive parts.
- Keep commits small and conventional.

## Commit / PR
- Conventional Commits
- Prefer 3–6 commits total
- Provide a short PR description with:
  - summary
  - how to test
  - known limitations
