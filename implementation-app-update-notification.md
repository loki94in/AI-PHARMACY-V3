# Implementation Plan: In-App Real-Time Update Notifications

## Problem & Requirement
When a new software release is published to GitHub/Vercel (e.g. `v0.1.257`), customer PCs download the update package in the background. However, the in-app notification card was previously suppressed with `isSilentOptionB = true` in `UpdateBanner.tsx`, leaving users unaware that a new version was verified and ready to install.

The user requested that whenever an update is pushed, the app should visibly show notifications alerting users that a new version is ready.

---

## Technical Design & Implementation

### 1. Enable Floating Update Card (`frontend/src/components/UpdateBanner.tsx`)
- Un-silenced the floating update card by setting `isSilentOptionB = false`.
- When an update package has finished downloading and checksum verification (`updateStatus.state === 'ready'`):
  - Displays a discreet floating card in the bottom-right corner.
  - Shows target version badge (`v0.1.257`).
  - Displays collapsible changelog ("What's new in this update").
  - Provides a 1-click **"Install & Restart"** button (smoothly launches `UpdateTransitionOverlay`).
  - Provides a **"Later"** button to postpone to next restart without interrupting cashier sales.
  - Triggers a real-time in-app toast notification upon first entering the `ready` state.

### 2. Header Notification Bell Integration (`frontend/src/components/Layout.tsx`)
- In `NotificationPanel`:
  - When `updateStatus.state === 'ready'` and `updateStatus.version`:
  - Injects a high-visibility pinned system alert card at the top of the notifications list:
    - Title: `Update Ready: v${updateStatus.version}`
    - Message: `Downloaded & verified. Ready to apply.`
    - Direct 1-click **"Install"** button triggering `applyUpdateNow()`.
  - In `Topbar`: The bell pulses with an active unread indicator badge whenever an update is ready.

### 3. Left Sidebar Version & Settings Badges (`frontend/src/components/Layout.tsx`)
- Next to `Settings` in the left sidebar, an emerald `Update` badge pulses when an update is ready.
- Topbar header status item continues showing live download progress percentage during background fetch and ready state upon completion.

### 4. Human-in-the-Loop Safeguards (Rule 6)
- The update never restarts the app autonomously without explicit cashier confirmation.
- Users can choose **"Install & Restart"** immediately or **"Later"** at their convenience.

---

## Tasks & Progress Log
- [x] Task 1: Un-silence `UpdateBanner.tsx` and add real-time toast alert on update readiness.
- [x] Task 2: Integrate update alert into `Layout.tsx` (Notification Bell, Topbar, and Sidebar).
- [x] Task 3: Verify with `npm run guardrails` (0 violations, clean TypeScript compilation).
- [x] Task 4: Run `node scripts/quick-update.mjs` to keep knowledge graph synchronized.
