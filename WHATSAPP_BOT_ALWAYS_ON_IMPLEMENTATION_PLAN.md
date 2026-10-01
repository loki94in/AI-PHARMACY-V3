# WhatsApp Bot Always-On & Status Fix — Implementation Plan

## Problem
1. WhatsApp AI Bot goes deaf when idle-sleep is active (whatsapp_idle_sleep_min > 0): headless Chrome is destroyed, inbound customer messages are NEVER received — Bot is effectively dead.
2. App footer shows 'Auto-Sync Active' with a green Wifi icon even when WhatsApp is sleeping, giving false confidence.
3. 'Mobile Devices (N/N Online)' refers to the React Native mobile app, NOT the WhatsApp bot — users conflate the two.

## Solution Applied — Option A (Always-On 24/7 AI Bot)

### [DONE] TASK 1 — Force sleep=0 in DB at every boot
- File: src/database.ts (lines 761 and 3851)
- Changed INSERT OR IGNORE to INSERT ... ON CONFLICT DO UPDATE SET value='0'
- This OVERWRITES any previously saved non-zero value at boot — bot is always-on after this deploy.

### [DONE] TASK 2 — Backend: POST /messaging/wake route
- File: src/routes/messaging.ts (inserted after /reconnect route)
- Route: sets whatsapp_idle_sleep_min='0' in DB + calls initClient({ manual: true }) if not already ready
- Safe to call even when already connected (no-op)
- Returns { success: true, message: 'WhatsApp bot woken up...' }

### [DONE] TASK 3 — Frontend: wakeWhatsapp in api.ts
- File: frontend/src/services/api.ts
- Added: wakeWhatsapp: () => apiClient.post('/messaging/wake').then(res => res.data)

### [DONE] TASK 4 — Frontend: AI Bot status in ConnectedDevicesFooterBar.tsx
- File: frontend/src/components/ConnectedDevicesFooterBar.tsx
- Replaced always-green 'Auto-Sync Active' area with truthful AI Bot status pill:
  * Green 'AI Bot: Active' (pulsing dot) — when WhatsApp is ready
  * Amber 'AI Bot: Sleeping — Wake' (clickable button) — when sleeping
  * Red 'AI Bot: Offline — Connect' (clickable button) — when disconnected
- One-click Wake calls wakeWhatsapp() + polls every 2s for up to 20s until bot is ready
- SSE-driven: reacts to sse-wa-status-changed events instantly
- Added Bot, BotOff, Loader2 icons from lucide-react

## Guardrails: PASS (tsc: OK, no violations)
## Knowledge Graph: Updated

## What changed for the user
- After app restart, WhatsApp bot will NEVER go to sleep automatically — it stays awake 24/7 so all customer messages are received and replied to instantly.
- The footer now clearly shows 'AI Bot: Active' (green) so you can immediately tell the bot is live.
- If the bot ever shows Sleeping or Offline in the footer, click it to wake it instantly.
