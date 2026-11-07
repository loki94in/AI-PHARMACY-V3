# WhatsApp Pure Message Truth & Canonical Contact Linking Implementation Plan

## Goal
Completely redesign WhatsApp outgoing message handling and contact resolution:
1. **Single Source of Truth**: Eliminate the artificial `msg_out_` provisional database records so that `whatsapp_messages` ONLY contains genuine WhatsApp messages confirmed by WhatsApp Web. This makes duplicate message bubbles mathematically impossible.
2. **Canonical Contact Auto-Linking**: Ensure all contacts (especially those with `@lid` JIDs) automatically resolve to their 10-digit mobile phone number, auto-link to existing customer/staff/distributor names, and merge duplicate threads.
3. **Database Cleanup**: Purge historical `msg_out_%` records on application startup.
4. **Guardrail Compliance**: Verify with `npx tsc --noEmit`, `npm run guardrails`, and `node scripts/quick-update.mjs`.

---

## Architectural Changes

### 1. `src/whatsappClient.ts`
- In `sendMessage()`:
  - Stopped inserting `msg_out_` provisional rows into `whatsapp_messages`.
  - Maintained the in-memory anti-duplicate debounce cache (`recentSendsCache`) so rapid repeated clicks or duplicate loop triggers are still safely blocked.
  - Relies on WhatsApp Web's `client.on('message_create')` to record the message once WhatsApp Web emits it (<200ms).
- In `client.on('message_create')` and `client.on('message')`:
  - When a message arrives with an `@lid`, queries `client.getContactLidAndPhone` or contact store to extract the real phone number.
  - Sets `resolved_number` on `whatsapp_chats`.
  - Auto-enriches `name` from `customers` (`phone`), `delivery_boys` (`phone`), or `suppliers` (`phone`) if the name is just digits or an ID.
- In `getChatMessages()`:
  - Simplified message query: excludes any residual `msg_out_%` records (`wm.id NOT LIKE 'msg_out_%'`).
  - Queries using `inPlaceholders` across all related IDs (`raw`, `@lid`, `@c.us`).

### 2. `src/database.ts`
- In `ensureSchema()`:
  - Boot-time purge: `DELETE FROM whatsapp_messages WHERE id LIKE 'msg_out_%'`.
  - Cleaned up legacy orphan provisional records once and for all.

### 3. `frontend/src/pages/CRM/WhatsAppSection.tsx`
- In `onWaNewMessage`:
  - Reconciles optimistic UI placeholders with confirmed genuine WhatsApp messages (`filter(m => !(m.id.startsWith('optimistic_') && m.body === newMsg.body))`).
  - Uses `behavior: 'auto'` for instant, jitter-free scroll directly to the bottom.

---

## Task Progress Tracker

- [x] Task 1: Update `src/whatsappClient.ts` to stop writing `msg_out_` rows and enhance canonical contact auto-linking.
  - *Completed*: Removed `INSERT INTO whatsapp_messages` with `msg_out_` from `sendMessage()`. Added canonical name enrichment from `delivery_boys`, `customers`, and `suppliers` in `message_create`.
- [x] Task 2: Update `src/database.ts` to purge all historical `msg_out_%` records on boot.
  - *Completed*: Added unconditional `DELETE FROM whatsapp_messages WHERE id LIKE 'msg_out_%'` in `ensureSchema()`.
- [x] Task 3: Verify TypeScript compilation and run automated performance guardrails.
  - *Completed*: Backend `tsc --noEmit` exit 0, frontend `npm run build` exit 0, `npm run guardrails` passed with 0 violations.
- [x] Task 4: Run Knowledge Graph quick-update script.
  - *Completed*: Ran `node scripts/quick-update.mjs` in 4.4s (Nodes: 1489, Edges: 885).
- [x] Task 5: Final review and report to user.
  - *Completed*: All changes verified and ready for deployment.
