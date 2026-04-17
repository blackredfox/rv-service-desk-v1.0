# RV Service Desk
## API_SCHEMA.md

**Version:** 1.3  
**Scope:** MVP API schema for a web-based RV Service Desk (case-based chat, session-only artifacts, explicit mode commands, language enforcement).

**Canonical behavior source:** the customer-approved behavioral algorithm, normalized in `docs/CUSTOMER_BEHAVIOR_SPEC.md`. If schema wording and customer behavior doctrine diverge, the customer behavior doctrine wins and the schema must be reconciled.

**Conceptual output-surface distinction is part of the API model:**
- `authorization_ready`
- `portal_cause`
- `shop_final_report`

These surfaces must remain distinct in both documentation and runtime. Their legality is runtime-owned and depends on readiness; it is not derived from model wording.

**Principles:**
- Text-first MVP.
- Images/audio/files are **session-only** (never stored).
- Mode transitions are **server-owned explicit trigger paths** (explicit commands, approved aliases, or future server-owned legality-gated CTA events; never meaning-only inference).
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
# RV Service Desk
## API_SCHEMA.md

**Version:** 1.3  
**Scope:** MVP API schema for a web-based RV Service Desk (case-based chat, session-only artifacts, explicit mode commands, language enforcement).

**Canonical behavior source:** the customer-approved behavioral algorithm, normalized in `docs/CUSTOMER_BEHAVIOR_SPEC.md`. If schema wording and customer behavior doctrine diverge, the customer behavior doctrine wins and the schema must be reconciled.

**Conceptual output-surface distinction is part of the API model:**
- `authorization_ready`
- `portal_cause`
- `shop_final_report`

These surfaces must remain distinct in both documentation and runtime. Their legality is runtime-owned and depends on readiness; it is not derived from model wording.

**Principles:**
- Text-first MVP.
- Images/audio/files are **session-only** (never stored).
- Mode transitions are **server-owned explicit trigger paths** (explicit commands, approved aliases, or future server-owned legality-gated CTA events; never meaning-only inference).
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