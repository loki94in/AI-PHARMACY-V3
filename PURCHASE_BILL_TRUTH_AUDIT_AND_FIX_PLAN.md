# Purchase Bill Is the Only Truth — Fallback Audit and Fix Plan

> **Date:** 2026-09-30 · **Status:** Audit done. Fixes not started (see Section 6).
> **Governs:** `AGENT_DATA_FLOW_TREE.md` Section 1 ("Saved truth only") and the root `AGENTS.md`
> "Strict Legitimate Data" contract. Bug register entries: `SMALL_BUG_FIX_PLAN.md` P0-74 … P2-80 and P2-68.

---

## 1. The rule

The distributor's purchase bill, once the pharmacist confirms it, is the only source of these facts:
batch, expiry, quantity, free quantity, rate (cost), MRP, GST %, HSN. The medicine's pack size is
entered once in the medicine details.

- A sale sells a real batch from a confirmed purchase and copies that batch's facts onto the bill.
- Stock moves only by a purchase, a sale, a return, or an adjustment the pharmacist types.
- Reports add up saved bills and real batches.
- When a fact is missing, the app **stops and says so in plain words**. It never guesses, never
  borrows a value from somewhere else, and never writes `0`, `1`, `10`, `5%`, "today" or a placeholder
  name in its place.

The audit below lists every place the app does not follow that rule today.

---

## 2. What was found, in plain words (most harmful first)

| # | What happens today | Where it shows |
|---|---|---|
| 1 | **Typing a price in the POS cart changes the purchase bill.** Every keystroke in the cart's MRP box saves that number to the batch, and to every purchase-bill line with that batch number. Typing `125` saves `1`, then `12`, then `125`; clearing the box saves `0`. The cost and pack-size boxes also save to the database. | Purchase History, Inventory, next sales, all reports |
| 2 | **GST on every POS sale is assumed to be 5%.** POS never sends the GST rate. The medicine list has 0% GST for every medicine on the shelf, and the calculator treats 0% as "unknown" and uses 2.5% + 2.5%. The purchase bills hold the real rate: 12% (45% of lines), 18% (23%), 5% (19%), 0% (13%). The saved line also records its GST % as 0, so the line contradicts itself. | Sale bill GST split, GSTR-1, GST reports |
| 3 | **The purchase screen fills in values the pharmacist did not type.** A new line starts at 6% + 6% GST. A missing invoice number becomes `INV-######`. The bill date starts as today. Rate 0, a blank batch and a blank expiry are accepted. A mismatch between the typed total and the computed total goes into the credit-note amount. An uploaded bill with no MRP/rate borrows them from the catalog. | Purchase bill → batch → every sale of it |
| 4 | **Expiry is changed while it is read.** Month 13 becomes 12, month 00 becomes 01, and a full date like `31/03/2027` is saved as `12/03` (December 2003). | Inventory, POS (batch looks expired), Expiry page |
| 5 | **Saving a purchase bill can create duplicate medicines.** After the save, a background step registers the bill's own spelling as a new medicine whenever the line was linked by alias or fuzzy match. The supplier-return screen also creates a medicine (MRP 0) for any name it does not know. | Medicine search, POS, Purchases dropdowns |
| 6 | **Medicines are linked by guess.** A fuzzy match of 60% on upload, or 72% on save, links a bill line to a medicine and shows it green "Ready". Stock lands on that medicine. | Inventory (stock on the wrong medicine) |
| 7 | **Pack size is guessed differently in each place:** 1 (POS, sales, purchase edit), 10 (returns, stock rebuild, the medicine editor for tablets), or a number parsed from text (`10x10` → 100). 3,112 of 5,739 shelf batches have no pack size. Most are bottles and tubes, but 27 are tablets or capsules. A loose sale of those is priced and deducted as whole strips. | Loose-sale price, stock count |
| 8 | **A batch with no expiry is sellable.** A missing or unreadable expiry counts as "not expired". | POS, stock |
| 9 | **Side doors skip every check.** Email "reissue", phone-sale approval, Telegram sales and the old invoice service save bills with flat 5% tax, cost 0, quantity 1, "Cash / Paid", the first batch found by name, or no stock deduction. | Sale bill, stock, GST |
| 10 | **Reports show guesses as real numbers.** A sale whose batch has no cost counts as 100% profit. "Total Paid" on Purchase History is just the purchase total (the app has no payment record). An empty date range falls back to the all-time total. Missing cost prints `₹0.00`. Expiry reports cannot read `MM/YY` expiries, which the purchase screen saves. Revenue ignores loose units and discounts. The GSTR-1 "taxable" figure includes the tax. | Reports, Purchase History, Expiry, monthly owner report |

---

## 3. Effect on each part of the app

### Sale bill (POS, Sells, printed bill, WhatsApp bill)
- **GST split is wrong on most sales** (#2). The bill total is right because prices include tax, but
  the CGST/SGST saved on the bill, and so the GST filed, is not. Example: a ₹112 sale of a 12% item
  should be ₹100 taxable + ₹12 GST. The app saves ₹106.67 + ₹5.33. For an 18% item, ₹118 saves GST
  ₹5.62 instead of ₹18. For a 0% item, ₹100 saves GST ₹4.76 instead of ₹0.
- **MRP on the bill comes from the screen**, not the batch (`sales.ts:441`). With #1 it can be a
  half-typed number.
- **Placeholders are saved:** patient "Customer" / "Walk-in Customer" (and a customer record with
  that name), medicine "Medicine" / "Unknown Medicine", shop "AI Pharmacy", payment "Cash / Paid" when
  none was chosen.
- **Loose price uses pack size 1** when it is unknown, so one tablet costs a strip (#7).
- **Editing an old bill in POS changes its total.** The saved ₹ discount reloads into the % box
  (`POS:1206`), and an advance payment is added to the % box (`POS:1457`).
- **Back-dated bills on the 29th–31st get the wrong date** (month overflow, `POS:3663-3671`).
- **The printed PDF** stamps "PAID & VERIFIED" on pending bills, labels "Tax (5%)", and drops lines
  whose batch was deleted.

### Inventory (shelf stock)
- **Batch MRP and cost are overwritten from POS, Inventory and the medicine editor** (#1). Blank
  boxes save `0`.
- **Stock on the wrong medicine** from fuzzy links (#6). **Wrong strip/loose split** from pack-size
  guesses (#7).
- **Stock moves with no ledger row:** email reissue, staged approve, inventory override/sync, quick
  edit, and expiry write-off. The ledger and the shelf drift apart, and Investigation cannot explain
  the difference.
- **Negative stock is clamped to 0** on supplier-return paths while the ledger records the full
  amount.
- **AI Camera creates an empty batch** with no purchase (`aiCamera.ts:78`).

### Purchase bill (Purchases, Purchase History, Investigation)
- **Values the pharmacist never typed are saved:** GST 6%+6%, invoice number `INV-…`, date = today,
  rate 0, blank batch, blank expiry, credit-note amount (#3).
- **Expiry changed on save** (#4).
- **Old bills are rewritten** by edits in POS or Inventory (#1): `UPDATE purchase_items … WHERE
  medicine_id = ? AND batch_no = ?` changes every bill that carried that batch.
- **Email reissue saves GST 0** on every line and a total of qty × rate only.
- **Invoice number made up** from the P-number, file name or mail subject on mail/OCR paths.

### Reports, GST, Dashboard, Expiry, owner summaries
- **Profit:** a missing cost counts as 0 (Reports cards, monthly WhatsApp/PDF/Excel report).
  Revenue counts strips only, without loose units or discounts.
- **GST:** GSTR-1 and the HSN summary read the assumed 5% split from #2. The HSN summary also assumes
  5% when the medicine has no rate. The GSTR-1 taxable figure is `subtotal - discount`, which still
  includes the tax.
- **Stock value / value at risk:** batches with no cost are left out silently. There is no "N batches
  have no cost" note.
- **Expiry:** the Reports expiry queries use `date(expiry_date)`, which cannot read `MM/YY`. New
  purchases are saved as `MM/YY` (the migrated batches are `YYYY-MM-DD`), so new batches will never
  show as expiring. The Expiry page and export read `05/27` as 27 May **2001**. The shadow column
  `expiry_month` (a trigger fills it for both formats) already exists and is the right thing to read.
- **Purchase History cards:** "Total Paid" is made up. A date range with no bills shows the
  all-time total.
- **Non-moving report:** "never moved" shows as 0 days, so that card is always 0.
- **Investigation timeline:** when a batch row is gone, the inventory id is used as a medicine id,
  and the sale lands on an unrelated medicine's running stock.

---

## 4. What the shop's data shows (read-only copy, 27 Sep 2026)

| Check | Result |
|---|---|
| Sellable batches | 5,739 |
| … with no batch / no expiry / no MRP / no cost | 0 / 0 / 0 / 0 |
| … whose medicine has GST 0% in the medicine list | **5,739 (all)** |
| … whose medicine has no pack size | **3,112** (27 are tablets/capsules; 36 hold loose stock) |
| Purchase lines by GST | 12%: 28,585 · 18%: 14,408 · 5%: 11,892 · 0%: 8,558 |
| Purchase lines with no expiry saved on the line | 63,443 (all; migrated expiry lives on the batch) |
| Sale lines with no batch link | 0 |
| POS sales / app purchases made after migration | 0 / 0 |

The copy shows that the migrated history is clean where it matters: every shelf batch has its batch,
expiry, MRP and cost. It also shows that **no POS sale had been saved yet** in that copy. So the
wrong GST split and the POS-cart price write-back had not yet damaged saved bills there. Fixing
them now keeps the new data clean from day one.

---

## 5. What the pharmacist will see after the fix

Every refusal names the medicine, the batch and the one thing to do. Examples:

- **POS, missing expiry:** "Cannot sell PAN 40 (batch B2231): its expiry date is missing. Open
  Inventory, enter the expiry from the purchase bill, then add it again."
- **POS, loose sale with unknown pack size:** "Cannot sell loose tablets of GLYCOMET SR 500: the
  number of tablets per strip is not saved. Enter the pack size in the medicine details, or sell
  whole strips."
- **POS, GST not on the purchase bill:** "Cannot bill DOLO 650 (batch DT0921): its purchase bill has
  no GST %. Open that bill in Purchase History and enter the GST."
- **Purchases, blank batch:** "Line 3 (AZEE 500) has no batch number. Type the batch from the
  distributor's bill."
- **Purchases, bad expiry:** "Line 5 expiry '13/27' is not a real month. Type it as MM/YY, for
  example 03/27."
- **Purchases, no invoice number / date:** "Enter the distributor's invoice number and bill date
  before saving."
- **POS cart price box:** the MRP shows the batch's MRP and cannot be changed there. A lower selling
  price is typed in the price box and stays on this bill only.

The screens keep the pharmacist's typing. Nothing is lost on a refusal. The whole save is rolled
back and the message says what to fix.

---

## 6. Fix plan (in order; each phase is one reviewable change with tests)

| Phase | Priority | What changes | Register |
|---|---|---|---|
| **1. Stop other screens rewriting the purchase bill** | P0 | POS cart MRP/cost/pack boxes stop calling `api.updateMedicine`: they edit this bill only, and MRP is read-only (the batch's). `PUT /inventory/:id` stops rewriting `purchase_items`, and blank MRP/cost is refused instead of saved as 0. | P0-74 |
| **2. Sale bill copies the batch's purchase facts** | P1 | GST % from the purchase line of that batch (`purchase_items` medicine + batch, newest); a real 0% stays 0%. MRP snapshot from `inventory_master.mrp`. Pack size from `medicines` only, and a loose sale is refused when it is unknown. Missing expiry is refused. No "Medicine"/"Customer"/"AI Pharmacy" placeholders are saved (NULL, and no customer record without a name or phone). No batch picked by name. Same rules in `saleBillEditService`, customer returns (refund from the saved sale line) and the POS save check. Fix the POS discount reload and date overflow. | P2-68 (raised to P1), P1-75 |
| **3. Purchase save refuses missing values** | P1 | Required per line: linked medicine, batch, valid expiry (bad month refused, never clamped), qty, rate, MRP, GST % typed or read from the bill. Required per bill: invoice number, bill date, distributor. Remove the 6%+6% start value, `generateInvoiceNo()`, date = today on unreadable mail, the credit-note plug and catalog MRP/rate borrowing. Fuzzy links show as "Please confirm", never green "Ready". Stop the after-save medicine creation (update only the linked id). | P1-76, P1-77 |
| **4. Close the side doors** | P1 | Email reissue and staged approve go through the same line rules and write `stock_ledger`. Phone-sale approve goes through the POS save rules. Remove or refuse the Telegram sale path and the dead `invoiceService.createInvoice`. Supplier return never creates a medicine. AI Camera never creates a batch. | P1-78 |
| **5. One pack-size rule** | P2 | Unknown pack size = loose operations refused everywhere (sale, return, rebuild, edit). Remove the `1` and `10` defaults and the `\|\| 10` in the medicine editor. Text parsing is shown as a suggestion the pharmacist accepts, never saved silently. | P2-79 |
| **6. Reports say "missing" instead of guessing** | P2 | Profit counts only lines with a real cost and shows "N lines have no cost". Revenue includes loose units and discounts. GSTR-1 taxable = saved line taxable. Expiry reports read `expiry_month`. The Expiry page parses `MM/YY` correctly. Remove the "Total Paid" card. No all-time fallback for an empty range. "Never moved" shows as never. | P2-80 |

Each phase ends with: guardrails, `tsc`, a jest test per refusal, a check that every reader
(Inventory, POS, Sells, Purchase History, Reports, Investigation) still shows the same saved rows,
the `AGENT_DATA_FLOW_TREE.md` / `src/AGENTS.md` update, and `node scripts/quick-update.mjs`.

### Owner decisions needed before Phase 2
1. **GST source.** Proposed: a sale takes GST % from the purchase line of the same batch, and a 0% on
   the purchase bill is treated as a real 0% (exempt), not "missing". If a batch has no purchase line
   with a GST %, the sale is refused with the message in Section 5.
2. **Walk-in sale with no name.** Proposed: allowed. The bill saves an empty name (the screen may still
   *display* "Walk-in"), and no customer record is created. The alternative is to require a name on
   every bill.
3. **Selling price below MRP.** Proposed: allowed per bill (price box), never above the batch MRP, and
   never saved back to the batch or the purchase bill.

---

## 7. Full findings list (technical)

Paths are relative to the repository root. `POS` = `frontend/src/pages/POS/index.tsx`, `PUR` =
`frontend/src/pages/Purchases/index.tsx`, `UME` = `frontend/src/components/UniversalMedicineEditModal.tsx`.
Severity: **H** = stored, or changes money/stock. **M** = shown as real but not stored.

### 7.1 Sale path
| Location | What is invented | Sev |
|---|---|---|
| `src/utils/saleTotals.ts:61-67` | 2.5% + 2.5% when the line has no rate or 0%. GST read from `medicines`, never `purchase_items` | H |
| `POS:3628-3649` | Payload has no GST; `mrp: item.mrp \|\| resolvedUnitPrice`; `unit_price` falls back to MRP; `pack_size \|\| 1`; name `'Medicine'` | H |
| `POS:3260-3268`, `POS:6029` | MRP/cost/pack cart edits call `api.updateMedicine` → `PUT /inventory/:id` on every keystroke | H |
| `src/routes/inventory.ts:346-358` | Inventory PUT rewrites `purchase_items` batch/expiry/MRP on every bill with that batch | H |
| `src/routes/sales.ts:441-442` | MRP snapshot from client or 0 (`currentStock` has no `im.mrp`); GST % snapshot from client or 0 | H |
| `src/routes/sales.ts:438-440` | `'Medicine'`, batch/expiry from client or `''` | H |
| `src/routes/sales.ts:178, 205-207, 255` | Patient `'Customer'` saved and a `customers` row created | H |
| `src/routes/sales.ts:251` | `pharmacy_name_snapshot` `'AI Pharmacy'` | H |
| `src/routes/sales.ts:136` | Payment `'CASH'`/`'PAID'` when not sent | H |
| `src/routes/sales.ts:353, 362, 930, 2453, 2563, 2753`; `saleBillEditService.ts:117, 122` | `COALESCE(m.pack_size, 1)` in stock math | H |
| `src/routes/sales.ts:388-408` | Batch picked by name / earliest expiry (currently blocked by `verificationService`) | H |
| `src/utils/inventoryActive.ts:11, 23` | Missing/unreadable expiry = not expired | H |
| `src/routes/sales.ts:2067-2085, 2725-2767` | Staged sale: first batch by name, price 0, pack 1, qty 1, flat 5% tax, no stock/expiry check | H |
| `src/routes/sales.ts:2645` | Phone sale with no date gets the sync time | H |
| `src/routes/sales.ts:2462, 2572-2581` | Delete skips lines whose batch is gone; held-bill delete swallows bad cart JSON | H |
| `saleBillEditService.ts:199` | GST % snapshot from master (0) while values use 2.5 + 2.5 | H |
| `src/routes/customerReturns.ts:104-111, 173` | Refund from client price; 2.5 + 2.5 GST; pack 10 | H |
| `src/routes/telegramPrescription.ts`, `services/telegramPrescriptionService.ts` | Flat 5%, price 0, any batch, auto customer, strips-only deduction (path likely broken) | H |
| `src/services/invoiceService.ts` | Pack 1, 5% tax, "Walk-in", any batch (no callers) | H |
| `src/database.ts:3943-3972` | Boot "healing" recomputes sale subtotals with pack 10 and sets NULL discount to 0 | H |
| `src/routes/sales.ts:506, 558-573` | Refill/fulfilment rows with "Walk-in Customer", "Prescribed Medicine", qty 1 | H |
| `POS:973, 5654-5680, 829-833` | Spill-over batches billed at the first batch's price; batch switch keeps old price; inventory id compared to medicine id | H |
| `POS:1206, 1407, 1457` | Saved ₹ discount reloads as %; advance added to % | H |
| `POS:1526-1547`; `frontend/src/pages/Inventory/index.tsx:194-236` | Patient/doctor/qty copied from the last sale of the medicine to any customer | H |
| `POS:1354, 1582, 2395` | First name-search hit picked as the batch, no stock loaded | H |
| `POS:3663-3671` | Date month overflow on the 29th–31st; time replaced | H |
| `POS:3956-3961`; `frontend/src/pages/PhoneSales/index.tsx:164-190` | Fake ids `1000+idx`, qty 1, 'Unknown', blanks sent as 0 | H |
| `frontend/src/pages/Sells/index.tsx:465, 1287` | Loose-only line gets +1 strip on repeat; blank price saved as ₹0 | H |
| `src/services/pdfInvoiceService.ts:41, 91, 158-187, 249` | Pack 1, `'PAID'`, `/1.05`, "Tax (5%)", "PAID & VERIFIED", lines dropped by INNER JOIN | M |
| `src/routes/sales.ts:1498…1917, 2259-2268, 1325-1327` | POS search / reprint MRP from master or 0 | M |

### 7.2 Purchase and inventory path
| Location | What is invented | Sev |
|---|---|---|
| `src/routes/purchases.ts:70-106`; `frontend/src/utils/date.ts:121-125` | Expiry month clamped to 1–12; `31/03/2027` → `12/03` | H |
| `src/routes/purchases.ts:1097, 1557` | Blank batch saved | H |
| `src/routes/purchases.ts:1183, 1648, 3370, 3829`; `investigation.ts:1127` | Missing expiry saved as NULL without refusal | H |
| `src/routes/purchases.ts:1104-1105, 1563-1564, 3834-3835`; `investigation.ts:1128-1129` | Missing GST saved as 0 | H |
| `src/routes/purchases.ts:3373-3395` | Reissue: GST 0, cost/MRP `\|\| 0`, no ledger, NULL batch never matches | H |
| `src/routes/purchases.ts:3713-3717, 3832-3859` | Staged approve stores parser guesses; no ledger | H |
| `src/routes/purchases.ts:1103, 1221-1223` | Sell price = MRP, overwrites the medicine's sell price | H |
| `src/routes/purchases.ts:1127-1135, 1294` → `services/masterMedicinesSeedService.ts:703-717` | After-save medicine creation with the bill's spelling | H |
| `services/medicineService.ts:575-623` (used at `purchases.ts:1139, 1532, 3345, 3795`) | Fuzzy/prefix/catalog link on save; alias saved | H |
| `src/routes/purchases.ts:3305`; `services/emailService.ts:3056, 1587-1598` | Invoice number from P-number, file name, or subject | H |
| `purchaseBillEditService.ts:84, 93, 117, 121` | New batch cost/MRP 0; pack 1 | H |
| `src/utils/stockRebuild.ts:28, 58`; `returns.ts:627, 996, 1206, 1302, 1461, 1531` | Pack 10 | H |
| `src/routes/returns.ts:505` | Medicine created (MRP 0) outside the transaction | H |
| `src/routes/returns.ts:640-641, 1309-1310, 1538-1539` | Negative stock clamped to 0 | H |
| `src/routes/returns.ts:578, 618, 1056`; `returnsService.ts:106, 143`; `expiry.ts:335` | Cost/MRP `\|\| 0` in return and credit-note totals | H |
| `src/routes/investigation.ts:885-898, 1112-1136` | Unsent fields become NULL; cost/MRP default 0; HSN dropped | H |
| `src/routes/inventory.ts:513-518, 982-984`; `medicines.ts:261-287, 904-944` | Blank MRP/rate/GST saved as 0; sell price = MRP; medicine edit overwrites batch cost/MRP | H |
| `medicines.ts:259, 887`; `inventory.ts:965`; `utils/packaging.ts:16-18` | Pack size parsed from text and saved | H |
| `src/routes/aiCamera.ts:78-82` | Batch row created with no purchase | H |
| `services/medicineSalesMetricsService.ts:74, 88`; `stockRebuild.ts:87` | Last-purchase date = save time, not bill date | H |
| `PUR:1447-1448, 2043-2044`; `PUR:4690-4691`; `UME:485-487, 639-641` | GST starts at 6% + 6% (or 12%), overwrites typed GST | H |
| `PUR:2521-2524, 2908-2910, 2962` | `INV-######` / `CN-<inv>` generated | H |
| `PUR:736, 1260, 1315, 2103` | Bill date = today, also for unreadable mail dates | H |
| `PUR:2184-2186` | Credit-note amount = computed total − bill total | H |
| `PUR:2680-2688, 2852-2887` | Rate 0, blank batch/expiry; MRP/rate from master/catalog on upload | H |
| `PUR:2279-2323, 2119-2127` | 60% fuzzy medicine link shown "Ready"; distributor by partial name | H |
| `UME:195, 228, 466, 834-839` | Pack 10 for tablets; MRP/rate 0; sell price = MRP | H |
| `frontend/src/pages/Returns/index.tsx:873-881, 971-988, 1205, 1283` | Inventory id as medicine id; qty 1; claim at MRP; cost 0; invoice 'N/A' | H |
| `frontend/src/pages/Inventory/index.tsx:483, 507, 1111` | Blank MRP saved 0; loose sale on by default; success toast for dropped edits | H |
| `frontend/src/pages/Investigation/index.tsx:509-673, 1288-1297` | Blank MRP/cost 0; pack 1; empty GST re-saved as 0 | H |
| `services/invoiceVisionService.ts:237-338`; `emailService.ts:741-1058, 2926-2956`; `telegramBot.ts:432-456` | Parsers: MRP = rate×1.2 or = rate, GST 6+6, qty = amount/rate, cost = smallest number | M |

### 7.3 Reports and readers
| Location | What is invented | Sev |
|---|---|---|
| `src/routes/reports.ts:86-98`; `services/monthlyReportService.ts:143-153` | Missing cost = 0 in profit; revenue without loose/discount | H |
| `src/routes/reports.ts:729-751, 787-806` | GSTR-1 taxable includes tax; HSN summary assumes 5% | H |
| `src/routes/reports.ts:143, 168, 178` | Batches without cost dropped silently from stock value | H |
| `services/nonMovingReportService.ts:138-161`; `reports.ts:344-347, 427-430, 509-512` | Cost/MRP 0; "never moved" = 0 days; exports print 0.00 | H |
| `src/routes/reports.ts:171…492`; `monthlyReportService.ts:217`; `expiryAlertService.ts:23` | `date(expiry_date)` cannot read `MM/YY` | H |
| `src/routes/expiry.ts:241, 436`; `expiryAlertService.ts:60`; `frontend/src/pages/Expiry/index.tsx:233, 398-401, 665` | `new Date('05/27')` → 2001 | H |
| `frontend/src/pages/PurchaseHistory/index.tsx:409-413` | All-time fallback for an empty range; "Total Paid" = total | H |
| `src/routes/investigation.ts:33, 85-95, 135` | Inventory id used as medicine id; missing date = 1970; pack 1 | H |
| `services/monthlyReportService.ts:491` | Sales − purchases labelled "profit" | M |
| `services/distributorRecommendationService.ts:155-195`; `routes/pharmarack.ts:262` | Distributor price = MRP × 0.8, margin 20%, MRP 100 | M |
| `frontend/src/pages/Reports/index.tsx:1092-1263`; `Expiry/index.tsx:765-769` | Missing cost shown ₹0.00; qty 1; "Unknown Supplier" bucket | M |

Already correct (keep): `PurchaseSaveVerificationModal` and `CustomerReturn` send no guessed values;
`POST /purchases/manual` and `PUT /purchases/:id/full` refuse missing distributor, date, MRP, qty and
unresolved lines; staged approve refuses a missing batch; purchase edit/delete refuse to take back
stock already sold; Investigation's add-to-sale-bill blocks ₹0 with a clear message (the pattern to
copy).
