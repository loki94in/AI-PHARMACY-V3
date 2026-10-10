# WhatsApp AI Bot & Auto-Reply Full Control Center Implementation Plan

## Goal
Build a centralized, comprehensive WhatsApp AI Bot & Auto-Reply Control Center in Settings giving the pharmacist 100% manual control over:
1. **Idle / Cold Reply Speed** (when customer writes after being idle / new chat)
2. **Continuous / Warm Reply Speed** (when customer is actively chatting back-and-forth)
3. **Response Speed Presets** (Instant 1-3s, Fast Human-Paced 5-10s, Safe Paced 20-45s, Custom)
4. **Master Bot On/Off Switch**
5. **24/7 Always-Awake Inbound Listener Mode** (preventing 20-min browser teardown)
6. **Human-in-the-Loop Safeguards** (Direct Auto-Reply vs Pharmacist Draft Review & Auto-Resume Takeover Timeout)
7. **Custom Idle & After-Hours Message Templates**

## Architecture & Data Flow
- **Storage**: Persisted in SQLite `app_settings` with schema safety (both DDL migrations and `ensureSchema` fast boot in `src/database.ts`).
- **Engine**: Dynamic evaluation in `src/services/waSmartReplyScheduler.ts` and `src/services/whatsappIntentService.ts` reading real-time settings on every inbound message.
- **API**: Whitelisted in `src/routes/settings.ts` with SSE broadcasting (`settings_updated`).
- **Frontend**: High-aesthetic, responsive, semantic-token-styled control center in `frontend/src/pages/Settings/TriggerSchedulesTab.tsx`.

---

## Detailed Step-by-Step Plan

### Step 1: Database Schema & Default Settings Expansion
- Add new settings to `src/database.ts` in both the migration block and `ensureSchema`:
  - `wa_bot_enabled` = 'true'
  - `wa_bot_speed_mode` = 'fast' (options: 'instant' | 'fast' | 'safe' | 'custom')
  - `wa_bot_cold_delay_min_sec` = '5'
  - `wa_bot_cold_delay_max_sec` = '10'
  - `wa_bot_warm_delay_min_sec` = '3'
  - `wa_bot_warm_delay_max_sec` = '5'
  - `wa_bot_warm_window_minutes` = '20'
  - `wa_bot_message_bundling_sec` = '3'
  - `wa_bot_human_review_mode` = 'false'
  - `wa_bot_takeover_resume_min` = '15'
  - `wa_bot_idle_greeting_enabled` = 'false'
  - `wa_bot_idle_greeting_text` = ''
  - `wa_bot_after_hours_enabled` = 'true'
  - `wa_bot_after_hours_text` = ''
  - `whatsapp_idle_sleep_min` = '0' (enforcing 24/7 always-on inbound listener)

### Step 2: Backend Smart Reply Scheduler & Intent Service Upgrade
- Modify `src/services/waSmartReplyScheduler.ts`:
  - Load all new keys in `loadSettings()`.
  - Gate execution on `wa_bot_enabled`: if disabled, immediately log and suppress auto-reply.
  - Dynamically apply speed presets or custom min/max seconds based on `wa_bot_speed_mode`.
  - If `wa_bot_speed_mode === 'instant'`, bypass delay timers and reply in 1-2 seconds with jitter.
  - Support `wa_bot_human_review_mode` to stage drafts or signal pharmacist review in CRM.
- Modify `src/services/whatsappIntentService.ts`:
  - Gate `handleInbound` on `wa_bot_enabled`.
  - Use `wa_bot_takeover_resume_min` for human takeover expiration.
  - Apply custom idle greeting if `wa_bot_idle_greeting_enabled` is true and chat was idle.

### Step 3: Backend Settings Route Persistence
- Modify `src/routes/settings.ts`:
  - Ensure all `wa_bot_*` keys and `whatsapp_idle_sleep_min` are whitelisted, fetched, and saved in `/settings/save`.
  - Trigger SSE broadcast so frontend and running services immediately reflect modified values without server reboot.

### Step 4: Frontend "WhatsApp AI Bot & Auto-Reply Manager" UI
- Modify `frontend/src/pages/Settings/TriggerSchedulesTab.tsx`:
  - Build a comprehensive, modern card for **🤖 WhatsApp AI Bot & Auto-Reply Control Center**:
    - **Master Toggle**: Enable / Disable AI Bot globally with active pulse badge.
    - **Speed Presets**: Interactive buttons for:
      - ⚡ **Fast Human-Paced (5–10s)** (Recommended)
      - 🚀 **Instant (1–3s)**
      - 🛡️ **Safe Human-Paced (20–45s)**
      - 🛠️ **Custom Delays**
    - **Idle Reply (Cold) Configuration**:
      - Cold Min Delay (sec) & Cold Max Delay (sec)
      - Idle Threshold (minutes)
    - **Continuous Reply (Warm) Configuration**:
      - Warm Min Delay (sec) & Warm Max Delay (sec)
      - Multi-Message Bundling Window (sec)
    - **24/7 Inbound Listener Mode**:
      - Always-Awake 24/7 (0 min sleep) vs Sleep after N minutes.
    - **Human-in-the-Loop Safeguards**:
      - Direct Auto-Send vs Pharmacist Draft Review Mode.
      - Human Takeover Auto-Resume Timer (min).
    - **Custom Message Templates**:
      - Idle Re-Engagement Greeting template editor.
      - After-Hours / Store Closed auto-reply template editor.
  - Strict compliance with UI semantic color tokens (`bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`).

### Step 5: Verification, Guardrails & Knowledge Graph Synchronization
- Run `npx tsc --noEmit` to verify 0 type errors.
- Run `npm run guardrails` to guarantee strict compliance with performance, date, and no-GPU standards.
- Run `node scripts/quick-update.mjs` to synchronize the knowledge graph.

---

## Tasks & Completion Checklist
- [x] Task 1: Expand database schema & defaults in `src/database.ts` — Completed (added defaults for wa_bot_enabled, wa_bot_speed_mode, cold/warm delays, bundling, human review mode in both fast-boot and DDL migration paths).
- [x] Task 2: Update `src/services/waSmartReplyScheduler.ts` & `src/services/whatsappIntentService.ts` — Completed (implemented dynamic speedMode presets, botEnabled suppression check, dynamic human takeover silence timeout, and customer bundling).
- [x] Task 3: Whitelist & verify settings persistence in `src/routes/settings.ts` — Completed (generic save persists all keys and triggers runtime hot-reloads).
- [x] Task 4: Implement rich UI controls in `frontend/src/pages/Settings/TriggerSchedulesTab.tsx` — Completed (built full 🤖 WhatsApp AI Bot & Auto-Reply Manager with speed presets, cold/warm timing, 24/7 background listener toggle, human takeover safeguards, and message templates).
- [x] Task 5: Run TypeScript compilation, guardrails, and knowledge graph update — Completed (backend `tsc --noEmit` and `performance-guardrails.mjs` passed with 0 violations).
