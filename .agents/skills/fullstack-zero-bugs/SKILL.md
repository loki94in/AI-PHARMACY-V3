---
name: fullstack-zero-bugs
description: Local-first zero-bugs development framework tailored for Antigravity, SQLite, Express, React, and Performance Guardrails. Enforces a 5-stage lifecycle (Spec -> Build -> Verification Gates -> 4-Angle Review -> Human-in-the-Loop Approval).
---

# Antigravity Zero-Bugs Skill

Adapted from the multi-agent factory framework for Google Antigravity and this repository's production stack:
- **Runtime**: Node.js + Express
- **Database**: SQLite (`better-sqlite3` via `dbManager` in `src/database.ts`)
- **Frontend**: React SPA (Vite, KeepAlive tabs, semantic Tailwind)
- **Quality Gates**: `npm run guardrails` + TypeScript check + Knowledge Graph sync
- **Human Authority**: Rule 6 Human-in-the-Loop approval

---

## When to use

- `/fullstack-zero-bugs <feature>` — implement a new feature end-to-end (spec → build → review → human approval).
- `/fullstack-zero-bugs fix <bug>` — bugfix with root-cause analysis and regression verification.
- `/fullstack-zero-bugs review` — execute 4-angle review (Security, Code, UI, UX) on current diff.

---

## Workflow (Mandatory, No Shortcuts)

### 1. Spec Gate (1 file, <30 lines)
Before writing code, produce a concise specification in `implementation.md` or `docs/plan/<slug>.md`:
- **Goal**: 1 sentence defining the exact user outcome.
- **Non-Goals**: Explicit boundaries on what will NOT be built.
- **API**: `METHOD /api/path` + request/response JSON shapes.
- **DB Diff**: SQLite changes adhering to `BACKEND SCHEMA SAFETY.md` (must specify both `ensureSchema` fast-boot and full DDL migration block).
- **Quality Gates**: Exact assertions and verification commands (`npm run guardrails`, `tsc`).
- **Performance**: Parameterized queries, indexes on `WHERE`/`ORDER BY`, pagination `limit <= 50`, module-level cache for kept-alive tabs.

*Rule: Never touch code before the spec is validated.*

---

### 2. Surgical Build (<400 lines diff)
- **Ponytail Simplicity**: Rely on existing standard libraries and repo utilities first; write the minimum code that solves the problem.
- **Database Access**: Parameterized SQLite statements via `dbManager.getConnection()`. Never use string concatenation in queries.
- **Frontend Styling**: Strictly use semantic Tailwind classes (`bg-bg`, `bg-bg2`, `text-text`, `text-muted`, `border-border`). Never hardcode raw hex, `bg-white`, or `text-white` on neutral surfaces.
- **No-GPU Contract (E1)**: CPU-only rendering. No `backdrop-filter`. Micro-animations (`animate-pulse`) must terminate after 3 cycles.
- **State Preservation**: Hydrate heavy lists from module-level caches outside components so KeepAlive tabs render instantly without layout shift.
- **Environment**: Never hardcode credentials. Load secrets only via `process.env`.

---

### 3. Automated Verification Gates (All Must Pass)
Every change must pass the automated repository gates:

```bash
# 1. Type verification
npx tsc -p frontend/tsconfig.app.json --noEmit

# 2. Automated architectural & speed guardrails
npm run guardrails

# 3. Knowledge Graph synchronization
node scripts/quick-update.mjs
```

- **Feature**: Minimum 1 unit or integration test added.
- **Bug Fix**: Reproduce with a failing test/check (red), then fix (green).
- **Blocking**: Any failure in `npm run guardrails` stops the pipeline immediately.

---

## 4. Four-Angle Review

Run the 4 autonomous reviews, recording verdicts in `factory/jobs/<slug>/round-1/review-{security,code,ui,ux}.md` or inline audit blocks:

1. **Security Reviewer** (`.agents/agents/reviewer-security.md`):
   - Parameterized SQL only? Route authorization on all endpoints?
   - Input sanitization? No credentials or secrets committed?
   - Zero autonomous patient messaging from background jobs?
2. **Code Reviewer** (`.agents/agents/reviewer-code.md`):
   - Diff <400 lines? TypeScript compiles clean with zero `any` leaks?
   - Database queries indexed? Module-level caching for KeepAlive tabs?
   - DOX framework rules obeyed?
3. **UI Reviewer** (`.agents/agents/reviewer-ui.md`):
   - Pure semantic Tailwind tokens used (Light & Dark theme compatible)?
   - No-GPU constraints respected (no `backdrop-filter`, 3-cycle pulse limits)?
   - Zero cumulative layout shift (CLS)?
4. **UX Reviewer** (`.agents/agents/reviewer-ux.md`):
   - Explicit loading, empty, and error states present?
   - Pagination visible and responsive? Form state preserved on tab switches?
   - Mobile responsive at 360px without horizontal scroll?

*Rule: All 4 reviews must return `VERDICT: PASS`. Any `VERDICT: CHANGES` triggers builder correction (maximum 2 rounds).*

---

### 5. Human-in-the-Loop Final Approval (Rule 6)

The automated bot **never** self-merges without human confirmation. 
The approver persona compiles the final dossier:
- Summary of files modified and verification results.
- The 4-angle review verdicts.
- Confirmation of clean `npm run guardrails`.
- Human decision prompt: **[Approve & Merge]**, **[Request Changes]**, or **[Adjust Parameters]**.

---

## Prohibitions
- Never add external billed SaaS or cloud dependencies.
- Never use unparameterized SQL or string concatenation.
- Never hardcode raw colors (`#18181b`, `text-white` on neutral backgrounds).
- Never remove pre-existing dead code unless directly requested.
- Never bypass `npm run guardrails`.
