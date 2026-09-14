# How AI Pharmacy OS Works (Plain-Language Overview)

> Written for a newcomer who wants a correct mental model in 5 minutes, not a deep reference.
> Last verified against the actual code on 2026-09-14. Where an older doc disagrees with this one, this one wins — it was fact-checked against the code, the older doc wasn't.

## 1. What this actually is

One product, five pieces, sharing one SQLite database (or syncing to it):

| Piece | Folder | What it is |
|---|---|---|
| **Backend** | `src/` | Node.js + Express + TypeScript server. The brain — all business logic, all data access. |
| **Desktop UI** | `frontend/` | React + Vite + Tailwind single-page app. What the pharmacist actually looks at all day (POS, Inventory, Purchases, Reports...). |
| **Mobile app** | `pharmacy-mobile/` | React Native / Expo app that talks to the same backend. |
| **Customer website** | `website/` | Customer-facing ordering site, deployed separately on Vercel — not bundled into the desktop installer. |
| **License server** | `gas/` | A tiny Google Apps Script service (`licenseServer.js`) that issues/checks licenses, backed by a Google Sheet. |

The backend + desktop UI are packaged together into one Windows `.exe` via Node SEA (Single Executable Application) and installed with Inno Setup. Despite a leftover `electron/` folder in the repo, **this is not an Electron app** — that folder is unused.

## 2. How the backend actually starts up

The real entry point is `src/bootstrap.ts`, not `src/server.ts` (older docs say `server.ts` — that's the Express app *module*, not the process entry point).

Because the whole app ships as one single executable file, there's no separate script to launch for background jobs. So `bootstrap.ts` does one trick: it looks at an environment variable, `WORKER_ROLE`, and decides what to become:

- `WORKER_ROLE` unset → import `server.ts` and run the normal HTTP API server.
- `WORKER_ROLE=catalog` → run the catalog worker (`src/worker/catalogWorker.ts`) — background catalog/image processing.
- `WORKER_ROLE=email` → run the email poller (`src/worker/emailPoller.ts`) — auto-fetches purchase invoices from Gmail/IMAP.

A supervisor forks *the same exe* with different `WORKER_ROLE` values to get these background processes, instead of shipping separate scripts. This is the one thing every other doc in the repo misses or gets wrong — worth remembering if something in a worker process isn't behaving like you'd expect from reading `server.ts` alone.

## 3. Where the data lives

Everything lives in one SQLite file (via `better-sqlite3`), in WAL mode, under `data/`. There is no separate database server to run — the exe and the SQLite file are the whole backend. See `docs/DATABASE_ARCHITECTURE.md` for caching/perf details (that doc is otherwise accurate).

## 4. A concrete example: making a sale in POS

1. Pharmacist searches for a medicine — SPA calls `GET /api/medicines/search-fast`.
2. Bill is finalized — SPA calls `POST /api/sales` (root, not `/api/sales/bill` — an older doc had this wrong; fixed 2026-09-14 in `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`).
3. `src/routes/sales.ts` handles it: validates real stock is available (this app **never** auto-creates stock to cover a shortfall — see `AGENTS.md` "strict inventory-only sales" rule), writes the sale + stock ledger rows, returns the invoice.
4. Frontend prints/shows the invoice.

This same route file (`src/routes/sales.ts`, ~3200 lines) also handles holds, staged/queued sales, reorder suggestions, and credit dues — it's the single biggest route file in the backend.

## 5. Integrations that run in the background

WhatsApp (via `whatsapp-web.js`), Gmail/IMAP, Telegram, and OCR (Tesseract) all run as background workers or services supervised by the same `bootstrap.ts` dispatch mechanism described above, not as separate apps.

## 6. Which other docs to trust

The repo has **dozens** of root-level `.md` files. Most of them are one-off feature specs that were fed to an AI coding agent for a single task — useful as history, not as a map of the current app. Newcomer's reading order:

1. This file, then `README.md` (setup/build steps — accurate as of this pass).
2. `docs/ARCHITECTURE.md` — accurate, best doc for how the frontend fetches/caches data.
3. `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` — accurate, page-by-page (which route feeds which screen).
4. `docs/DATABASE_ARCHITECTURE.md` — accurate on concepts (WAL, caching).

**Skip these unless you're specifically working on that historical task** — they're implementation plans/specs, not current-state docs: `APP.MD` (an aspirational future-architecture doc, not what's built today), `idealstate.md` (despite the name, it's a specific POS/Purchase search performance bug writeup), and the many one-off `*_PLAN.md` / `CATALOGUE...` / `Supplier Returns...` / `PHARMACY ORDER...` files.

`AGENTS.md`, `AGENT_BUG_FIX_RULEBOOK.md`, and `BACKEND SCHEMA SAFETY.md` are real and load-bearing, but they're rules-for-AI-agents documents, not an explanation of the app for a human — that's what this file is for.
