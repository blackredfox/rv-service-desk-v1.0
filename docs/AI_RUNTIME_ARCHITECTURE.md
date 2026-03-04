# AI_RUNTIME_ARCHITECTURE.md

**Project:** RV Service Desk
**Purpose:** Explain how the AI system operates at runtime.

This document describes the **AI orchestration pipeline** used by RV Service Desk.

The system is **not an autonomous chatbot**.
All AI behavior is controlled by server-side orchestration.

---

# 1. High-Level Architecture

AI responses are generated through a controlled pipeline.

```
Client
  ↓
API Route
  ↓
Context Engine
  ↓
Prompt Builder
  ↓
LLM
  ↓
Output Validator
  ↓
Response to Client
```

---

# 2. Step-by-Step Runtime Flow

## Step 1 — Technician Message

The technician sends a message through the chat interface.

Example:

```
AC is not cooling. Compressor running but no cold air.
```

The client sends a request to:

```
POST /api/chat
```

---

## Step 2 — Server Request Processing

The API route performs initial checks:

* authentication
* rate limiting
* case retrieval
* language detection
* mode detection

Modes include:

```
diagnostic
authorization
final_report
```

Mode transitions only occur through explicit commands.

---

## Step 3 — Context Engine Execution

The Context Engine evaluates the current case state.

Responsibilities:

* determine active procedure
* determine next diagnostic step
* verify prerequisites
* enforce diagnostic gates
* decide whether final output is allowed

The Context Engine is the **single authority for diagnostic step flow**.

---

## Step 4 — Prompt Construction

The Prompt Builder constructs the AI prompt.

Prompt composition includes:

* system prompt
* mode-specific prompt
* diagnostic context
* previous conversation messages

Example components:

```
SYSTEM_PROMPT_BASE
MODE_PROMPT_DIAGNOSTIC
MODE_PROMPT_AUTHORIZATION
MODE_PROMPT_FINAL_REPORT
```

---

## Step 5 — LLM Execution

The prompt is sent to the language model.

The LLM is responsible only for:

* generating technician-readable text
* producing translation
* formatting final outputs

The LLM does **not decide diagnostic logic**.

---

## Step 6 — Output Validation

The server validates the AI response.

Validation includes:

* correct mode output
* English-first formatting
* translation block presence
* diagnostic gate compliance

If validation fails:

* the response may be repaired
* or the request retried

---

## Step 7 — Response Delivery

After validation, the server returns the response to the client.

The response is stored in:

* case messages
* message history

The chat UI displays the assistant response.

---

# 3. Failure Handling

The system includes resilience mechanisms.

Possible failure cases:

* AI response formatting errors
* translation block missing
* OpenAI connectivity issues

Fallback strategies include:

* retry policies
* response validation repair
* graceful degradation

---

# 4. Architecture Principles

The runtime pipeline follows strict architectural rules.

```
Context Engine
→ diagnostic logic

LLM
→ language generation

Server
→ validation and enforcement
```

This separation prevents AI systems from drifting into uncontrolled chatbot behavior.

---

# 5. Why This Architecture Exists

Uncontrolled AI systems often produce:

* inconsistent diagnostics
* unsafe authorization language
* unpredictable workflows

RV Service Desk uses **server-controlled AI orchestration** to ensure:

* deterministic diagnostic flow
* safe authorization text
* reliable documentation outputs
