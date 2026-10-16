---
name: fullstack-zero-bugs
description: Build any full-stack feature local-first with Postgres, zero-bugs gates (lint+build+test), no Firebase, no credit card. Use for new features, fixes, reviews, and 10k-daily perf checks. Works in Claude Code, OpenCode, Cursor, Codex, Copilot, Antigravity.
---

# Fullstack Zero-Bugs Skill

Distilled from `zazencodes-season-3` (21 projects, 14 skills, 7 factory agents).
Single canonical copy: `skills/fullstack-zero-bugs/SKILL.md`. All platform folders are identical.

## When to use

- `/fullstack-zero-bugs <feature>` — new feature end-to-end (spec → build → review → merge).
- `/fullstack-zero-bugs fix <bug>` — bugfix with regression test.
- `/fullstack-zero-bugs review` — run 4-angle review on current diff.

## Workflow (must follow, no shortcuts)

### 1. Spec (1 file, <30 lines)
Write `docs/plan/<slug>.md`:
- Goal (1 sentence), Non-goals, API (`METHOD /api/x` + shape), DB diff (`db/*.sql`), Tests (what `npm test` will assert), Perf (paginated? indexed?).

No code until spec exists.

### 2. Build (small diff, local-first)
- Branch: `factory/<slug>` (e.g. `factory/user-list`).
- DB: add migration in `db/`, query only via `server/src/db.ts` pool. Index every `WHERE`/`ORDER BY`.
- API: paginate `?limit<=50&offset=`. Validate inputs (zod or manual). No raw string SQL.
- UI: static-first, loading + empty + error states. No Firebase imports.
- Env: only `process.env` from `.env`. Never commit `.env`.

Example DB access:
```ts
import { pool } from "../db.js";
export async function listNotes(userId: string, limit = 20) {
  const l = Math.min(limit, 50);
  const { rows } = await pool.query(
    `SELECT id, title, updated_at FROM notes WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, l]
  );
  return rows;
}
```

### 3. Zero-bugs gates (all must pass)
```bash
npm run lint
npm run build
npm test
# or: npm run verify
```
- New feature → min 1 new test in `tests/`.
- Fix → regression test reproducing bug first (red), then fix (green).
- If any gate red: fix, re-run, do not proceed to review.

### 4. Four-angle review (from factory agents)
Create `factory/jobs/<slug>/round-1/review-{security,ux,ui,code}.md`, each starting with:
`VERDICT: PASS` or `VERDICT: CHANGES` + 3-bullet reason + file:line refs.

- security: SQL injection? XSS? authz check on every route? secrets leaked? (`reviewer-security.md`)
- ux: loading/empty/error? paginated? keyboard + mobile? (`reviewer-ux.md`)
- ui: static-first? contrast? no layout shift? (`reviewer-ui.md`)
- code: <400 lines? types? no `any` leak? indexes? (`reviewer-code.md`)

All 4 must PASS in same round. Any CHANGES → builder resumes (max 2 rounds), then re-review.

### 5. Approve + perf smoke
`decision.md` starts `APPROVE` or `ESCALATE`.
Then:
```bash
npm run perf:smoke  # 100x /api/health, fails if any >500ms locally
```
Merge to `main` only on APPROVE + gates green.

## Local Postgres (no card, 10k daily)

`docker-compose.yml` runs `postgres:16-alpine`. Schema in `db/schema.sql`.
Rules:
- Every table has `id uuid PK`, `created_at`, `updated_at`.
- Index FKs + sort keys: `CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at DESC)`.
- Use `EXPLAIN` before merging new queries. Full table scan = CHANGES.
- Paginate everything. No `SELECT *` without `LIMIT`.

## Platform notes

- Claude Code: `/fullstack-zero-bugs` auto-found in `.claude/skills/`.
- Codex: `$fullstack-zero-bugs` or `/skills` in `.agents/skills/`.
- Cursor/Copilot/Antigravity/OpenCode: same `SKILL.md` in `.cursor/skills/`, `.github/skills/`, `.agent/skills/`, `opencode.json`.
- If platform lacks skill auto-load, paste this file + `AGENTS.md` into context.

## Don't

- Don't add Firebase / billed SaaS. Don't commit `.env`. Don't skip tests.
- Don't create `src/<new-project>` folders. Build in `client/`, `server/`, `db/`.
