# APP_PAGES_FLOW_CONTRACT.md — Master Architecture & Interactive Workflow Contract for All 22+ Application Pages

> **Binding Authority**: Subtree of root `AGENTS.md` and `AGENT_DATA_FLOW_TREE.md`  
> **Target Audience**: AI Agents (opencode, Claude, Cursor, Antigravity) & Human Engineers  
> **Core Contract**: Workflows and page contracts defined here must never be broken, reverted, or bypassed by future code edits.

---

## Master System Architecture

The AI Pharmacy platform is organized around a unified, event-driven, single-source-of-truth loop:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           1. INVENTORY & PURCHASING                         │
│  Purchases (OCR/Invoice) ──► PurchaseHistory ──► Inventory ──► Expiry Audit │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         2. RETAIL BILLING & DISPATCH                        │
│  POS (Sole Retail Writer) ──► Sells Ledger ──► Customer Return ──► Dispatch │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       3. PATIENT CARE & REORDER HUB                         │
│  CRM (Refills/Credit) ──► Phone/Web Orders ──► LiveCart ──► Pharmarack PO   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      4. AUDITING, REPORTS & GOVERNANCE                      │
│    Dashboard (Briefing) ──► Reports (GST/P&L) ──► AuditCenter ──► Database  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. POS — Point of Sale (Retail Billing)
- **Path**: `frontend/src/pages/POS/index.tsx` | **Route**: `/pos`
- **Role**: Sole retail sale writer. Atomically commits `sales`, `sale_items`, inventory decrements, and financial ledger. Detailed contract in [POS.md](./POS.md).
- **Page Flow**:
  - In-row trailing empty search (`row-med-input-${idx}`) scans in-memory precomputed inventory.
  - **Loose Sale Enabled (`allow_loose_sale === 1`)**: Sets `qty = 0`, `looseQty = 0`, routes focus directly to `row-loose-input-${targetIndex}`. User enters tablet count, presses Enter -> advances to next medicine row.
  - **Non-Loose Item (`allow_loose_sale === 0`)**: Sets `qty = 1`, `looseQty = 0`, auto-advances to next medicine row.
- **Key Buttons & Controls**:
  - `Direct Cash Sale (F9)`: Commits bill instantly as Cash without modal prompt (peak rush hour).
  - `Save & Print (F10)`: Commits sale and opens thermal/A4 print dialog.
  - `Inline Lock Toggle`: Unlocks full-pack restriction and focuses loose input.
  - `Auto-Refill Toggle`: Auto-schedules next-month refill task in CRM for chronic patients.
  - `Doctor / Patient Selector`: Attaches patient history, credit limits, and prescription doctor.
- **Agent Guardrails**: Never re-enable GPU acceleration, never hardcode non-semantic colors, never set `defaultQty = 1` for loose items.

---

## 2. Inventory — Live Stock & Batch Master
- **Path**: `frontend/src/pages/Inventory/index.tsx` | **Route**: `/inventory`
- **Role**: Canonical viewer and editor of active stock, batches, racks, pack sizes, and selling prices.
- **Page Flow**:
  - Reads directly from `inventory` joined with `medicines`.
  - Feeds compact inventory cache used by POS, CRM, and LiveCart.
- **Key Buttons & Controls**:
  - `Universal Medicine Editor`: 1-click modal to fix brand names, salt compositions, pack sizes, and loose sale permissions.
  - `Switch / Adjust Batch`: Adjusts batch stock with an audit trail note for breakages or count fixes.
  - `Rack / Shelf Locator`: Assigns physical storage locations so cashiers find medicines in seconds.
  - `Low Stock Filter`: Surfaces items below reorder buffer for 1-click push to LiveCart.
- **Agent Guardrails**: Never bypass `invalidateAfterStockWrite`. Every batch quantity edit must be parameterized and audited.

---

## 3. Purchases — Supplier Invoice Entry & AI Scanner
- **Path**: `frontend/src/pages/Purchases/index.tsx` | **Route**: `/purchases`
- **Role**: Ingests distributor purchase invoices (manual entry or AI Camera OCR).
- **Page Flow**:
  - Increments batch quantities in `inventory`, updates supplier credit balances, and registers purchase bills.
  - Directly informs `PurchaseHistory` and distributor reorder prices.
- **Key Buttons & Controls**:
  - `AI Invoice Scan (Camera)`: Uploads paper distributor bills; vision OCR auto-populates batches, expiries, rates, and GST.
  - `Match Master Medicine`: Auto-links invoice items to existing catalog medicines or prompts 1-click creation.
  - `Save Purchase Bill`: Commits inventory batches and creates accounts payable record.
  - `Export / Print Barcodes`: Generates thermal barcode stickers for newly arrived stock.
- **Agent Guardrails**: Multi-salt combination products must never match single-salt records (Rule pointer: `.agents/rules/medicine-image-accuracy.md`).

---

## 4. PurchaseHistory — Supplier Bills & Ledger
- **Path**: `frontend/src/pages/PurchaseHistory/index.tsx` | **Route**: `/purchase-history`
- **Role**: Comprehensive ledger of all historical purchase invoices from distributors.
- **Page Flow**:
  - Feeds supplier return matching (`Returns`) and purchase reports in `Reports`.
- **Key Buttons & Controls**:
  - `View Invoice Details`: Displays itemized breakdown with batch, free quantity, and tax splits.
  - `Supplier Statement Export`: Generates PDF/Excel statement for reconciliation with distributor accounts.
  - `Filter by Distributor / Date`: Instant in-memory date range slicing.
- **Agent Guardrails**: Never mutate committed purchase invoices directly without an audit entry or return voucher.

---

## 5. Sells — Sales Ledger & Credit Management
- **Path**: `frontend/src/pages/Sells/index.tsx` | **Route**: `/sells`
- **Role**: Searchable archive of all retail sales, credit invoices, customer receipts, and payment settlements.
- **Page Flow**:
  - Read-only viewer of POS commits.
  - Powers credit settlement, duplicate invoice printing, and return creation (`CustomerReturn`).
- **Key Buttons & Controls**:
  - `Settle Credit Balance`: Records partial or full payment against unpaid customer credit bills.
  - `Send WhatsApp Statement`: Sends automated payment link, UPI QR, and itemized bill PDF via WhatsApp.
  - `Print Duplicate (A4 / Thermal)`: Re-prints invoice exactly as originally billed.
  - `Initiate Return`: Pre-populates customer return modal with exact sold batches and original rates.
- **Agent Guardrails**: No stored bill dates may use UTC or `'localtime'`; all sales times strictly follow shop local time (`src/utils/localTime.ts`).

---

## 6. Returns — Supplier Purchase Returns
- **Path**: `frontend/src/pages/Returns/index.tsx` | **Route**: `/returns`
- **Role**: Manages debit notes and stock returns to distributors (breakages, near-expiry, slow-moving).
- **Page Flow**:
  - Decrements `inventory`, writes debit note, adjusts distributor ledger.
- **Key Buttons & Controls**:
  - `Generate Debit Note`: Issues official return voucher with GST adjustment.
  - `Distributor Batch Matcher`: Pulls original purchase price so pharmacy never returns stock below invoice cost.
  - `Print Return Gate Pass`: Physical gate pass for delivery pickup.
- **Agent Guardrails**: Stock decrements must be atomic with debit note creation.

---

## 7. CustomerReturn — Retail Returns & Refunds
- **Path**: `frontend/src/pages/CustomerReturn/index.tsx` | **Route**: `/customer-returns`
- **Role**: Handles customer product returns, damaged strips, and bill cancellations.
- **Page Flow**:
  - Validates original invoice in `sales`, restocks valid inventory or writes off damaged units, issues cash refund or store credit.
- **Key Buttons & Controls**:
  - `Search Original Bill`: Enter invoice number to auto-pull batches and verify customer purchased item here.
  - `Restock vs Write-off Toggle`: Restocks unexpired, sealed strips to inventory; routes damaged goods to loss ledger.
  - `Issue Store Credit`: Credits customer's CRM profile for future POS purchases.
- **Agent Guardrails**: Never restock expired or open loose tablets into sellable inventory.

---

## 8. CustomerReturnHistory — Return Audit Log
- **Path**: `frontend/src/pages/CustomerReturnHistory/index.tsx` | **Route**: `/customer-return-history`
- **Role**: Audit center for all historical customer returns and credit notes.
- **Key Buttons & Controls**:
  - `Print Credit Note`: Re-prints customer refund receipt.
  - `Filter by Reason`: Analyzes return reasons (e.g. doctor changed medicine, adverse reaction).

---

## 9. CRM — Patient Wellness, Chronic Refills & Special Orders
- **Path**: `frontend/src/pages/CRM/index.tsx` | **Route**: `/crm`
- **Role**: Single source of truth for patient health records, chronic prescription refills, special orders, and WhatsApp follow-ups.
- **Page Flow**:
  - Refill scheduler triggers automated morning briefings and WhatsApp refill reminders.
  - Out-of-stock special requests route directly into distributor `LiveCart`.
- **Key Buttons & Controls**:
  - `1-Click Refill to POS`: Converts due refill schedule directly into a pre-filled POS bill.
  - `Send WhatsApp Reminder`: Triggers personalized dosage and refill reminder message to patient.
  - `Special Order Intake`: Logs requested out-of-stock medicines; notifies patient via SMS/WhatsApp when PO arrives.
  - `Credit Due Date Adjuster`: Extends patient credit grace period with automated reminder rescheduling.
- **Agent Guardrails**: No autonomous patient messaging from background cron/workers without human verification.

---

## 10. LiveCart — Distributor Smart Reorder Engine
- **Path**: `frontend/src/pages/LiveCart/index.tsx` | **Route**: `/live-cart`
- **Role**: Central purchasing cart aggregating low-stock items, CRM special orders, and fast-moving refills.
- **Page Flow**:
  - Computes multi-distributor best-rate comparisons and dispatches orders to Pharmarack or local distributors.
- **Key Buttons & Controls**:
  - `Best Rate Auto-Assign`: Routes each medicine to the distributor offering the highest margin and lowest scheme rate.
  - `1-Click Pharmarack Push`: Seamlessly pushes selected items to the distributor's online B2B cart.
  - `Generate PO PDF / WhatsApp`: Sends clean PO spreadsheet/PDF to distributors not connected to EDI.
- **Agent Guardrails**: Never show simulated or mockup cart badges (`F7`). Display live distributor data only.

---

## 11. PharmarackCart — B2B Automated Ordering
- **Path**: `frontend/src/pages/PharmarackCart/index.tsx` | **Route**: `/pharmarack-cart`
- **Role**: Dedicated interface for Pharmarack B2B online ordering session management and stock synchronization.
- **Page Flow**:
  - Communicates with authenticated Pharmarack session via REST session heartbeat.
- **Key Buttons & Controls**:
  - `Sync Distributor Schemes`: Pulls live schemes (e.g. 10+1 free, 5% cash discount) into POS pricing.
  - `Submit PO`: Commits official purchase order to distributor warehouse.
- **Agent Guardrails**: Refreshes must use the REST session heartbeat (`tokenRefreshScheduler`). Never spawn periodic headless Chromes.

---

## 12. Reports — Financial, Tax & Analytics Hub
- **Path**: `frontend/src/pages/Reports/index.tsx` | **Route**: `/reports`
- **Role**: Executive analytics engine computing P&L, GST-1/3B tax liability, Day Book, and salt margin rankings.
- **Page Flow**:
  - Aggregates committed rows from `sales`, `purchases`, and `expenses`.
- **Key Buttons & Controls**:
  - `GST-1 & GST-3B Summary`: Formats tax reports ready for CA filing.
  - `Day Book Cash Reconciliation`: Matches physical drawer cash against POS collections and customer credit receipts.
  - `Fast & Slow Moving Analytics`: Pinpoints dead stock tying up pharmacy working capital.
- **Agent Guardrails**: Never compute margins using unverified cost price fallbacks; all reports must reflect actual purchase invoices.

---

## 13. Expiry — Expiry Management & Loss Prevention
- **Path**: `frontend/src/pages/Expiry/index.tsx` | **Route**: `/expiry`
- **Role**: Expiry forecasting and near-expiry stock liquidation.
- **Page Flow**:
  - Scans `inventory` batches across 30/60/90/180-day thresholds.
- **Key Buttons & Controls**:
  - `Near-Expiry Clearance Push`: Flags near-expiry items for prioritized POS substitution or supplier return.
  - `Return to Supplier`: Batches near-expiry items into return debit notes before distributor cutoff dates.
  - `Write-Off Loss Log`: Formally logs unsellable expired drugs with tax-deductible expense records.
- **Agent Guardrails**: Expired stock must be immediately blocked from POS sale selection.

---

## 14. Dispatch — Home Delivery & Field Logistics
- **Path**: `frontend/src/pages/Dispatch/index.tsx` | **Route**: `/dispatch`
- **Role**: Manages delivery boys, home delivery routing, cash-on-delivery (COD) reconciliation, and packing slips.
- **Page Flow**:
  - Receives orders from POS (Phone/Web/WhatsApp), assigns to delivery boys, tracks delivery status.
- **Key Buttons & Controls**:
  - `Assign to Delivery Boy`: Dispatches order with GPS address and customer phone number.
  - `COD Payment Reconcile`: Marks delivery complete and accepts cash collected by delivery agent.
  - `Print Delivery Packing Slip`: Includes patient medication instructions, temperature requirements, and invoice.
- **Agent Guardrails**: Delivery boy data must be queried strictly from `delivery_boys` table via `/dispatch` (guardrail `F10`).

---

## 15. PhoneSales — Quick Phone Order Intake
- **Path**: `frontend/src/pages/PhoneSales/index.tsx` | **Route**: `/phone-sales`
- **Role**: Fast intake for incoming customer phone orders and doctor telephonic requests.
- **Page Flow**:
  - Converts customer voice orders into staged POS bills or Dispatch delivery tickets.
- **Key Buttons & Controls**:
  - `Quick Patient Phone Lookup`: Instantly pulls customer's past medication history upon typing phone number.
  - `1-Click Convert to Delivery`: Routes staged order directly into Dispatch delivery queue.

---

## 16. WebsiteOrders — Online Pharmacy Storefront Orders
- **Path**: `frontend/src/pages/WebsiteOrders/index.tsx` | **Route**: `/website-orders`
- **Role**: Inbound queue for orders placed via customer mobile web portal or store website.
- **Page Flow**:
  - Verifies uploaded prescription images, matches items to local inventory batches, and pushes to POS/Dispatch.
- **Key Buttons & Controls**:
  - `Inspect Prescription Image`: High-res viewer to verify doctor signature and validity.
  - `Accept & Allocate Batches`: Commits local FEFO batches to the online order.
  - `Reject with WhatsApp Notice`: Informs customer of missing doctor prescription or unavailable drug.

---

## 17. OnlineCatalog — Master Universal Drug Catalog
- **Path**: `frontend/src/pages/OnlineCatalog/index.tsx` | **Route**: `/online-catalog`
- **Role**: Comprehensive 100,000+ Indian pharmaceutical master catalog containing salts, strengths, manufacturers, and forms.
- **Page Flow**:
  - Enriches local inventory with API references, Schedule types (H/H1/X), and therapeutic alternatives.
- **Key Buttons & Controls**:
  - `Universal Composition Search`: Finds chemical salt substitutes when a prescribed brand is out of stock.
  - `Auto-Enrich Record`: Pulls missing HSN codes, GST rates, and manufacturer details into local database.

---

## 18. CatalogUpload — Bulk Ingestion & CSV Import
- **Path**: `frontend/src/pages/CatalogUpload/index.tsx` | **Route**: `/catalog-upload`
- **Role**: Bulk importer for distributor price lists, wholesaler CSVs, and master catalog updates.
- **Key Buttons & Controls**:
  - `Upload CSV / XLSX`: Column-mapping tool supporting custom distributor formats.
  - `Validate & Preview`: Flags missing MRPs, unmapped salts, and syntax errors before database write.

---

## 19. Dashboard — Morning Briefing & Real-Time Pulse
- **Path**: `frontend/src/pages/Dashboard/index.tsx` | **Route**: `/dashboard`
- **Role**: Central executive cockpit providing daily revenue, refill follow-ups, low stock alerts, and distributor updates.
- **Page Flow**:
  - Aggregates daily KPIs across POS, CRM, and Inventory without blocking the event loop.
- **Key Buttons & Controls**:
  - `Morning Briefing Action List`: Surfaces high-priority actions (calls to make, POs to confirm, deliveries to dispatch).
  - `Reorder Hub Quick-Add`: 1-click addition of critically low items into LiveCart.

---

## 20. Settings — Pharmacy Configuration & Hardware Profiles
- **Path**: `frontend/src/pages/Settings/index.tsx` | **Route**: `/settings`
- **Role**: Global system configuration: store name, DL numbers, GSTIN, printer margins, WhatsApp gateway, and user accounts.
- **Key Buttons & Controls**:
  - `Printer Profile Setup`: Toggles 3-inch thermal printer (ESC/POS) vs A4 invoice format.
  - `WhatsApp QR Connect`: Pairs store WhatsApp Web session with idle-sleep power savings.
  - `Store Tax & DL Details`: Updates legally required drug license numbers printed on invoices.

---

## 21. AuditCenter — Physical Stock Reconciliation
- **Path**: `frontend/src/pages/AuditCenter/index.tsx` | **Route**: `/audit-center`
- **Role**: Routine physical inventory audits by rack, shelf, or category without shutting down sales.
- **Key Buttons & Controls**:
  - `Start Rack Audit`: Loads expected inventory count for shelf A1; staff scans physical boxes.
  - `Apply Reconciliation Adjustments`: Commits discrepancy adjustments with reason codes and loss value calculation.

---

## 22. Database — Health, Backup & Schema Integrity
- **Path**: `frontend/src/pages/Database/index.tsx` | **Route**: `/database`
- **Role**: Database health monitor, automated vacuum, schema verification, and encrypted local backup manager.
- **Key Buttons & Controls**:
  - `Create Instant Encrypted Backup`: Creates point-in-time SQLite copy with timestamp.
  - `Schema Integrity Check`: Validates all tables, foreign keys, and indexes match `BACKEND SCHEMA SAFETY.md`.

---

## 23. Migration — Legacy Software Import
- **Path**: `frontend/src/pages/Migration/index.tsx` | **Route**: `/migration`
- **Role**: One-time importer migrating legacy pharmacy databases (Marg, Busy, Tally, Mediman) into AI Pharmacy.

---

## 24. AIEngineering — Model Training & OCR Intelligence
- **Path**: `frontend/src/pages/AIEngineering/index.tsx` | **Route**: `/ai-engineering`
- **Role**: Vision OCR feedback loop, handwritten prescription learning, and drug composition matching intelligence.

---

## Universal Developer Guardrails (Across ALL Pages)

1. **Light / Dark Mode Invariant (`F6`)**: Never use raw Tailwind tokens (`bg-black/20`, `bg-[#18181b]`, `text-white` on surfaces). Always use semantic variables: `bg-bg`, `bg-bg2`, `bg-bg3`, `text-text`, `text-muted`, `border-border`.
2. **Event-Driven UI (`F1`/`F5`)**: Use Server-Sent Events (SSE) for real-time updates. Never poll with raw `setInterval` or eager refetch storms.
3. **No GPU Requirement (`E1`)**: Electron runs strictly on CPU SwiftShader (`electron/main.ts`). Keep CSS animations minimal; never add GPU-forcing command-line flags.
4. **Backend Schema Rule**: Every schema change must exist across both the full DDL migration block AND the fast-boot path in `ensureSchema` (`src/database.ts`).
5. **Auto-Update Knowledge Graph**: Every file edit must conclude with `node scripts/quick-update.mjs` and `npm run guardrails`.
