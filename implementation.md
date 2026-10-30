# Implementation Plan: Full App Potential Grounding, Interactive Onboarding & Order Hub Copilot for Qwen

## 1. Problem Statement & User Intent
The user has requested to unlock **Qwen3-1.7B's full potential** across AI Pharmacy OS:
1. Ground Qwen with end-to-end knowledge of **all application modules, screens, and settings** so it acts as an intelligent operating partner for pharmacy staff who have no prior knowledge of the app.
2. Provide **interactive, proactive guidance** that asks the user what they wish to configure or accomplish (especially **Order Hub & Distributor Live Cart settings, WhatsApp automation, and Store profiles**).
3. Offer **1-click navigation and automated workflow staging** (Rule 6 compliant) so users can immediately jump to the exact tab or confirm staged actions with a single click.

---

## 2. Architecture & Components Updated

### A. Operational System Prompt & Intent Schema (`src/services/localAi/operationalIntentSchema.ts`)
- Enriched `buildOperationalSystemPrompt()` with the complete application anatomy, module map, settings tabs, and Order Hub workflows.
- Expanded intent classification to recognize `PAGE_GUIDANCE` with target page and tab extraction (`targetPage`, `targetTab`).
- Added interactive onboarding prompt capabilities: recognize queries like *"how do I configure Order Hub?"*, *"how does automation work?"*, *"what is this app and what can I do?"*, *"where are settings?"*.

### B. Comprehensive Screen & Settings Guidance Tool (`src/services/localAi/pharmacyToolRegistry.ts`)
- Expanded `explainApplicationScreen(pageOrTopic)` to cover **all 10+ application modules** with detailed guidance, keyboard shortcuts, and operating tips:
  - **Order Hub & Live Cart** (`/live-cart`, `/pharmarack-cart`)
  - **Settings & Automation** (`/settings` across tabs: Store Profile, Integrations/Pharmarack, WhatsApp, Order Timing, Triggers/Cron, Data Backups, Appearance/Printers, Staff Security)
  - **POS Billing** (`/pos`)
  - **Purchases & Invoice OCR** (`/purchases`)
  - **Inventory & Batch Tracking** (`/inventory`)
  - **CRM & Patient Refills** (`/crm`)
  - **Returns Hub** (`/returns`)
  - **Dispatch & Home Delivery** (`/dispatch`)
  - **Sells & Reports** (`/sells`, `/reports`)
  - **Investigation & Audit Center** (`/investigation`, `/audit`)

### C. Conversational Engine Routing & Interactive Q&A (`src/services/localAi/conversationalAgentEngine.ts`)
- In `processMessage`:
  - When user asks about application guidance, settings, or Order Hub setup:
    - Returns structured, easy-to-read guidance.
    - Attaches interactive `cards` with direct `actionUrl` (e.g., `/settings?tab=integrations`, `/live-cart`, `/pos`) allowing 1-click navigation.
    - Provides smart, guided follow-up questions tailored to the screen.
  - When user opens chat or sends greeting with a `pageContext`:
    - Greets with page-aware proactive guidance and top actions for that specific screen.
- Preserved Rule 6 human-in-the-loop approval on all consequential actions.

### D. Frontend Assistant Suggestions & Page Context (`frontend/src/components/UnifiedOperationsAssistantModal.tsx`)
- Enhanced `getPageContextInfo(pathname)` to include richer, more helpful proactive suggestions for Settings, Order Hub, and Live Cart.

---

## 3. Verification & Guardrail Results
1. **Unit Tests**:
   - `tests/conversationalAgentEngine.test.ts`: 25/25 tests passed (including Criterion 25 for Order Hub settings routing and page-aware greetings).
2. **Performance Guardrails**:
   - `npm run guardrails` passed with 0 violations and clean `tsc --noEmit`.
3. **Build & Deploy Sync**:
   - `npm run build:client` completed cleanly in 47.31s.
   - `npm run build:bundle` generated 5.5 MB `dist-pkg/server.cjs`.
   - Synced fresh `frontend/dist` and `dist-pkg/server.cjs` to `G:\AI Pharmacy OS\`.

---

## 4. Execution Tasks
- [x] Task 1: Enrich `operationalIntentSchema.ts` with comprehensive app knowledge & settings routing
- [x] Task 2: Expand `pharmacyToolRegistry.ts` `explainApplicationScreen` to cover all screens and settings tabs
- [x] Task 3: Upgrade `conversationalAgentEngine.ts` with interactive Q&A guidance, navigation cards, and proactive greetings
- [x] Task 4: Enhance `UnifiedOperationsAssistantModal.tsx` suggestions
- [x] Task 5: Verify unit tests (`tests/conversationalAgentEngine.test.ts`) and performance guardrails
- [x] Task 6: Build frontend, bundle backend, and sync to `G:\AI Pharmacy OS\`
