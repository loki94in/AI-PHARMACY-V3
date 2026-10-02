# WhatsApp Smart Reply Engine — Implementation Plan
**Created:** 2026-10-02 | **Author:** Antigravity Agent  
**Status:** PLANNING — Do not edit source files until "IMPLEMENT" is confirmed

---

## 1. What We're Building (User Requirement Summary)

| # | Requirement | Priority |
|---|---|---|
| R1 | Never reply instantly — always add a human-like delay | P0 |
| R2 | **Cold new user** → wait **35–60 sec** before replying | P0 |
| R3 | **Active mid-conversation** → reply with **10–17 sec** gap | P0 |
| R4 | Offline batch: send **only one reply per customer** when WA reconnects | P0 |
| R5 | If message was **already opened/read by pharmacist** on ANY PC → suppress bot reply | P0 |
| R6 | 20-minute warm-window: if convo was active in last 20 min → use shorter delay | P1 |
| R7 | Multiple messages from same customer while offline → reply only once (latest context) | P0 |

---

## 2. Current System — What Already Exists

### Files Involved
| File | Role |
|---|---|
| `src/whatsappClient.ts` | WA browser client, `message_create` handler, routes to `handleInbound` |
| `src/services/whatsappIntentService.ts` | `handleInbound()` — the brain, greeting/clarification/medicine logic |
| `src/services/whatsappQueueWorker.ts` | Queue drain loop, pacing, dedup, reconnect recovery |
| `src/services/whatsappDeliveryRegister.ts` | Permanent sent ledger, `isAlreadyDelivered()` |
| `src/services/whatsappQueue.ts` | Legacy facade for `whatsappQueueWorker` |
| `src/database.ts` | Schema DDL — `whatsapp_messages`, `whatsapp_chats`, `whatsapp_send_queue` |

### Current Behavior — Gap Analysis

| Feature | Current State | Gap |
|---|---|---|
| **Reply delay** | `customer_greeting` type is in `CHATBOT_CONVERSATIONAL_TYPES` → **direct bypass, ZERO delay** (queueWorker line 492–501) | ❌ All chatbot replies fire instantly |
| **Queue pacing** | 10–15s min between outbound queue items | Only for billing/distributor queue, not chatbot replies |
| **Dedup on reconnect** | `cleanupOldSentItems()` marks stale 24h+ items `skipped_offline` | ⚠️ Does NOT collapse multiple msgs from same customer into one reply |
| **Cross-device read tracking** | `whatsapp_chats.unread_count` increments on inbound, resets manually | ❌ No `pharmacist_opened_at` flag, no cross-device read-state sync |
| **20-min warm window** | No concept of this exists | ❌ Missing entirely |
| **ACK-based read detection** | `message_ack` event fires (line 1484) but only broadcasts SSE, never stored in DB | ❌ ACK events not persisted |
| **Human takeover** | 5-min manual mode via `session_mode = 'manual'` | ✅ Works — distinct from "was message opened" |
| **Multiple offline messages** | Each inbound message triggers `handleInbound` independently | ❌ No queue collapse — all fire replies |

---

## 3. Root Cause of All Gaps

The chatbot reply path uses the **CHATBOT_CONVERSATIONAL_TYPES bypass** — skips the queue entirely and calls `sendMessage()` directly with zero delay. The queue's 10–15s pacing only applies to billing/distributor messages. The chatbot is a completely separate fast-path that now needs tiered delay logic added.

---

## 4. New Architecture — Smart Reply Engine

```
Inbound Message (from whatsappClient.ts message_create)
    │
    ▼
[GATE 1] Was message already opened by pharmacist? (pharmacist_opened_at IS NOT NULL)
    │ YES → suppress bot reply entirely
    │ NO ↓
[GATE 2] Is there a pending-reply for this customer already scheduled?
    │ YES → cancel old timer, replace with latest message context
    │ NO ↓
[GATE 3] What is the warm-window state?
    │ Active convo (last_pharmacist_message_at < 20 min ago) → delay = rand(10–17s)
    │ Cold / new customer                                     → delay = rand(35–60s)
    ▼
Schedule reply via new WaSmartReplyScheduler (setTimeout, cancellable)
    │
    ▼
On fire: re-check GATE 1 (was it read while waiting?)
    │ YES → cancel silently
    │ NO → call handleInbound logic → send reply
```

---

## 5. Implementation Tasks

### Task 1 — DB Schema: Add `pharmacist_opened_at` to `whatsapp_messages`
**File:** `src/database.ts` + fast-boot path in `src/whatsappClient.ts`

Add columns to `whatsapp_messages`:
```sql
ALTER TABLE whatsapp_messages ADD COLUMN ack_status INTEGER DEFAULT 0;
ALTER TABLE whatsapp_messages ADD COLUMN pharmacist_opened_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_msgs_ack ON whatsapp_messages (chat_id, from_me, ack_status);
```

- `ack_status` — mirrors WhatsApp ACK (0=sent, 1=server, 2=device, 3=read)  
- `pharmacist_opened_at` — timestamp when ANY PC opened this chat in CRM (cross-device dedup key)

**Verify:** `PRAGMA table_info(whatsapp_messages)` shows new columns  
**Completion mark:** ✅ T1 done

---

### Task 2 — Mark messages as read when pharmacist opens CRM chat
**File:** `src/routes/messaging.ts`

When `GET /api/messaging/chats/:chatId/messages` is called (CRM chat open), mark all unread inbound messages:
```sql
UPDATE whatsapp_messages
SET pharmacist_opened_at = <now>
WHERE chat_id = ? AND from_me = 0 AND pharmacist_opened_at IS NULL
```

This is the **cross-device read flag** — written to SQLite, visible to ALL PCs on the same DB.

**Verify:** Open chat in CRM → query shows `pharmacist_opened_at` set on inbound rows  
**Completion mark:** ✅ T2 done

---

### Task 3 — Persist `message_ack` events in DB
**File:** `src/whatsappClient.ts` (line 1484 `message_ack` handler)

Currently the `message_ack` event only broadcasts SSE. Add DB persistence:
```typescript
// When ack >= 2 (delivered to device) — update outbound messages
await db.run(
  `UPDATE whatsapp_messages SET ack_status = ? WHERE id = ?`,
  [ack, msg.id._serialized]
);
```

Secondary signal; Task 2 is primary for inbound read-state.

**Verify:** Send a test message → watch `ack_status` column update  
**Completion mark:** ✅ T3 done

---

### Task 4 — NEW FILE: `src/services/waSmartReplyScheduler.ts`
**File:** `src/services/waSmartReplyScheduler.ts` *(new)*

Core delay engine. Responsibilities:

```typescript
class WaSmartReplyScheduler {
  private pendingReplies: Map<string, { timer: NodeJS.Timeout; msg: WAMessage; scheduledAt: number }>;

  scheduleReply(msg: WAMessage): void;
  // - normalize phone key
  // - check pharmacist_opened_at gate (DB query)
  // - cancel existing timer for same phone if any
  // - detect warm window (query last_pharmacist_message_at)
  // - pick delay: warm = rand(10–17s), cold = rand(35–60s)
  // - set setTimeout → on fire: re-check gate → call handleInbound

  cancelReplyFor(phone: string): void;
  isReplyPending(phone: string): boolean;
}
```

**Delay picker:**
```typescript
async function pickDelay(phone: string, db: any): Promise<number> {
  const row = await db.get(
    `SELECT last_pharmacist_message_at FROM whatsapp_chats WHERE id LIKE ?`,
    [`%${cleanDigits}%`]
  );
  const warmWindowMs = (warmWindowMin * 60 * 1000); // default 20min
  const isWarm = row?.last_pharmacist_message_at > (Date.now() - warmWindowMs);
  
  if (isWarm) {
    const min = coldDelayMin; const max = coldDelayMax;   // 10–17s
    return min * 1000 + Math.random() * (max - min) * 1000;
  }
  return coldMin * 1000 + Math.random() * (coldMax - coldMin) * 1000; // 35–60s
}
```

All 5 delay/window settings read live from `app_settings` on each call:
- `wa_bot_cold_delay_min_sec` (default 35)
- `wa_bot_cold_delay_max_sec` (default 60)
- `wa_bot_warm_delay_min_sec` (default 10)
- `wa_bot_warm_delay_max_sec` (default 17)
- `wa_bot_warm_window_minutes` (default 20)

**Verify:** New customer → timer set for ~42s; active convo → timer set for ~13s  
**Completion mark:** ✅ T4 done

---

### Task 5 — Wire scheduler into `whatsappClient.ts` inbound path
**File:** `src/whatsappClient.ts` (line 1466–1478)

**Before:**
```typescript
if (!msg.fromMe) {
  import('./services/whatsappIntentService.js')
    .then(mod => {
      const handler = mod.handleInbound || ...;
      if (handler) handler(msg).catch(...);
    });
}
```

**After:**
```typescript
if (!msg.fromMe) {
  import('./services/waSmartReplyScheduler.js')
    .then(mod => {
      mod.waSmartReplyScheduler.scheduleReply(msg);
    })
    .catch(err => console.error('[WhatsApp] Smart reply scheduler error:', err));
}
```

The scheduler calls `handleInbound` after the delay if gates pass.

**Verify:** Console shows "Scheduling reply in 38s for +9199..." for new customer  
**Completion mark:** ✅ T5 done

---

### Task 6 — Cancel pending reply when pharmacist opens CRM chat
**File:** `src/routes/messaging.ts`

Same GET endpoint as Task 2. After marking messages read, also:
```typescript
import { waSmartReplyScheduler } from '../services/waSmartReplyScheduler.js';
waSmartReplyScheduler.cancelReplyFor(chatId);
```

Bot reply is silently dropped — pharmacist is handling it manually.

**Verify:** Open chat → console shows "Reply cancelled for +9199..."  
**Completion mark:** ✅ T6 done

---

### Task 7 — Offline queue collapse on WA reconnect
**File:** `src/services/whatsappQueueWorker.ts`

Add new method `processOfflineInboundBatch()`:

```typescript
public async processOfflineInboundBatch(): Promise<{
  processed: number; skipped_read: number; skipped_replied: number;
}> {
  if (!this.detectedOutageInterval) return { processed: 0, skipped_read: 0, skipped_replied: 0 };
  
  const { start, end } = this.detectedOutageInterval;
  
  // 1. Get all inbound messages during outage window, grouped by chat
  const msgs = await db.all(`
    SELECT chat_id, MAX(timestamp) as latest_ts, body, id
    FROM whatsapp_messages
    WHERE from_me = 0
      AND timestamp >= ? AND timestamp <= ?
    GROUP BY chat_id
  `, [Math.floor(start/1000), Math.floor(end/1000)]);
  
  // 2. For each contact: skip if read, skip if already replied, else schedule
  for (const msg of msgs) {
    // Check pharmacist_opened_at
    const readRow = await db.get(
      `SELECT pharmacist_opened_at FROM whatsapp_messages WHERE id = ?`, [msg.id]
    );
    if (readRow?.pharmacist_opened_at) { skipped_read++; continue; }
    
    // Check if bot already replied after this message
    const replied = await db.get(
      `SELECT id FROM whatsapp_messages WHERE chat_id = ? AND from_me = 1 AND timestamp > ?`,
      [msg.chat_id, msg.latest_ts]
    );
    if (replied) { skipped_replied++; continue; }
    
    // Schedule reply with cold delay (was offline, no warm window)
    waSmartReplyScheduler.scheduleReply(reconstructedMsg, { forceCold: true });
    processed++;
  }
}
```

Called from `startWorkerLoop()` after `cleanupOldSentItems()` if outage was detected.

**Verify:** Simulate 5 messages from same customer offline → 1 reply on reconnect  
**Completion mark:** ✅ T7 done

---

### Task 8 — Settings UI: Bot Delay Controls
**File:** `frontend/src/pages/Settings.tsx` (WhatsApp settings section)

Add "🤖 Auto-Reply Timing" card with sliders/inputs:

| Label | DB Key | Default | Range |
|---|---|---|---|
| Cold reply delay (min sec) | `wa_bot_cold_delay_min_sec` | 35 | 10–120 |
| Cold reply delay (max sec) | `wa_bot_cold_delay_max_sec` | 60 | 10–120 |
| Active convo delay (min sec) | `wa_bot_warm_delay_min_sec` | 10 | 5–60 |
| Active convo delay (max sec) | `wa_bot_warm_delay_max_sec` | 17 | 5–60 |
| Warm window (minutes) | `wa_bot_warm_window_minutes` | 20 | 5–60 |

All settings use existing `PATCH /api/settings` endpoint — no new route needed.

**Verify:** Change cold delay to 5–10s → next new customer reply fires in ~7s  
**Completion mark:** ✅ T8 done

---

### Task 9 — Human-loop: Manual offline batch endpoint
**File:** `src/routes/messaging.ts`

```
POST /api/messaging/process-offline-batch
```

Returns:
```json
{
  "processed": 3,
  "skipped_read": 1,
  "skipped_already_replied": 1
}
```

Frontend can show a notification on WA reconnect: *"3 customers messaged while offline. [Send Replies] [Review First]"*

This fulfills the **human-in-the-loop** requirement — owner can approve or cancel the batch before replies go out.

**Verify:** POST returns correct counts without sending anything unless `?confirm=true` is passed  
**Completion mark:** ✅ T9 done

---

## 6. Complete Before/After Comparison

| Scenario | Before | After |
|---|---|---|
| New customer sends "Hi" | Instant reply (0ms) | 35–60s random delay |
| Customer sends query mid-convo | Instant reply | 10–17s random delay |
| 5 messages while WA offline | 5 replies on reconnect | 1 reply per customer (latest context) |
| Pharmacist reads chat on old PC | Bot still replies | Bot reply cancelled globally via DB flag |
| Pharmacist opens chat in CRM | Bot still replies | Bot reply cancelled immediately |
| WA disconnects, messages arrive | Lost or random | Batched offline, processed with human approval |
| New customer cold state | Immediate greeting | 35–60s delay (feels like human lookup) |
| Active chat (last 20 min) | Immediate | 10–17s (feels like pharmacist still there) |

---

## 7. Files Changed Summary

| File | Change Type | Risk |
|---|---|---|
| `src/database.ts` | ADD COLUMN (additive) | 🟢 Low |
| `src/whatsappClient.ts` | Inbound wiring + ACK persist | 🟡 Medium — touches message handler |
| `src/services/waSmartReplyScheduler.ts` | **NEW FILE** — isolated module | 🟢 Low |
| `src/services/whatsappQueueWorker.ts` | Additive method | 🟢 Low |
| `src/routes/messaging.ts` | Mark read + cancel + new endpoint | 🟢 Low |
| `frontend/src/pages/Settings.tsx` | New UI card | 🟢 Low |

---

## 8. Task Completion Tracker (for resuming agents)

| Task | File(s) | Status |
|---|---|---|
| T1 — Schema: ack_status + pharmacist_opened_at | `database.ts` | ⬜ Pending |
| T2 — Mark read when CRM chat opened | `routes/messaging.ts` | ⬜ Pending |
| T3 — Persist ACK events | `whatsappClient.ts` | ⬜ Pending |
| T4 — NEW: waSmartReplyScheduler.ts | `services/waSmartReplyScheduler.ts` | ⬜ Pending |
| T5 — Wire scheduler into inbound | `whatsappClient.ts` | ⬜ Pending |
| T6 — Cancel reply on CRM open | `routes/messaging.ts` | ⬜ Pending |
| T7 — Offline queue collapse | `whatsappQueueWorker.ts` | ⬜ Pending |
| T8 — Settings UI delay controls | `frontend/.../Settings.tsx` | ⬜ Pending |
| T9 — Human-loop batch endpoint | `routes/messaging.ts` | ⬜ Pending |

---

> **Next step:** Say **IMPLEMENT** to begin execution. Agent will run T1 → T9 in order, marking each complete before moving to next.
