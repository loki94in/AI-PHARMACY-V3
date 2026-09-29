# Shop Data-Flow Tree — agent entry (first slice)

This is the connection tree for the shop loop. Read it before adding a feature or fixing a bug that touches purchases, inventory, POS, sells, CRM, Quick Assist, or reports.

The tree is the enforcement. A new screen, endpoint, or table is allowed only when no node below already does that job. If a node exists, extend that node. The same rows must stay visible on every page that already reads them.

Page-to-API catalog: `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md`. This file says which way data is allowed to move.

---

## 1. Saved truth only

Every name, phone, batch, quantity, rate, and MRP on these pages is a value a person saved through the writer below.

- A missing value stays missing until the user types it or a saved bill already contains it.
- Do not invent a customer, a medicine name, a batch, a stock row, a rate, an MRP, a phone, or a report total so a screen can render.
- Do not copy the master catalog into inventory. A catalog name is not stock.
- Do not fill a purchase line, a POS line, or a CRM card from a guessed inventory scan when the fact lives on a saved bill or a saved patient record.

---

## 2. Pipeline agents follow

Before editing:

1. Name the journey: purchase, stock, sale, patient, or report.
2. Open the matching node in this file. Use its writer, table, and API.
3. List every reader of that node (the “Also shows on” line).
4. If the behavior already exists on that node, change that node. Do not add a second page, a second table, or a second client cache for the same fact.
5. After the change, the readers must still show the same saved rows. Say which readers were checked.

---

## 3. Stores — one writer each

| Node | What it holds | Writer (the only place new agent work may insert) | Table | API |
|---|---|---|---|---|
| Master name | Medicine name the user registered | Universal medicine editor on the purchase flow | `medicines` | `POST /api/medicines` |
| Purchase bill | Distributor invoice the user confirmed | Purchases → verification modal Confirm | `purchases`, `purchase_items` | purchase save after `PurchaseSaveVerificationModal` |
| Shelf stock | Batch, expiry, qty, cost, MRP from that confirmed bill, or an explicit stock adjustment the user performed on Inventory or Investigation | Purchase confirm (creates the batch). Inventory or Investigation adjustment edits a batch that already exists | `inventory_master` | purchase save; Investigation `PUT /api/investigation/inventory/:id` |
| Sale | Counter bill | POS save | `sales_invoices`, `sale_items` | `POST /api/sales` |
| Patient | Name and phone captured on a sale, or edited on the patient the sale already created | POS save creates the person from the name and phone on the bill. CRM edits that person | `customers` | sale save; `GET/POST /api/customers` |
| Special order | Shortage request for a patient | CRM special-orders tab | `special_orders` | `GET/POST/PUT/DELETE /api/orders` |
| Refill | Repeat medicine for a patient | CRM refills tab | `patient_refills` | `GET/POST/PUT /api/refills` |

Mail and OCR may stage a bill for review. They become a purchase only after the user confirms the verification modal. They do not create shelf stock by themselves.

Historical importers (migration, portal, cloud sync) already write some of these tables. New shop-loop work does not add another insert path beside the writer column.

---

## 4. Stock columns — POS sale and Investigation

One shelf row is `inventory_master.id`. The numbers that move are `quantity` (strips) and `loose_quantity`.

| Event | Writes | Investigation reads |
|---|---|---|
| Confirmed purchase | `inventory_master.quantity` increases by `purchase_items.quantity + free_qty`. `stock_ledger.quantity` is that same positive total | Purchase line. Closing stock adds billed quantity and free quantity |
| POS sale | `sale_items.inventory_id`, `sale_items.quantity`, `sale_items.loose_qty`. Shelf drops through the strip/loose pool (`applyStockDelta`). `stock_ledger` stores the negative sale | Sale line joined on `sale_items.inventory_id`. Closing stock uses that same pool, so a loose sale that opens a strip matches the shelf |
| Customer return of a sale | `inventory_master.quantity` back up. `return_items.quantity` with `returns.type = 'sale'` | Return line. Closing stock adds those strips back |
| Investigation +/− | `PUT /api/investigation/inventory/:id` sets `quantity` and `loose_quantity` to the numbers the user typed, and appends `stock_ledger` (`transaction_type = investigation_adjustment`) for the difference | Adjustment row from `action_logs` metadata `quantity` / `looseQuantity`. Closing stock becomes those saved numbers |

A sale bill edit on Investigation changes `sale_items` and the same shelf columns. It does not create a second stock table.

---

## 5. Journey

```text
Mail / OCR attachment
    → Purchases (each line linked to a master medicine the user confirmed)
    → PurchaseSaveVerificationModal Confirm
    → purchase bill row
    → inventory batch for that bill
    → Inventory shows that batch
    → POS sells from that batch
    → sale invoice + patient name/phone
    → Sells shows the invoice
    → CRM shows that patient and their bills
    → Reports and Dashboard read those same invoices and purchase bills
```

Direction rules:

- Purchase History shows the saved purchase bill. It does not own stock.
- Inventory shows shelf batches. It does not own the patient.
- POS sells a batch and records the patient on the bill. It does not manage the special-order list.
- CRM shows the patient, their refills, and their special orders. It does not write the sale invoice.
- A sale starts on POS. CRM and Quick Assist only hand the saved patient and lines across.

---

## 6. Patient truth — CRM writes, Quick Assist shows the same rows

CRM (`/crm`) is where the user manages patient details.

| CRM tab | Route | Store | API both sides use |
|---|---|---|---|
| Patients | `/crm` | `customers` plus that person’s `sales_invoices` | `GET /api/customers` |
| Special orders | `/crm?tab=special_orders` | `special_orders` | `api.getOrders()` → `GET /api/orders` |
| Refills | `/crm?tab=refills` | `patient_refills` | `api.getRefills()` → `GET /api/refills` |

`/refills` redirects to `/crm?tab=refills`. Do not rebuild a standalone refills page.

Quick Assist (`QuickAssistSidebar` in `frontend/src/components/Layout.tsx`) is a mirror, not a second file:

- Special orders: the same `api.getOrders()` query key `orders`.
- Refills: the same `api.getRefills()` query key `refills`.
- Status changes call the same `/api/orders/:id/status` and `/api/refills/...` routes CRM uses.
- After a CRM save, Quick Assist must show that row. After a Quick Assist status change, the CRM tab must show that status.
- Do not give Quick Assist its own table, its own patient list, or a private copy of refills.

`pending_shortage_requests` is not a patient store. Do not point new code at it.

---

## 7. Handoff into POS

CRM **Sell Now** and Quick Assist **Complete** open `/pos` with the same `location.state.prefill`:

```text
patientName
patientPhone
specialOrderId
advancePayment
medicines[]  → { medicineName, quantity_needed }
```

POS hydrates the cart from that object. The invoice is written only by POS save. CRM must not grow a second checkout.

---

## 8. Shared readers

These pages do not own the numbers. They read the stores in section 3.

| Reader | Reads |
|---|---|
| Inventory | `inventory_master` joined to `medicines` |
| Purchase History | `purchases`, `purchase_items` |
| Sells | `sales_invoices`, `sale_items` |
| CRM patients | `customers`, `sales_invoices` |
| Quick Assist | `special_orders`, `patient_refills` (same APIs as CRM) |
| Reports | `sales_invoices`, `purchases` (and stock only where a report is explicitly a stock report) |
| Dashboard | saved sales, purchases, and expiry rows already in those tables |

A report that needs “what this patient bought” reads that patient’s sale invoices. A report that needs “what the shop bought” reads purchase bills. A report that needs “what is on the shelf” reads inventory batches. It does not merge those three into a new collection table.

---

## 9. Moves this tree stops

- Collecting every inventory row to answer a question whose answer is on one purchase bill or one sale.
- Building a new CRM, a new orders page, or a new refill list beside `/crm`.
- Letting Quick Assist store patients somewhere CRM cannot see.
- Selling from CRM instead of handing `prefill` to POS.
- Creating stock from a catalog import, an OCR scan, or a search result.
- Substituting a placeholder name, phone, batch, or amount when the saved row is empty.

---

## 10. When the slice grows

A later feature joins this file as a new node: writer, table, API, and every existing reader. It does not start a parallel tree.
