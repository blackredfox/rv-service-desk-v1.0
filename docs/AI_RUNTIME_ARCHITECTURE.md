# AI_RUNTIME_ARCHITECTURE.md

**Project:** RV Service Desk  
**Purpose:** Explain how the AI system operates at runtime.

This document describes the **AI orchestration pipeline** used by RV Service Desk.

The system is **not** an autonomous chatbot.
The system is **server-bounded, not server-scripted**.
The server controls legality, state, and truth boundaries.
The LLM controls natural phrasing inside those boundaries.

---

# 1. High-Level Architecture

AI responses are generated through a controlled pipeline.
Client
↓
API Route
↓
Input Normalization / Intent Extraction
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

---

# 2. Step-by-Step Runtime Flow

## Step 1 — Technician Message

The technician sends a message through the chat interface.

Example:
The bedr00m slide... water leaking... added screws and silicone... write warranty report

Real-world input may be:
- mixed language,
- typo-heavy,
- copied from work orders,
- complaint + findings + repair summary in one message.

---

## Step 2 — Server Request Processing

The API route performs initial checks:

- authentication
- rate limiting
- case retrieval
- language detection
- bounded mode/intent detection
- request normalization

Modes include:

- diagnostic
- authorization
- final_report

Mode transitions occur only through explicit commands or approved natural-language aliases.

The server must not perform uncontrolled semantic switching.

---

## Step 3 — Input Normalization / Intent Extraction

Before flow routing, the runtime may perform bounded preprocessing for:
- mixed-language input,
- keyboard-layout corruption,
- typo/noise cleanup,
- complaint / findings / corrective action extraction,
- report-intent detection.

This layer exists to make the product usable with real technician input.

Hard boundaries:
- no invented facts,
- no diagnostic authority,
- no hidden step selection,
- no uncontrolled mode switching.

---

## Step 4 — Context Engine Execution

The Context Engine evaluates the current case state.

Responsibilities:

- determine active procedure
- determine next diagnostic step
- verify prerequisites
- enforce diagnostic gates
- decide whether final output is allowed
- determine terminal/report-ready state

The Context Engine is the **single authority for diagnostic step flow**.

---

## Step 5 — Prompt Construction

The Prompt Builder constructs the AI prompt.

Prompt composition includes:

- system prompt
- mode-specific prompt
- diagnostic context
- previous conversation messages
- active-step support context when applicable

---

## Step 6 — LLM Execution

The prompt is sent to the language model.

The LLM is responsible only for:

- generating technician-readable text
- bounded current-step explanation
- concise collaborative technician phrasing
- producing translation
- formatting final outputs

Runtime metadata such as system / classification / mode / status / step are grounding inputs,
not mandatory default speech format.

The LLM does **not decide diagnostic logic**.

---

## 7 — Output Validation

The server validates the AI response.

Validation includes:

- correct mode output
- English-first formatting
- translation block presence
- diagnostic gate compliance
- current-step guidance staying non-advancing
- no hidden report drift
- no wrong-mode output generation

If validation fails:

- the response may be repaired
- or the request retried
- or authoritative fallback may be used

---

## Step 8 — Response Delivery

After validation, the server returns the response to the client.

The response is stored in:

- case messages
- message history

The chat UI displays the assistant response.

---

# 3. Failure Handling

The system includes resilience mechanisms.

Possible failure cases:

- AI response formatting errors
- translation block missing
- wrong-mode output
- robotic step-guidance repetition
- natural report-intent not honored
- dirty-input misclassification
- OpenAI connectivity issues

Fallback strategies include:

- retry policies
- response validation repair
- authoritative step fallback
- deterministic intent handling

---

# 4. Architecture Principles

The runtime pipeline follows strict architectural rules.
Context Engine
→ diagnostic logic

LLM
→ language generation

Server
→ validation, normalization, legality, and enforcement

Canonical doctrine:
- server bounds the legal response,
- server does not need to author every normal diagnostic sentence,
- the LLM may speak naturally as long as it stays inside the active legal state.

This separation prevents AI systems from drifting into uncontrolled chatbot behavior or brittle ritual-command UX.

---

# 5. Why This Architecture Exists

Uncontrolled AI systems often produce:

- inconsistent diagnostics
- unsafe authorization language
- unpredictable workflows
- robotic or brittle interaction patterns

RV Service Desk uses **server-bounded AI orchestration** to ensure:

- deterministic diagnostic flow
- safe authorization text
- reliable documentation outputs
- technician-realistic interaction under constraints

End of file.