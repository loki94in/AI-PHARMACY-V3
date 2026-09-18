# Automated Release Workflow Rule

**MANDATORY trigger when the user mentions keywords like "pilot deploy", "deploy pilot", "deploy release", "release pilot", "npm release", or "deploy prod".**

## Trigger Keywords & Actions

1. **"pilot deploy" / "deploy pilot" / "release pilot"**:
   - Target: Pilot / Test licensed PCs only.
   - Command: `npm run release:pilot`

2. **"deploy release" / "release prod" / "production deploy" / "npm release"**:
   - Target: All customer production PCs.
   - Command: `npm run release`

## Default Execution Checklist (LOCAL BUILD ONLY)

By default, when the user asks to release/build, the agent MUST:

1. **Pre-flight Check**: Run `npm run guardrails` to ensure no compile or performance violations.
2. **Commit & Push**: Stage any pending edits (`git add .`), commit with a descriptive message, and push (`git push`).
3. **Trigger Build**: Run `npm run release:pilot` (or `npm run release`).
4. **Report to User**: Confirm the build succeeded and the local installer/exe path.

> ⚠️ **OWNER PREFERENCE (set 2026-09-18):**
> Skip version bumping and GitHub/Vercel publishing steps by default.
> The release script will run locally only.
> Do NOT bump package.json version, do NOT push a GitHub Release tag, do NOT publish to Vercel update-check server
> **UNLESS** the user explicitly includes BOTH the words **"git"** AND **"vercel"** in their release request.
> Example of a full release request: "npm release git vercel" or "release with git and vercel".
