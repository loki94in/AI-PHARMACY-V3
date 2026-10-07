# Implementation Plan: Online Orders Sequential Fulfillment Workflow (Pending ➔ Ordered ➔ Ready ➔ Delivered/POS)

## 1. Objective
Synchronize the Online Orders workflow across both **Quick Assist Sidebar (`QuickAssistSidebar.tsx`)** and the **Website Orders Page (`WebsiteOrders/index.tsx`)** to follow the sequential lifecycle established by Special Requests:
1. **Stage 1 (Pending / Confirmed)**: Mark as **Ordered** (`<CheckCheck />`) or open directly in POS.
2. **Stage 2 (Ordered)**: Mark as **Ready** (`<BellRing />`), which sets the order as Ready and triggers the customer WhatsApp arrival notification.
3. **Stage 3 (Ready)**: **Resend Alert** (`<BellRing />`) if needed + **POS** / **Mark Delivered** for fulfillment.
4. **Tier 2 Secondary Controls**: Automated collection reminder toggling (`<Zap /> Auto / Off`), Edit (`<Edit3 />`), and Cancel (`<X />`).

---

## 2. Root Cause & Solution Architecture

### A. Quick Assist Sidebar (`QuickAssistSidebar.tsx`)
- **Current Behavior**: Online Orders skipped the "Ordered" stage entirely, jumping directly to "Ready" or "POS", while omitting the secondary Auto-Remind toggle available in Special Requests.
- **Solution**:
  - Implement the exact 2-tier card footer layout used by Special Requests:
    - **Tier 1 (Fulfillment Progression)**:
      - `group.overallStatus === 'Ready'`: Render `[Resend (Nx)]` (`<BellRing />`) and `[POS]` (`<Receipt />`).
      - `group.overallStatus === 'Ordered'`: Render `[Ready]` (`<BellRing />`) and `[POS]` (`<Receipt />`).
      - Else (`Pending` / `Confirmed`): Render `[Ordered]` (`<CheckCheck />`) and `[POS]` (`<Receipt />`).
    - **Tier 2 (Secondary Controls)**:
      - Left: If Ready, show the 1-click Auto Remind toggle (`handleToggleOrderAutoRemind`); otherwise show the status chip.
      - Right: Edit button (`<Edit3 />`) and Cancel button (`<X />`).
  - Update group header status chips to clearly display `Ordered` in emerald/indigo and `Ready` in sky.

### B. Website Orders Page (`WebsiteOrders/index.tsx`)
- **Current Behavior**:
  - `Pending` orders only exposed "Mark Ready" or "Confirm Payment", with no intermediate "Mark Ordered" step.
  - The status filter tabs and KPI metrics excluded `Ordered` status from the pending queue.
  - The 5-step timeline bar did not recognize `Ordered`.
- **Solution**:
  - Add `handleMarkOrdered(orderId: number)` to persist status change via `PUT /orders/:id/status`.
  - Add `Mark Ordered` button for orders in `Pending` status.
  - For orders in `Ordered` status, show `Mark Ready` button.
  - Update `getTimelineStep` to return step 3 for `order.status === 'Ordered'`, displaying "Ordered" on the progress tracker.
  - Update metrics and `statusFilter === 'pending'` to encompass both `Pending` and `Ordered`.

---

## 3. Tasks & Progress Tracker

- [x] **Task 1: Update Quick Assist Online Orders Card Footers (`QuickAssistSidebar.tsx`)**
  - **Status**: Completed
  - **Implementation Details**: Upgraded `groupedWebsiteOrders` card rendering to use the 2-Tier layout matching Special Requests. Tier 1 renders `[Ordered]` on Pending, `[Ready]` on Ordered, and `[Resend]` on Ready, alongside `[POS]`. Tier 2 renders the Auto-Remind toggle chip (`handleToggleOrderAutoRemind`), Edit modal button (`<Edit3 />`), and Cancel button (`<X />`). Header status badge reflects Ordered in indigo and Ready in sky with reminder counts.
- [x] **Task 2: Update Website Orders Page Workflow & Filters (`WebsiteOrders/index.tsx`)**
  - **Status**: Completed
  - **Implementation Details**: Added `handleMarkOrdered` to trigger `PUT /orders/:id/status` with `status: 'Ordered'`. Added `Mark Ordered` button on Pending orders and `Mark Ready` on Ordered orders. Updated `getTimelineStep` to advance to step 3 on Ordered, and expanded metrics & pending filter to encompass both Pending and Ordered orders.
- [x] **Task 3: Validation, Guardrails & Knowledge Graph**
  - **Status**: Completed
  - **Implementation Details**: Passed `npm run guardrails` with 0 violations and clean TypeScript compilation. Synchronized the repository knowledge graph via `node scripts/quick-update.mjs`.

