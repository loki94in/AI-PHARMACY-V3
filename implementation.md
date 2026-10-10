# Environment Setup Implementation Plan: Node.js LTS & Python 3.12

## Context & Root Cause Analysis
The developer machine underwent cleanup where previously installed software was uninstalled.
- `node` & `npm` were unrecognized because the previous NVM installation (`C:\Users\ratna\AppData\Local\nvm\v24.16.0`) was removed, leaving broken symlinks in PATH.
- `python` was unrecognized / broken because previous Python 3.12/3.14 installs were uninstalled, breaking execution aliases.
- This project (`AI PHARMACY v2`) requires:
  1. **Node.js LTS** (Node 24.20.0 with npm 11.19.0) for the Express backend, React/Vite frontend, background workers, and scripts.
  2. **Python 3.12 (64-bit)** for `scispacy` & `spacy` biomedical text processing in `python/scan_nlp/` and `python_scripts/extract_medicine.py` (Python 3.13+ is unsupported by `scispacy 0.5.4` wheels).

---

## Execution Plan & Completed Steps

### Step 1: Automated Package Installation via winget
- Installed Node.js LTS (v24.20.0, npm 11.19.0) via `winget install --id OpenJS.NodeJS.LTS`.
- Installed Python 3.12 (v3.12.10 64-bit) via `winget install --id Python.Python.3.12`.

### Step 2: Session PATH Refresh & Stale Environment Cleanup
- Cleaned up obsolete / broken paths from User PATH (including dead `C:\nvm4w\nodejs` junction, non-existent Python 3.14 paths, and dead nvm folders).
- Configured Python 3.12 (`C:\Users\ratna\AppData\Local\Programs\Python\Python312` & `Scripts`) and Node.js (`C:\Program Files\nodejs`) in User and process PATH.
- Installed required VC++ 140 runtime libraries for C-extensions (`numpy_ops`).

### Step 3: Verification of Core Toolchains
- `node -v` -> `v24.20.0`
- `npm -v` -> `11.19.0`
- `python --version` -> `Python 3.12.10`

### Step 4: Python SciSpaCy NLP Environment Setup
- Recreated virtual environment in `python/scan_nlp/.venv` using Python 3.12.
- Installed `spacy` (v3.7.5), `scispacy` (v0.6.2), `en_core_sci_sm` (v0.5.4), `en_ner_bc5cdr_md` (v0.5.4), and `click`.
- Linked `python_scripts/.venv` to the working Python 3.12 virtual environment.
- Verified `extract_medicine.py` and model loading run with zero errors.

### Step 5: Project Dependency & Guardrails Verification
- Verified `npx tsc --noEmit` passes with 0 type errors.
- Verified `npm run guardrails` passes.
- Updated auto-knowledge graph via `node scripts/quick-update.mjs`.

---

## Tasks & Completion Checklist
- [x] Task 1: Install Node.js LTS via winget — Completed (Node.js v24.20.0 installed via winget).
- [x] Task 2: Install Python 3.12 via winget — Completed (Python 3.12.10 installed via winget).
- [x] Task 3: Refresh session PATH and verify `node`, `npm`, `python` binaries — Completed (Removed broken junctions & paths; verified all 3 runtimes).
- [x] Task 4: Configure Python virtual environment and install `scispacy` dependencies — Completed (Rebuilt `.venv`, installed spacy + scispacy models + VC runtime libraries, verified `extract_medicine.py`).
- [x] Task 5: Verify project health, run guardrails, and update knowledge graph — Completed (tsc --noEmit, guardrails, and quick-update passed).
