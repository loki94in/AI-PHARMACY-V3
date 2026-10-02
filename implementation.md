# Active Implementation Plan: Refill Cycle Filtering & 1-Click Ready Order Reminder

> **Master Plan**: [REFILL_CYCLE_AND_READY_ORDER_REMINDER_PLAN.md](file:///e:/CURRENT%20PROJECT%20ON%20WORKING/AI%20PHARMACY%20v2/REFILL_CYCLE_AND_READY_ORDER_REMINDER_PLAN.md)  
> **Goal**: 
> 1. Filter refill reminders by medicine due date/cycle (e.g. 15d due now; exclude 30d/180d future medicines).
> 2. Update refill reminder copy to polite pickup reminder ("packed and ready for collection at our pharmacy").
> 3. Implement 1-Click "Mark Ready" for Special Orders in CRM and Quick Assist with auto-dispatch.
> 4. Add human-in-the-loop 8s interactive Undo safeguard to cancel queued WhatsApp and revert status.
> 5. Guardrail and knowledge graph synchronization.
> **Status**: Ready to Execute  

---

## Tasks Checklist

- [ ] `Task 1`: Backend Refill Due Date & Cycle Filtering (`src/routes/refills.ts`).
- [ ] `Task 2`: Frontend Quick Assist & CRM Refill Display Alignment (`Layout.tsx` & `CRM/index.tsx`).
- [ ] `Task 3`: Special Orders 1-Click "Mark Ready" Auto-Send (`CRM/index.tsx` & `Layout.tsx`).
- [ ] `Task 4`: Human-in-the-Loop Interactive Undo Action (`frontend` + `src/routes/orders.ts`).
- [ ] `Task 5`: Quality Guardrails, Knowledge Graph Update & Verification.
