# Goldfish Annotated Review Report

**Status: resolved**  
**Target:** `TRILINGUAL_MESSAGING_AND_CALENDAR_AUDIT_PLAN.md` (Full File)

## Prioritized Findings & AI Suggestions

### [Issue 1] [`SpecialOrderArrivalModal`] - Severity: High
* **Affected Scope:** `frontend/src/components/SpecialOrderArrivalModal.tsx#L49-L171` (Arrival Notification Generation)
* **Discrepancy Description:** The language toggle only supports `en` and `hi`. Marathi (`mr`) is completely absent from the special order counter arrival notification modal.
* **Rationale:** In Maharashtra, the vast majority of retail pharmacy customers prefer communication in Marathi. Forcing English or Hindi on counter arrival alerts violates customer personalization standards.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:** The customer table already stores `language = 'mr'`. Adding Marathi templates and a segmented toggle (`EN` | `हिंदी` | `मराठी`) ensures full trilingual parity.
* ***Proposed Edit:***
  * Location: `SpecialOrderArrivalModal.tsx`
  * Change: Expand `lang` type to `'en' | 'hi' | 'mr'`, add Marathi message branch in `generatedMessage`, and add `मराठी` button in header.

---

### [Issue 2] [`DelayNoticeModal`] - Severity: High
* **Affected Scope:** `frontend/src/components/DelayNoticeModal.tsx#L30-L51` (Delay Preset Templates)
* **Discrepancy Description:** All four delay notification templates (Festival, Weather, Distributor Delay, Custom) are hardcoded in English only.
* **Rationale:** Broadcast delay notices affect patients waiting for critical medicines. Sending English-only text creates comprehension barriers for Marathi-speaking and Hindi-speaking seniors.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:** Adding structured trilingual dictionaries for the 4 presets and a language selector gives pharmacists 1-click broadcast capabilities in the patient's language.
* ***Proposed Edit:***
  * Location: `DelayNoticeModal.tsx`
  * Change: Add `CLOSURE_DELAY_PRESETS` for `mr`, `hi`, and `en`, with an Apple-style segmented language selector.

---

### [Issue 3] [`whatsappIntentService`] - Severity: Medium
* **Affected Scope:** `src/services/whatsappIntentService.ts#L3213-L3218` (Bot Fallback Prompts)
* **Discrepancy Description:** When a patient sends an unrecognized message while choosing between Refill and Special Order, the retry and pharmacist transfer prompts are English only.
* **Rationale:** If a Marathi user types something unclear, replying in English breaks the conversational flow.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:** Branching `retryMsg` and `silenceMsg` on `stepLang` (`mr` / `hi` / `en`) maintains conversational consistency.
* ***Proposed Edit:***
  * Location: `src/services/whatsappIntentService.ts`
  * Change: Replace hardcoded strings with language-aware templates for `mr`, `hi`, and `en`.

---

### [Issue 4] [`whatsappInvoiceService`] - Severity: Low
* **Affected Scope:** `src/services/whatsappInvoiceService.ts#L65-L108` (Invoice PDF WhatsApp Caption)
* **Discrepancy Description:** The caption sent with the bill PDF at POS checkout is hardcoded in English.
* **Rationale:** While the PDF itself is a structured invoice document, the WhatsApp caption greeting and dues summary are more inviting in the customer's preferred language.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:** Check customer's stored language and format the caption in Marathi (`mr`), Hindi (`hi`), or English (`en`).
* ***Proposed Edit:***
  * Location: `src/services/whatsappInvoiceService.ts`
  * Change: Add Marathi and Hindi caption branches using customer language preference.
