# Neo Documentation Index

## Purpose

This directory contains the operating documents for using Neo safely in this project.

## Documents

### `NEO_OPERATING_KIT.md`
Main source of truth for:
- branch hygiene,
- contamination prevention,
- scope control,
- merge review rules,
- regression recovery logic.

Use this as the primary policy document.

### `incidents/Neo-Regression-Postmortem-Framework.md`
Use this when behavior got worse after a Neo-delivered change, even if tests were green.

This is the standard regression investigation template.

### `templates/Neo-Task-Guardrail-Block.md`
Reusable block for Neo task prompts.

Use this inside implementation requests to constrain scope and require proof of completion.

### `quick-reference/NEO_MERGE_REVIEW_CHECKLIST.md`
Short reviewer checklist for fast pre-merge verification.

Use this as a compact review aid, not as a replacement for the operating kit.

## Rule of precedence

1. `NEO_OPERATING_KIT.md` is the main policy.
2. Templates and checklists support the main policy.
3. If documents appear to overlap, follow the operating kit.