# Goldfish Annotated Review Report

**Target:** `src/database.ts` (Full File) and Schema Migrations  
**Status:** Audit & Resolution Ready

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-codebase-details`] - Severity: High
* **Affected Scope:** `src/database.ts` (Index creation blocks)
* **Discrepancy Description:** 9 duplicate indexes exist in SQLite schema (`idx_automation_notifications_type_status`, `idx_expiry_reviews_status`, `idx_msm_activity`, `idx_sales_invoices_date_status`, `idx_sales_invoices_customer_status`, `idx_customers_name`, `idx_medicines_name`, `idx_medicines_generic_name`, `idx_medicines_api_ref`).
* **Rationale:** Exact duplicate indexes cause redundant B-tree updates on every insert/update and risk optimizer divergence.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Drop the 9 duplicate index definitions from `data/app.dev.db` and remove redundant `CREATE INDEX` lines from `src/database.ts`.
* ***Proposed Edit:***
  * Location: `src/database.ts`
  * Change: Retain the canonical index names, drop the duplicates from DB, remove duplicate CREATE INDEX statements.

### [Issue 2] [`egm-design`] - Severity: High
* **Affected Scope:** `customers` table (`language` vs `preferred_language`)
* **Discrepancy Description:** `customers` table has two columns for the customer's language. Queries repeatedly evaluate `COALESCE(c.preferred_language, c.language, 'mr')`.
* **Rationale:** Dual columns violate the single source of truth contract and lead to sync desynchronization.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Migrate values into `customers.language`, drop column `preferred_language`, and update all callers.

### [Issue 3] [`egm-zoom-out`] - Severity: High
* **Affected Scope:** `special_orders` table (`product` vs `medicine_name`)
* **Discrepancy Description:** `special_orders` table has both `product` and `medicine_name`, forcing `COALESCE(product, medicine_name, 'Medicine')`.
* **Rationale:** Two columns for the medicine name create confusion between CRM, Refills, and POS sync.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Backfill all missing `medicine_name` from `product`, drop column `product`, and standardize on `medicine_name`.
