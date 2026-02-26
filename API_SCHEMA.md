# RV Service Desk
## API_SCHEMA.md

**Version:** 1.1  
**Scope:** MVP API schema for a web-based RV Service Desk (case-based chat, session-only artifacts, explicit mode commands, language enforcement).

**Principles:**
- Text-first MVP.
- Images/audio/files are **session-only** (never stored).
- Mode transitions are **explicit** (never inferred).
- Server validates output format (English-first + translation block; gating rules).
- Persistence is text-only (cases + messages + final outputs).

---

## 1) Conventions

### 1.1 Base URL
- Local: `http://localhost:3000`
- All endpoints are prefixed with `/api`.

### 1.2 Content Types
- Requests: `application/json` unless specified
- Responses: `application/json`

### 1.3 Identifiers
- `caseId`: `string` (uuid preferred)
- `messageId`: `string` (uuid preferred)

### 1.4 Time
- `createdAt`, `timestamp`: ISO 8601 UTC strings

### 1.5 Errors
All errors return:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": "any"
  }
}
```

Status codes:
- 400: validation / bad request
- 401: auth required
- 413: payload too large
- 429: rate limit
- 500: server error

---

## 2) Data Models

### 2.1 Case

```json
{
  "caseId": "string",
  "title": "string",
  "inputLanguage": "en" | "ru" | "es",
  "languageSource": "AUTO" | "MANUAL",
  "metadata": {
    "pendingReportRequest": true,
    "pendingReportRequestedAt": "2026-02-03T23:12:00Z",
    "pendingReportLocale": "en" | "ru" | "es"
  },
  "createdAt": "2026-02-03T23:12:00Z",
  "updatedAt": "2026-02-03T23:45:00Z"
}
```

### 2.2 Message

```json
{
  "messageId": "string",
  "caseId": "string",
  "role": "technician" | "agent",
  "language": "en" | "ru" | "es",
  "content": "string",
  "timestamp": "2026-02-03T23:13:00Z"
}
```

### 2.3 Mode

```json
{
  "mode": "diagnostic" | "authorization" | "final_report"
}
```

**Rule:** mode changes only via explicit technician command.

### 2.4 Session Artifacts (session-only)
Artifacts are never stored; they only exist inside one request.

```json
{
  "images": [
    {
      "mimeType": "image/jpeg",
      "base64": "...",
      "filename": "photo1.jpg"
    }
  ],
  "files": [
    {
      "mimeType": "application/pdf",
      "base64": "...",
      "filename": "form.pdf"
    }
  ]
}
```

---

## 3) Cases API (MVP)

### 3.1 Create Case
`POST /api/cases`

Request:
```json
{ "title": "string (optional)" }
```

Response (201):
```json
{
  "case": {
    "caseId": "string",
    "title": "New Case",
    "inputLanguage": "en",
    "languageSource": "AUTO",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 3.2 List Cases
`GET /api/cases`

Response (200):
```json
{ "cases": [ { "caseId": "string", "title": "string", "createdAt": "...", "updatedAt": "..." } ] }
```

### 3.3 Rename Case
`PATCH /api/cases/{caseId}`

Request:
```json
{ "title": "string" }
```

Response (200):
```json
{ "case": { "caseId": "string", "title": "string", "createdAt": "...", "updatedAt": "..." } }
```

### 3.4 Delete Case
`DELETE /api/cases/{caseId}`

Response (204): empty body

---

## 4) Chat API (Core)

### 4.1 Send Message / Get Next Agent Message
`POST /api/chat`

Purpose:
- append technician message
- run AI orchestration
- validate output rules (mode, language blocks, gating)
- return agent response + current state

Request:
```json
{
  "caseId": "string",
  "clientContext": {
    "uiLanguage": "en" | "ru" | "es",
    "timezone": "America/New_York"
  },
  "messages": [
    {
      "role": "technician",
      "language": "en",
      "content": "string",
      "timestamp": "..."
    }
  ],
  "sessionArtifacts": {
    "images": [],
    "files": []
  }
}
```

Response (200):
```json
{
  "agentMessage": {
    "role": "agent",
    "language": "en",
    "content": "string",
    "timestamp": "..."
  },
  "state": {
    "mode": "diagnostic" | "authorization" | "final_report",
    "inputLanguage": "en" | "ru" | "es"
  }
}
```

Streaming (SSE) event payloads:
```json
{ "type": "token", "token": "text" }
{ "type": "badges", "system": "...", "complexity": "complex", "mode": "diagnostic", "isolationComplete": false, "finding": "", "activeStepId": "" }
{ "type": "status", "llm": { "status": "up"|"down", "reason": "auth_blocked" }, "fallback": "llm"|"checklist", "mode": "diagnostic", "message": "..." }
{ "type": "mode", "mode": "diagnostic" }
{ "type": "mode_transition", "from": "diagnostic", "to": "final_report" }
{ "type": "validation", "valid": false, "violations": ["..."] }
{ "type": "validation_fallback", "violations": ["..."] }
{ "type": "done" }
```

Mode transition rules (server-side):
- Explicit commands only (allow-list; exact/near-exact match after case/whitespace normalization only).
- Final Report aliases:
  - START FINAL REPORT
  - FINAL REPORT
  - GENERATE FINAL REPORT
  - REPORT
  - GIVE ME THE REPORT
  - RU: ВЫДАЙ РЕПОРТ, РЕПОРТ, ФИНАЛЬНЫЙ РЕПОРТ, СДЕЛАЙ РЕПОРТ
  - ES: REPORTE FINAL, GENERAR REPORTE, REPORTE
- Authorization aliases:
  - START AUTHORIZATION REQUEST
  - AUTHORIZATION REQUEST
  - REQUEST AUTHORIZATION
  - PRE-AUTHORIZATION
  - RU: ЗАПРОС АВТОРИЗАЦИИ, АВТОРИЗАЦИЯ, ПРЕАВТОРИЗАЦИЯ
  - ES: SOLICITAR AUTORIZACIÓN, AUTORIZACIÓN, PREAUTORIZACIÓN
- Otherwise keep current mode.

Hard boundaries:
- server must never infer mode transitions from meaning
- server must validate English-first + translation block when in final outputs
- server must enforce diagnostic gates for complex systems

---

### 4.2 Get Case Messages (if backend persists)
`GET /api/cases/{caseId}/messages`

Response (200):
```json
{
  "messages": [
    {
      "messageId": "string",
      "role": "technician" | "agent",
      "language": "en" | "ru" | "es",
      "content": "string",
      "timestamp": "..."
    }
  ],
  "state": { "mode": "diagnostic" | "authorization" | "final_report" }
}
```

---

## 5) Speech-to-Text API (Optional MVP)

### 5.1 Transcribe Audio
`POST /api/stt/transcribe`

Request: `multipart/form-data`
- field `audio`: wav/m4a/mp3
- field `languageHint` (optional): `en|ru|es`

Response (200):
```json
{ "text": "string", "detectedLanguage": "en" | "ru" | "es" }
```

Boundary: audio is not stored.

---

## 6) Health

### 6.1 Health Check
`GET /api/health`

Response (200):
```json
{ "status": "ok", "version": "1.1" }
```

---

## 7) Rate Limiting (Recommended)
- Limit by IP in MVP
- Example: 60 requests/minute per IP
- On limit exceeded: HTTP 429

---

## 8) Security & Privacy Boundaries
- No storing images/files/audio
- Avoid PII in logs
- Do not expose OpenAI/Stripe secrets to clients
