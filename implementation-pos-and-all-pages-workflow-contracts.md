# Implementation Plan: POS Contract (`POS.md`) & 22+ App Pages Flow Contract (`APP_PAGES_FLOW_CONTRACT.md`)

## Problem & Context
The user requested durable, immutable contracts so future AI agents (opencode, Claude, Cursor, Antigravity, etc.) never break:
1. **POS Flow (`POS.md`)**:
   - The exact keyboard navigation, auto-focus, loose tablet selling, full-pack auto-advance, FEFO batch allocation, lock/unlock toggle, billing discount, and payment flow.
   - Strict invariants and guardrails that no agent may ever violate or revert.
2. **All 22+ Core Pages Workflow Contract (`APP_PAGES_FLOW_CONTRACT.md`)**:
   - Comprehensive documentation across all 22+ application pages.
   - For every single page:
     - Purpose & Shop Role
     - Page Flow & Upstream/Downstream Integration
     - Every primary action button & keyboard shortcut
     - How it directly benefits the pharmacist/cashier/owner
     - Critical Agent Guardrails (what an agent MUST NOT touch or break)
3. **DOX Framework & Root Links**:
   - Wire pointers into `AGENTS.md` so every new agent immediately reads these contracts before touching frontend code.

---

## Deliverables
1. `POS.md` (root directory) — The master binding contract for the POS page.
2. `APP_PAGES_FLOW_CONTRACT.md` (root directory) — Comprehensive interactive workflow directory for all 22+ application pages.
3. Updated `AGENTS.md` with pointers to `POS.md` and `APP_PAGES_FLOW_CONTRACT.md`.
4. Updated knowledge graph via `node scripts/quick-update.mjs`.

---

## Tasks & Progress Log
- [x] Task 1: Draft and write comprehensive `POS.md` covering the end-to-end POS workflow, loose sales, keyboard shortcuts, and non-negotiable rules.
- [x] Task 2: Draft and write `APP_PAGES_FLOW_CONTRACT.md` covering all 22+ pages in detail (buttons, flows, business value, agent guardrails).
- [x] Task 3: Update `AGENTS.md` to reference `POS.md` and `APP_PAGES_FLOW_CONTRACT.md`.
- [x] Task 4: Run `npm run guardrails` to guarantee 0 regressions and clean build.
- [x] Task 5: Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
