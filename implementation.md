# Implementation Plan: Production Release (`npm run release`)

> **STATUS: IN PROGRESS**  
> **Created:** 2026-10-06  
> **Objective:** Execute full production release workflow according to `.agents/rules/automated-release.md` and repo contracts: run guardrails pre-flight check, stage and commit uncommitted changes, execute release build script, and report final release status.

---

## 1. Release Workflow & Sequence

1. **Pre-flight Check**: Run `npm run guardrails` (`node scripts/performance-guardrails.mjs`) to ensure TypeScript compilation passes and there are 0 performance/integrity violations.
2. **Knowledge Graph Sync**: Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
3. **Commit & Push**:
   - Stage all pending changes (`git add .`).
   - Commit with descriptive message documenting Pharmarack order sync service and recent changes.
   - Push to remote branch (`git push`).
4. **Execute Production Release**:
   - Run `npm run release` (`node scripts/release.mjs`).
   - Note: Release script automatically increments patch version in `package.json`, runs clean client/server builds, and packages bundle/executable.
5. **Report & Verify**:
   - Confirm final version number, build artifacts, and release completion to user.

---

## 2. Tasks & Progress Tracker

| Task ID | Description | Status | How It Was Completed |
|---|---|---|---|
| **TASK-1** | Pre-flight guardrails check (`npm run guardrails`) | IN PROGRESS | Running guardrails scanner against current diff to verify zero violations. |
| **TASK-2** | Knowledge Graph auto-update (`node scripts/quick-update.mjs`) | PENDING | - |
| **TASK-3** | Git commit and push pending changes | PENDING | - |
| **TASK-4** | Execute production release (`npm run release`) | PENDING | - |
| **TASK-5** | Verification and final report to user | PENDING | - |
