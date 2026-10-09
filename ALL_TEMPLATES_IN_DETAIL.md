# ALL TEMPLATES IN DETAIL — AI Pharmacy v2

> Read-only inventory. No app code was touched to produce this file.
> Generated: 2026-10-09. Sources are real template builders / seeds / i18n strings with file + line pointers.
> Editing ownership: Distributor templates via Dispatch + `delivery_boys`; patient messages are manual-click only (CRM); briefing theme via Settings.

---

## Table of contents

1. Distributor order WhatsApp (central builder)
2. Quick-send `whatsapp_message_templates` (DB seeds, user-editable)
3. Distributor dispatch reminder (custom global template)
4. Special-order arrival (single + multi, en/hi/mr)
5. Refill reminder + collection (en/hi/mr)
6. POS invoice WhatsApp + credit reminder + payment receipt
7. Dispatch / delivery-boy summaries + daily batch
8. Owner-only operational WhatsApps
9. Daily operational briefing — 4 themes
10. Bot / i18n / Telegram / booking pools (en/hi/mr)
11. Bill / print / PDF / barcode / QR templates
12. Email / SMS
13. Where each template lives + how to edit safely

---

## 1. Distributor order WhatsApp — central builder

Source: `src/utils/whatsappTemplateBuilder.ts:188-248`, wrapper `:253-274`, resolver `:29-79`.

### 1A. Full TODAY DISTRIBUTOR ORDER (no OrderNo)

```
📅 TODAY DISTRIBUTOR ORDER — 9 Oct

🏬 *DISTRIBUTOR NAME*
📞 Contact: <distributorPhone - only if present>
🚚 *Delivery Boy / Pickup Person:* <boyName> (<boyPhone>)

📦 *Medicines List:*
1. *Dolo 650*
   📦 *Pack: 15 TAB STRIP*
   🔢 Order Qty: *2 Strips*
   (MRP: ₹xx - only if mrp > 0)

📊 *Total Items:* <n>
📄 *Preferred Email Invoice Format:* CSV
📩 *Please email bill copies to:* <pharmacyEmail - only if present>
```

Late-addition variant prefix: `📅 TODAY ORDER (LATE ADDITION) — <date>`.
Empty-items fallback line: `• Standard Pharmacy Order Items`.

Trigger: purchase-save notify, and Pharmarack post-order sync (`pharmarackOrderSyncService`).
*Note on Pharmarack Cart "Send All via WhatsApp" Workflow:*
- Clicking "Send All via WhatsApp" in Pharmarack Cart notifies the **Delivery Staff** first (Section 7A). It does **NOT** message distributors immediately.
- The order is placed officially (automatically via background checkout / manually by user on Pharmarack).
- The **Distributor Dispatch Reminder (1B)** is triggered only after the app detects newly generated official Order IDs from Pharmarack sync.

Delivery boy: `resolveActiveDeliveryBoy()` → first `delivery_boys WHERE is_active=1`, formatted `+91 XXXXX XXXXX`; fallback `👤 Admin / Store Owner` from `app_settings shop_phone / owner_whatsapp_number`.

### 1B. Short PO dispatch reminder (OrderNo present or isReminderOnly)

```
📦 *Pharmarack Order #784512, #784519* has been placed.
Please pack and dispatch as soon as possible.

🏬 *Distributor:* <NAME>
📞 Contact: <phone - if present>
🚚 *Delivery / Pickup Staff:* <boyName> (<boyPhone>)
📅 *Date:* <dateLabel>

📄 *Preferred Invoice Format:* CSV
📩 *Please email bill copies to:* <email - if present>
```

OrderNo normalization: split on `,`, strip `#`, re-add `#id`.
Trigger: today's `pharmarack_synced_orders` when newly detected Order IDs are synced from Pharmarack.

#### 1B.1. Same-Day Follow-Up Order Deduplication Rule
When the app detects a new Order ID for a distributor who was *already sent* a dispatch reminder earlier today (e.g. initial order `#784512` dispatched at 11:00 AM, new order `#784525` detected at 3:00 PM):
- **Strict Rule:** Never repeat old, already-sent Order IDs in the message.
- The follow-up message contains **ONLY the newly detected Order ID(s)** (`#784525`):
```
🆕 New Pharmarack Order #784525 placed. Please dispatch ASAP — to be collected by <boyName> (<boyPhone>) - <storeName>
```
- Both Order IDs (`#784512` and `#784525`) remain saved and visible in the app's today history and dispatch records so the store and staff know 2 distinct orders were placed.

#### 1B.2. 5-Minute Grace Period (Human-in-the-Loop)
When new Order IDs are detected and a distributor dispatch message is generated:
- It is scheduled in `whatsapp_send_queue` with a **5-minute delay** (`scheduled_at = now + 5 min`).
- A prominent live banner in the UI allows the user to manually **Send Immediately**, **Edit Message**, or **Cancel** before the timer expires.
- If no manual intervention occurs, the background queue worker sends it automatically after 5 minutes.

### 1C. Single-item quick order wrapper

`buildWhatsAppOrderNotification({productName, qty, packaging, distributorName, assignedBoy})` → same 1A shape with 1 item. Used by quick special-order to distributor.

Pack helper `formatPackagingAndUnit()`: `Pack: <raw>`, `2 Strips / Bottles / Tubes / Vials / Sachets / Boxes`, totals like `1 Strip (15 Tablets)`.


---

## 2. Quick-send `whatsapp_message_templates` (DB, user-editable)

Source: `src/database.ts:4057-4101`. CRUD: `src/routes/messaging.ts:734-800` (`GET/POST/PUT /messaging/templates`). Table: `whatsapp_message_templates(name, category, body)`.

| # | Name | Category | Body (exact seed) |
|---|------|----------|-------------------|
| 1 | Refill Reminder | Patients | `Hello {{name}}, this is a friendly reminder from AI Pharmacy that your prescription for {{medicine}} is due for refill. Reply to confirm order delivery.` |
| 2 | Payment Dues Reminder | Patients | `Dear {{name}}, your bill invoice #{{invoice}} of ₹{{amount}} is due. Kindly let us know if you need assistance with payment.` |
| 3 | Stock Availability Inquiry | Distributors | `Dear {{distributor}}, please check stock availability and rate for: {{medicines}}. Thank you.` |
| 4 | General Reply | General | `Hello! Thank you for contacting AI Pharmacy. How can we help you today?` |
| 5 | Store Location & Directions | General | `Hello {{name}}, our pharmacy is located at:\n📍 {{address}}\nDirections: {{google_maps_url}}\nWe look forward to serving you!` |

Notes: seed runs only when table empty; location template backfilled if missing; legacy hardcoded maps link auto-replaced with `{{google_maps_url}}`.

---

## 3. Distributor dispatch reminder (custom global template)

Source: `src/services/notificationService.ts:935-975`. Settings API: `src/routes/dispatch.ts:468-493` (`GET/POST /dispatch/distributor-reminders/template`, key `app_settings.distributor_reminder_template`). UI: `frontend/src/pages/Dispatch/index.tsx:455-470`.

Placeholders: `{distributor_name} {delivery_boy} {phone} {store_name} {order_no}`.

Default when no custom template (never invented OrderNo — only real `pharmarack_synced_orders` today):

- Follow-up with new OrderNo: `🆕 New Pharmarack order #123 placed. Please dispatch ASAP — to be collected by <Boy> (<phone>) - <Shop>`
- With OrderNo: `📦 Pharmarack order #123 — has it been dispatched or collected by <Boy> (<phone>)? - <Shop>`
- No OrderNo: `📦 Has today's order been dispatched or collected by <Boy> (<phone>)? - <Shop>`

If custom template has `{order_no}` it is substituted with `#a, #b`; if custom template lacks it but OrderNo exists, prepended as `📦/🆕 Pharmarack order #...` line.

---

## 4. Special-order arrival (patient, manual-click only)

Source: `src/services/storeSettingsService.ts:284-338` single, `:352-425` multi. Queue: `src/routes/orders.ts:415-484` `enqueueArrivalWhatsApp()` + `:592-655` batch (`custom_message` allowed). Idempotent on `notified===1`; missing phone skips silently; response carries `whatsapp_queued`; PDF slip attached (`generateSpecialOrderSlipPdf`); 60-min same-medicine dedupe.

### 4A. Single arrival — English

```
Hi <Name>, 👋

Great news! 🎉 Your requested medicine is now ready for pickup at <StoreName>.

Your Order:
• <Product> × <Qty>

🗺️ Store Location & Directions: <mapUrl>
— OR —
📍 Please visit our store at your convenience to collect your medicine.

📞 For any assistance, call us at <phone>.   (only if phone set)

Thank you for choosing <StoreName>!
```

### 4B. Single arrival — Hindi

```
नमस्ते <Name>, 👋

खुशखबरी! 🎉 आपकी मांगी गई दवाई <Store> पर लेने के लिए तैयार है।

आपका ऑर्डर:
• <Product> × <Qty>

🗺️ दुकान का पता और मैप डायरेक्शन: <mapUrl>
— OR —
📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर अपनी दवाई प्राप्त करें।

📞 सहायता के लिए, हमें <phone> पर कॉल करें।

<Store> को चुनने के लिए धन्यवाद!
```

### 4C. Single arrival — Marathi

```
नमस्कार <Name>, 👋

आनंदाची बातमी! 🎉 आपली मागवलेली औषध <Store> येथे मिळण्यास तयार आहे.

आपली ऑर्डर:
• <Product> × <Qty>

🗺️ दुकानाचा पत्ता आणि मॅप डायरेक्शन: <mapUrl>
— OR —
📍 कृपया आपल्या सोयीनुसार आमच्या दुकानाला भेट देऊन औषध घेऊन जावे।

📞 मदतीसाठी, आम्हाला <phone> वर कॉल करा.

<Store> ची निवड केल्याबद्दल धन्यवाद!
```

### 4D. Multi / consolidated — English

All-arrived:

```
Hi <Name>, 👋

Great news! 🎉 Your requested medicines are now ready for pickup at <Store>:

📦 Ready for Pickup:
• A ×1
• B ×2

🗺️ Store Location & Directions: <mapUrl>
— OR —
📍 Please visit our store at your convenience to collect your medicines.

📞 For questions or home delivery, call: <phone>

Thank you for choosing <Store>!
```

Mixed:

```
Hi <Name>, 👋

Order status update from <Store>:

✅ Ready for Pickup:
• A ×1

⏳ Slightly Delayed / In Transit:
• B ×2 (Exp: <date> - <reason>)

📍 You can collect the ready medicines anytime. We will notify you as soon as the rest arrive!

📞 For questions or home delivery, call: <phone>

Thank you for choosing <Store>!
```

Delayed-only:

```
Hi <Name>, 👋

Order status update from <Store>:

⏳ The following medicines are slightly delayed:
• B ×2 (Exp: <date> - <reason>)

We are actively arranging them and will notify you immediately once received.

📞 For questions or home delivery, call: <phone>

Thank you for choosing <Store>!
```

Hindi multi uses: `📦 तैयार दवाइयां:` / `✅ तैयार दवाइयां (दुकान से प्राप्त करें):` / `⏳ आने में थोड़ा समय (आते ही सूचित करेंगे):` with same structure. Marathi mirrors the same three branches (full strings in `storeSettingsService.ts:367-425`).

Trigger UI: CRM `/crm?tab=special_orders` → `Send Arrival WA` / `Resend` / `Mark Ready`.

---

## 5. Refill reminder + collection (patient, manual-click only)

Source: `src/routes/refills.ts:80-137` due, `:140-193` collection. Staged type `refill_reminder` / `refill_collection`. Trigger: `POST /automation/notifications/:id/send`, Stage-B/C `mark-ready`.

### 5A. Due refill — English

```
🔔 *MEDICINE REFILL REMINDER — <Shop>*

Dear <Name>,
Your regular prescription is due for refill:

• Telma 40 (Qty: 3)

Due Date: <date - if present>
🕒 Store Hours: 09:00 to 22:00
⚠️ Notice: Our pharmacy will remain closed on <WeeklyOff>. Please collect before closure!  (only when off-day upcoming)

❓ Would you like us to prepare your regular medicines?
👉 *Reply "REFILL" or "YES" to confirm.*
*(Store open 09:00 - 22:00)*
```

### 5B. Due refill — Hindi

```
🔔 *दवाई रिफ़िल रिमाइंडर — <Shop>*

नमस्ते <Name>,
आपकी नियमित दवाई का रिफ़िल समय आ गया है:

• <Medicine> (मात्रा: 1)

तारीख: <date>
🕒 दुकान का समय: <open> से <close>
⚠️ सूचना: हमारी दुकान <WeeklyOff> को बंद रहेगी। कृपया समय से पहले दवाई ले लें!

❓ क्या आप दवाई तैयार करवाना चाहते हैं?
👉 *पुष्टि के लिए "REFILL" या "हाँ" लिखकर उत्तर दें।*
```

### 5C. Due refill — Marathi

```
🔔 *औषध रिफिल स्मरणपत्र — <Shop>*

नमस्कार <Name>,
आपल्या नियमित औषधांची रिफिल करण्याची वेळ झाली आहे:

• <Medicine> (प्रमाण: 1)

दिनांक: <date>
🕒 दुकानाची वेळ: <open> ते <close>
⚠️ सूचना: आमचे दुकान <WeeklyOff> ला बंद राहील. कृपया आधीच औषध घेऊन जा!

❓ तुम्हाला ही औषधे तयार हवी आहेत का?
👉 *निश्चितीसाठी "REFILL" किंवा "हो" लिहून उत्तर द्या।*
```

### 5D. Collection / packed-ready — English

```
🔔 *READY MEDICINE COLLECTION REMINDER — <Shop>*

Dear <Name>,
Your packed prescription is waiting and ready for collection at our pharmacy:

• *<Medicine>* (Qty: 1)
🕒 Store Hours: <open> to <close>

👉 *Please collect your medicine at your earliest convenience.*
```

Hindi: `🔔 *तैयार दवाई संग्रह रिमाइंडर — <Shop>* ... आपकी तैयार की गई दवाई फार्मेसी पर आपके लिए उपलब्ध है:` + `👉 *कृपया अपनी सुविधानुसार दवाई ले जाएं।*`
Marathi: `🔔 *तयार औषध संकलन स्मरणपत्र — <Shop>* ... आपली तयार केलेली औषधे फार्मसीमध्ये उपलब्ध आहेत:` + `👉 *कृपया आपल्या सोयीनुसार औषध घेऊन जावे.*`

---

## 6. POS invoice WhatsApp + credit + receipt

### 6A. POS invoice caption + PDF

Source: `src/services/whatsappInvoiceService.ts:65-108`. Trigger: after POS save if `trigger_wa_invoice_pdf_enabled != 'false'`, via `src/routes/sales.ts:822`. Types `pos_sale_invoice` / `pos_credit_invoice` / `credit_sale_invoice`. PDF: `pdfInvoiceService.generateInvoicePdf()`.

Paid:

```
Dear <Customer>,

📄 *Sale Invoice: #<no>*
Bill Amount Paid: *₹<total>*

Thank you for your purchase!

— AI Pharmacy OS
```

Credit:

```
Dear <Customer>,

📌 *Credit Purchase Bill & Account Summary*

🧾 *Current Bill (#<no>)*
• Date: *<date>*
• Bill Amount: *₹<total>*

📜 *Recent Credit Bills (Last 4):*
1. *#<no>* (<date>) — ₹<amt> [Current]
...

💰 *Total Outstanding Balance: ₹<dues>*

📎 Detailed medicine invoice is attached in the PDF above.
This bill has been posted to your credit ledger account.
— AI Pharmacy OS
```

### 6B. Credit dues + UPI QR + statement PDF

Source: `src/services/creditReminderService.ts:87-127`, text `src/i18n/messages.json:7 (en), :102 (hi), :197 (mr)`. Trigger: auto `checkOverdueAndEnqueue()` (gated) + manual CRM click. Attachments: rotating UPI QR + `generateCreditStatementPdf()`.

```
Dear {{name}},

📌 *Credit Outstanding Balance Reminder*

📜 *Pending Bills Breakdown (n)*
• Bill #<no> (<date>): ₹<amt>

📊 *Summary Calculation*
Due Date: *<dueDate>*
━━━━━━━━━━━━━━━━━━
💰 *Total Outstanding Balance: ₹{{total}}*

💳 *UPI Payment QR Code is attached below.* Scan with any UPI app (GPay/PhonePe/Paytm) to clear your outstanding dues directly.

Kindly arrange payment at your earliest convenience or visit our pharmacy.

Thank you!
— {{storeName}}
```

### 6C. Payment receipt (ledger collect)

Source: `src/routes/crm.ts:748-786`, text `messages.json:8`. Trigger: `POST /crm/ledger/collect {sendWhatsApp:true}` if `trigger_wa_payment_receipt_enabled`.

```
Dear {{name}},

✅ *Payment Received Receipt*
Amount Received: *₹{{amount}}*
Remaining Dues: *₹{{remaining}}*
Date: *{{date}}*

Thank you for your payment!
— {{storeName}}
```

---

## 7. Dispatch / delivery-boy summaries + daily batch

### 7A. Batch distributor summary (to delivery boy)

Source: `src/services/notificationService.ts:785-813`, triggered when clicking "Send All via WhatsApp" in Pharmarack Cart.

```
🏥 *<Shop>*
📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — 9 Oct*
👤 *Assigned Staff:* <boyName>

1. *<Distributor 1>* (<n> items)
    📞 Contact: +91 XXXXX XXXXX
2. *<Distributor 2>* (<n> items)
    📞 Contact: +91 XXXXX XXXXX

==================================
🚚 *Total Assigned Distributors:* <count>
📦 *Total Order Items:* <totalItems>
==================================
```

*Optional Itemized Medicine List Toggle:*
When the user turns ON the "Send Detailed Medicine List" toggle in the "Send All via WhatsApp" popup, each distributor section in the Delivery Staff's message expands to include the itemized medicine breakdown:
```
1. *<Distributor Name>* (<n> items)
    📞 Contact: +91 XXXXX XXXXX
    📦 *Medicines List:*
      1. *Dolo 650* — 2 Strips (Pack: 15 TAB STRIP)
      2. *Pan D* — 5 Strips (Pack: 10 CAP STRIP)
```
*Note:* This message is sent immediately to the assigned Delivery Staff when clicking "Send All via WhatsApp". The distributors are **not** messaged here; their dispatch reminders (Section 1B) are held until official Order IDs arrive.


### 7B. Consolidated dispatch list (to one boy)

Source: `src/services/notificationService.ts:1010-1066`. Title switches at 13:00.

```
🏥 *<Shop>*
📍 *Delivery Location:* <address>
📞 *Pharmacy Contact:* <phone>

🚚 *TODAY'S DISPATCH & COLLECTION LIST*  (or AFTERNOON DISPATCH & COLLECTION LIST)
👤 *Assigned Staff:* <boyName>   (if not Delivery Staff)
📅 *Date:* <dateStr>
🏢 *Assigned Distributors:* <n>

─────────────────────────
1. *<Dist>*
   📞 <phone>
   📊 Status: ⏳ Pending Collection / ✅ Dispatched / Ready / 📦 Collected (<items> items)

─────────────────────────
📝 *Note:* Please verify bills with distributor counter and collect invoices for <Shop>.
```

### 7C. Pharmarack daily batch (per-dist + summary)

Source: `src/services/pharmarackDailyDispatchService.ts:164-276` + `:345-470`. Trigger: `tryDailySend()` 11:00+10m, cart-visit late, `recordPlacedOrder()` 60s debounce. Types `pharmarack_daily_batch_summary / pharmarack_additional_batch_summary`.

Per-dist: `📅 TODAY ORDER (LATE ADDITION) — ...` with `🔄 *Re-order*` / `🆕 *New Addition*` tags.
Summary:

```
🏥 *<Shop>*
📋 *TODAY DISTRIBUTOR SUMMARY... / ADDITIONAL DISTRIBUTOR PICKUP (AFTERNOON)...*
🚚 *Total...:* ...
📦 *Total...Items:* ...
```

### 7D. Missing-phone admin alert

Source: `src/services/notificationService.ts:1196-1200`.

```
The following supplier(s) have orders today but *NO contact phone*...👉 *Action Needed:*...save their 10-digit number...
```

---

## 8. Owner-only operational WhatsApps

No patient auto-messaging. All below go to owner/admin unless stated.

| Purpose | Source | Template / shape |
|---|---|---|
| Distributor invoice / email arrival | `src/services/emailService.ts:643-651`, `:788-791` | `Distributor: X\nInvoice No: Y\nBill Amount: N/A (never guessed)\nArrival Time: 10:30 AM` ; `📧 *New Email Received*\nFrom:...Subject:... \nArrival Time:...` Types `distributor_invoice` / `email_arrival` |
| Order-vs-mail % check | `src/services/orderMailCheckService.ts:112-129` | `📦 *Order check — Dist*\n✅ Today's order is complete... (5/5)` or `80% ... (4/5)\n❌ *Missing:*\n• X ×2\n⚠️ *Short quantity:*\n💲 *MRP differs:*\nAlso in the mail...` Type `order_mail_check` + SSE toast |
| Refill-cart summary (owner, never patient) | `src/services/refillCartService.ts:515-559` | `🛒 *Refill cart — Patient*\n*DistA*\n• Telma 40 × 3\n⚠️ *Failed to add (1)*\n• X — out of stock...Open CRM → Refills to fix.` Trigger `POST /api/refills/cart-summary` |
| 15-day expiry report | `src/services/expiryAlertService.ts:56-66` | `📋 *Shop - Auto 15-Day Expiry Report*\n... (Batch:..) \| Exp: .. \| Qty:..` |
| Bounced / short supply | `src/services/bouncedAlertService.ts:209-234` | `⚠️ *Bounced / Short Supply Alert*...• X: Ordered n, Received 0 (BOUNCED) ❌...📦 *Pending Deliveries...*` |
| Doctor daily report | `src/services/doctorReportingService.ts:39-52` | `📋 *Daily Pharmacy Report for Dr. X*\nDate:...\nPatient Referral List...Total Patients/Billing...` |
| Monthly/period report | `src/services/monthlyReportService.ts:267-337` | `📊 *SHOP — PERIOD*\n🗓️ Period...\n💰 FINANCIAL...\n📊 PURCHASE VS SALES GRAPH [██░░]...\n📈 TREND...\n⭐ TOP SELLING...\n⚠️ INVENTORY & CRM AUDIT...` + PDF themes below |
| Store/market closure refill | `src/services/marketClosureService.ts:282-291` | `Namaste X! 🙏\n...market/pharmacy will be closed {start-end} {reason}...dosage *meds*...Reply *YES*...` or custom `{patient_name} {medicines} {start_date} {end_date} {reason} {pharmacy_name}` |
| Admin order reminder (>23h unavailable) | `src/services/shortageReminderService.ts:192-195` | `🚨 *ADMIN ORDER REMINDER (>23 Hours Unavailable)*...👉 Action Required...` |
| Callback / escalation blocks | `src/services/whatsappIntentService.ts:1292,1430,1435-1437,1474/1488/1952,1568-1573,1860/1923,2269,4249-4317`, `src/services/waAdminEscalationService.ts:162,322-324,404-451,589-943,1044-1062` | `📞 *Callback Request*\n👤 Customer...` ; `📞 *Shop*\n📱 *phone*\n...call you back 🙏` ; `✅ Adding/Starting...💊 Medicine...📦 Please enter quantity...` ; `💊 *Medicine*\n📦 *Quantity*\n👤 *Payee*` ; `🔍 Searching for *X* — one moment! 💊` ; `📦 Shelf Stock: *in stock ✅ / 0 ⚠️*`, `👤 *Patient*`, `📱 *Customer*`, `💊 *Prescribed Medicines (n items)*` |
| Offline fallback owner alert | `src/services-nonWaFallbackService.ts:50` | `buildOwnerAlertMessage()` offline fallback |
| Telegram bot strings | `src/telegramBot.ts:254-261,280-289,316,340-346,666` | away-summary / cart / bill / availability (see §10 telegram keys) |

---

## 9. Daily operational briefing — 4 themes

Source: `src/services/refillService.ts:498-928`. Key: `app_settings.daily_briefing_template` (`detailed|compact|checklist|executive`). UI: `frontend/src/pages/Settings/TriggerSchedulesTab.tsx:17,101,122`. Tests: `tests/dailyBriefingCleanup.test.ts:61,80`.

Common header: store name + `🟢 Open as usual` / `🔴 Holiday / Closed today` / `🟡 Weekly Off (<Day>)`, 7-day refill summary, operating schedule.

- `detailed` (default, Template 4): itemized medicines with quantities + stock badges.
- `compact` (Template 1): grouped by patient without long medicine names; clean source tags, no `in_store` noise.
- `checklist` (Template 2): action checklist with `[ ]` boxes.
- `executive` (Template 3): ultra-short KPI metrics summary.

Full branch texts at `refillService.ts:799` (detailed), `:830` (compact), `:861` (checklist), executive following. Returns `{template, messageText}`; send log `Morning operational task briefing (<template>) sent to owner`.

---

## 10. Bot / i18n / Telegram / booking pools (en/hi/mr)

Source: `src/i18n/messages.json` (full file, en `:2-95`, hi `:97-190`, mr `:192-end`), accessor `src/i18n/getMessage.ts:50-98` (DB `message_templates` override → JSON → `BOT_FALLBACK_DEFAULTS`), generic DAO `src/database/messageDAO.ts:20-40` + `src/database.ts:1645` (`message_templates(locale,key,value)`), legacy migration templates `src/database.ts:3392`.

### WhatsApp core keys

- `whatsapp.expiryAlert`: `⚠️ *Medicine Expiry Alert*\nThe following medicines are nearing expiry (within {{months}} months):\n{{list}}\nPlease review stock and consider returning to supplier.`
- `whatsapp.refillReminder` (legacy fallback): `🙏 *Refill Reminder from {{pharmacyName}}*\nHi {{patientName}}, ... refill for *{{medicineName}}* is due on {{dueDate}}.\nYou have {{quantityLeft}} {{unit}} left. ... reply "REFILL"...`
- `whatsapp.orderStatus`: `📦 *Order Update*\nYour order #{{orderId}} has been received and is being prepared.\nExpected ready for pickup: {{pickupTime}}.\nReply with any questions.`
- `whatsapp.creditReminder`, `whatsapp.paymentReceipt`: see §6 (full).
- `whatsapp.bot.*`: `askName`, `retryName`, `welcomeMenu` (1️⃣ Single / 2️⃣ Multiple / 3️⃣ Refill), `orderTypeSinglePrompt` (`Dolo 650`, `Telma 40` examples), `orderTypeMultiPrompt` (list or prescription photo 📸), `askQuantity`, `orderConfirmed` (Order ID / Item / Qty / Total), `outOfStockSpecialOrder` (Reply YES/NO), `specialOrderPlaced`, `noRefillsFound`, `paymentQrPrompt` (₹50-style UPI QR flow), `langSwitched`, `cancelled`. Full strings in `messages.json:9-23` + hi `:104-118` + mr `:199-213`.

### Telegram keys (`messages.json:25-32`)

`telegram.welcome/help/available ({{medicine}} – available MRP ₹{{mrp}} Qty {{quantity}})/outOfStock/notFound/status/orderNotification`. Trigger: `/check /help /status /viewcart /clearcart /bill`, email forwarding.

### Booking / special-request / inventory pools (`messages.json:34-94`)

- `booking.appointmentConfirm/Reminder/Rescheduled/Cancelled`, `preOrderConfirm/Available/Reminder`, `labTestConfirm/SampleCollection/ReportReady`, `homeDeliveryConfirm/SlotChange/outForDelivery`, `vaccinationConfirm/SecondDose`, `teleconsultationLink`, `healthCheckupConfirm`, `bookingPaymentSuccess/Feedback`, `prescriptionUploadNeeded`.
- `specialRequest_1..20`: 20 paraphrases of `request for {{medicineName}} (Qty {{quantity}}) Ref {{bookingId}}`.
- `inventoryReminder_1..20`: 20 paraphrases of `{{medicineName}} back in stock / ready for pickup Ref {{bookingId}}`.

Sample doc only: `docs/samples/whatsapp_sample_message.txt:3-20` (expiry/refill/order-status examples, not sent live).

---

## 11. Bill / print / PDF / barcode / QR templates

| Template | Source | Shape |
|---|---|---|
| Screen-print helper | `frontend/src/utils/printBill.ts:1-13` | sets sanitized `document.title` (Save-as-PDF filename), adds `printing-bill`, `window.print()`, restores on `afterprint` |
| POS Tax Invoice / Retail Counter Receipt | `frontend/src/components/POS/POSPostSaleModal.tsx:74-153` `#printable-bill[data-print-root]` | shop header (name/address/Ph:D.L./GSTIN), Invoice No/Customer/Phone/Doctor/Date/Payment, table `Item/Batch/Qty/Loose/[Disc%]/Amount` (no MRP), footer Subtotal→Discount→Grand Total + CREDIT dues + refill due |
| Sells history bill | `frontend/src/pages/Sells/index.tsx:1635` + `:1965-2034` `#printable-sell-bill` | same + `MRP` column + QR/Code128 strip (`GET /sales/invoice-barcode`) |
| H1 register | `frontend/src/pages/AIEngineering/panels/CompliancePanel.tsx:124-126` + `:120-122` | `handlePrintRegister()->window.print()` + `window.open('/api/compliance/export')` CSV |
| Sale invoice PDF (A4 pdfkit) | `src/services/pdfInvoiceService.ts:14` `generateInvoicePdf()` | Invoice No/Date/Payment/Prescribed By + Billed To + table `Medicine/Batch/Qty/Unit Price/Total` + QR/Code128 |
| Customer credit statement PDF | `src/services/pdfInvoiceService.ts:294` | `CUSTOMER CREDIT STATEMENT & LEDGER SUMMARY`: Customer + Statement/Due Date + Outstanding + table `Bill/Date/Status/Amount` |
| Refill advisory PDF | `src/services/pdfInvoiceService.ts:432` | `PRESCRIPTION REFILL ADVISORY & SCHEDULE`: Patient + Due Date/Cycle + table `Medicine/Dosage/Quantity` |
| Special-order slip PDF | `src/services/pdfInvoiceService.ts:539` | `SPECIAL MEDICINE ORDER ARRIVAL & PICKUP SLIP`: Customer + `Order #SO-id` + Arrival Date + `Status: READY FOR PICKUP` + product table |
| Generic list PDF (legacy) | `src/utils/pdfGenerator.ts:11-34` | one-page list `{name,date}[]` |
| Monthly financial PDF | `src/services/monthlyReportService.ts:342` `generateReportPdf(data,chartStyle,templateTheme='executive')` | themes `executive/classic/minimalist` (`:362-383` palettes); setting `monthly_report_template_theme`; scheduled + `routes/reports.ts:659` |
| Invoice barcode data | `src/services/barcodeService.ts:13-44` | `barcodeText=NO\|YYYY-MM-DD` QR + Code128; `Name\|Batch` product QR+Code128; `GET /purchases/bill-barcode/:id` 350×220 label; `POST /utilities/barcode` 51×27mm stickers |
| UPI QR overlay | `src/services/paymentQrService.ts:268` | `💊 medText` canvas + `allocateNextQr/buildUpiUri/generateQrBuffer` |

---

## 12. Email / SMS

- SMS: none in `src/`, `frontend/src/`.
- Email: no HTML template. `GET /email/inbox` ships `bodySnippet`, `GET /email/:id/body` lazy full text; `src/utils/emailSanitizer.ts` sanitizes. Arrival side-effects `src/services/emailService.ts:697-737`: Telegram alert + `server_event` (`📦 New Distributor Invoice Email` / `📧 New Mail Received`) + SSE `new_email`.

---

## 13. Where each template lives + how to edit safely (no code needed)

| To change | Edit here (UI/DB, not code) |
|---|---|
| Quick replies (refill/due/location) | CRM/Messaging → `whatsapp_message_templates` (API `GET/POST/PUT /messaging/templates`) |
| Distributor reminder wording | Dispatch page → Default message template (`GET/POST /dispatch/distributor-reminders/template`) |
| Daily briefing length | Settings → Trigger Schedules → `daily_briefing_template` = detailed/compact/checklist/executive |
| Monthly PDF look | Settings → `monthly_report_template_theme` = executive/classic/minimalist |
| Distributor linking / min-order flags | Learning → Edit Distributor (Pharmarack link), `distributors.min_order_value/min_order_items` |
| Patient wording (arrival/refill/invoice) | Code-owned builders above — change only via explicit code task (manual-click contract must stay: no worker auto-send to patients) |
| Delivery-boy numbers | `/dispatch` only, table `delivery_boys` (`GET/POST /api/dispatch/delivery-boys`). Never Settings/`app_settings` |
| Migration CSV maps | `GET /migration/templates`, `POST /migration/templates {name, moduleType, mappings}` — field maps, not messages |

Contract reminders: `delivery_boys.whatsapp_number` is the only boy-number column; bill dates are shop local (`src/utils/localTime.ts`); missing data stays missing (no invented OrderNo/amount/items).

---

*End of catalog. App code untouched — this file lives in repo root only.*
