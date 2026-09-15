# Automated Release Workflow Rule

**MANDATORY trigger when the user mentions keywords like "pilot deploy", "deploy pilot", "deploy release", "release pilot", or "deploy prod".**

## Trigger Keywords & Actions

1. **"pilot deploy" / "deploy pilot" / "release pilot"**:
   - Target: Pilot / Test licensed PCs only.
   - Command: `npm run release:pilot`

2. **"deploy release" / "release prod" / "production deploy"**:
   - Target: All customer production PCs.
   - Command: `npm run release`

## Standard Execution Checklist

When requested, the agent MUST autonomously execute:

1. **Pre-flight Check**: Run `npm run guardrails` to ensure no compile or performance violations.
2. **Commit & Push**: Stage any pending edits (`git add .`), commit with a descriptive message, and push (`git push`).
3. **Trigger Build & Release**: Run `npm run release:pilot` (or `npm run release`).
4. **Report to User**: Confirm the new version number (e.g. `v0.1.2`), rollout target (Pilot vs All), and that GitHub & Vercel have been updated so tester PCs can detect the update.
