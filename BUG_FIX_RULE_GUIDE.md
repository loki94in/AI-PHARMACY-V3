# Bug Fix Rule Guide (pointer)

> **This file is a shortcut.** The **universal** rulebook lives here:

## → [`AGENT_BUG_FIX_RULEBOOK.md`](./AGENT_BUG_FIX_RULEBOOK.md)

Use that document for **any agent, any project, any issue** — workflow, priorities, guardrails, checklist.

---

## This repository (AI Pharmacy v2) — project layer only

After reading the universal rulebook, read **this project’s** docs:

| File | Purpose |
|------|---------|
| [`SMALL_BUG_FIX_PLAN.md`](./SMALL_BUG_FIX_PLAN.md) | Bug catalog: fixed vs **open** (OPEN-01–OPEN-04) |
| [`AGENTS.md`](./AGENTS.md) | Page ownership, SPA/search, WhatsApp, no mock UI |
| [`docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`](./docs/PROJECT_PAGE_AUDIT_DIRECTORY.md) | Page ↔ API ↔ table map |
| [`AGENT_DATA_FLOW_TREE.md`](./AGENT_DATA_FLOW_TREE.md) | Shop-loop direction: which store a fact comes from, who writes it, who only reads it |

After code changes in this repo: `node scripts/quick-update.mjs`
