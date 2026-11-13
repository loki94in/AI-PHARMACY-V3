# AI Pharmacy — UI Design System Specification (`DESIGN.md`)
*Derived from OpenDesignMD (`opendesignmd.com`) principles for Clinical & High-Density Operating Systems.*

---

## 1. Overview & Architectural Philosophy

The AI Pharmacy application is a **high-speed, keyboard-first, clinical desktop operating system** built for pharmacists and retail counters. Every pixel must serve accuracy, speed, and eye comfort during 12-hour shifts.

### Core Principles
1. **Clinical Calm & High Legibility:** Information hierarchy must be immediately recognizable. Critical medical warnings (Schedule H1, expiries, narcotic flags) stand out instantly without visual alarm fatigue.
2. **High-Density Utility:** Maximize visible data without feeling cramped. Data grids and tables must favor tight, predictable row rhythms and horizontal alignment over large decorative whitespace.
3. **Keyboard-First Ergonomics:** Every primary workflow (billing, search, inventory adjustment, PO generation) can be driven without a mouse. Visual hotkey chips (`[F2]`, `[Enter]`, `[Esc]`, `[Ctrl+K]`) accompany all major interactions.
4. **No-GPU Desktop Rendering Contract:** Because this application runs in Electron on diverse hardware (including low-spec dual-core CPUs with integrated graphics):
   - **Zero `backdrop-filter`:** Do not use `backdrop-blur`. Use solid neutral surfaces (`--glass-bg`).
   - **CPU-Friendly Animation:** Never create infinite animations (`animate-pulse`, `animate-ping`, `animate-bounce` are capped at 3 cycles in CSS). Only `animate-spin` on active indeterminate loaders may run continuously.
5. **Human-in-the-Loop Contract:** Any automated workflow (auto-carting, WhatsApp refills, AI suggestions) must present a clear review gate where the pharmacist can manually inspect, adjust, approve, or dismiss before execution.

---

## 2. Design Tokens & Color System

All components MUST use semantic CSS variables. Never hardcode arbitrary hex codes (`#1f2937`) or unthemed Tailwind utilities (`bg-black/20`, `bg-white/5`).

### Light Mode (Permanent Primary Desktop Theme)

```css
:root, .light {
  /* Surfaces & Backgrounds */
  --bg:           #ffffff;   /* Pure white page canvas */
  --bg2:          #f9fafb;   /* Hairline off-white card/container surface */
  --bg3:          #f3f4f6;   /* Subtle grey for nested panels, inputs, and table headers */
  --glass-bg:     #ffffff;   /* Solid white for panels (no GPU backdrop-filter) */

  /* Inks & Typography */
  --text:         #14532d;   /* Deep clinical green/slate — primary high-contrast reading text */
  --muted:        #44604f;   /* Medium clinical neutral (≥5:1 contrast) for labels and secondary text */

  /* Hairlines & Borders */
  --border:       #e5e7eb;   /* 1px neutral hairline divider */
  --glass-border: rgba(0, 0, 0, 0.08);

  /* Accents & Highlights */
  --primary:      #16a34a;   /* Medical emerald — primary actions, active tabs */
  --notif-border: rgba(167, 139, 250, 0.55); /* Soft purple for non-intrusive notifications */
}
```

### Semantic Color Usage Rules

| Purpose | Tailwind Classes | Visual Guidance |
| :--- | :--- | :--- |
| **Page Canvas** | `bg-bg text-text` | Clean, crisp, neutral base. |
| **Cards & Surfaces** | `bg-bg2 border border-border` | Subtle contrast step above canvas with clean hairline. |
| **Nested Sub-panels & Inputs** | `bg-bg3 border border-border` | Clear visual inset for form controls, search bars, and table headers. |
| **Primary Buttons / Accent Fills** | `bg-primary hover:bg-emerald-700 text-white font-medium` | **MANDATORY RULE (P2-05):** Labels on saturated accent fills MUST use `text-white`. Never place `text-text` over an accent fill. |
| **Secondary Buttons** | `bg-bg2 hover:bg-bg3 border border-border text-text` | Calm utility actions (Cancel, Close, Export, Filter). |
| **Destructive / Warning Actions** | `bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100` | Delete, Discard Bill, Hard Reject. |

### Clinical Status Palette

Always pair status colors with high-contrast text and soft pastel backgrounds:

* **Success / In Stock / Paid:** `bg-emerald-50 text-emerald-800 border-emerald-200` (Dot: `bg-emerald-500`)
* **Warning / Low Stock / Due Soon:** `bg-amber-50 text-amber-800 border-amber-200` (Dot: `bg-amber-500`)
* **Critical / Expired / Schedule H / Banned:** `bg-rose-50 text-rose-800 border-rose-200` (Dot: `bg-rose-500`)
* **Info / Sync / AI Suggestion:** `bg-sky-50 text-sky-800 border-sky-200` (Dot: `bg-sky-500`)
* **CRM / Prescriptions / Doctor:** `bg-indigo-50 text-indigo-800 border-indigo-200` (Dot: `bg-indigo-500`)

---

## 3. Typography & Numerics Scale

### Font Stack
* **Primary System:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
* **Monospace & Financials:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Hierarchy & Scale

```
Display / Modal Title:   text-lg (18px)   font-bold       tracking-tight
Section Heading:         text-sm (14px)   font-semibold   tracking-normal
Body / Grid Text:        text-xs (12px)   font-normal     leading-relaxed
Micro Label / KBD tag:   text-[11px]      font-medium     uppercase tracking-wider
Numeric Data / Totals:   text-xs / sm     font-mono       tabular-nums
```

### Tabular Numerics Rule (`tabular-nums font-mono`)
In pharmacy counters, numbers must line up vertically so cashiers can scan prices and quantities at a glance.
* **Always apply `font-mono tabular-nums text-right`** to:
  * Prices (`₹124.50`)
  * Bill Subtotals & Net Payables
  * Quantities & Pack Sizes (`10 Tabs`, `100 ml`)
  * Batch Numbers (`B24091`)
  * Expiry Dates (`08/26`)

---

## 4. Component Standards

### 1. High-Density Data Tables
* **Header:** `bg-bg3/80 text-muted uppercase text-[11px] font-semibold tracking-wider h-8 border-b border-border`
* **Rows:** `h-9` or `h-10` fixed rhythm. Row hover: `hover:bg-bg2/60 transition-colors`.
* **Dividers:** Hairline borders `border-b border-border/60`. Avoid harsh vertical interior grid lines.
* **Selection State:** Active/focused row uses `bg-emerald-50/50 border-l-2 border-l-primary`.
* **Overflow & Performance:** Scrollable table containers must include `.dropdown-scroll` to ensure lightweight CPU scrolling.

### 2. Status Badges & Pills
* **Format:** Rounded pill with miniature status dot.
* **Markup Pattern:**
  ```tsx
  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-50 text-emerald-800 border-emerald-200">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
    In Stock
  </span>
  ```

### 3. Keyboard Shortcut Chips (`<kbd>`)
* Accompany input fields, buttons, and search prompts.
* **Markup Pattern:**
  ```tsx
  <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted bg-bg3 border border-border rounded shadow-[0_1px_0_rgba(0,0,0,0.06)]">
    F2
  </kbd>
  ```

### 4. Search & Filter Toolbars
* **Height:** Compact `h-9` (36px).
* **Styling:** `bg-bg3 border border-border rounded-lg text-xs text-text placeholder:text-muted/70 focus:bg-bg focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none`.
* **Lead Icon:** Standard 14px search icon with trailing shortcut chip (`Ctrl+K` or `/`).

### 5. Slide-Over Inspection Drawers vs. Modals
* **Slide-Over Drawers:** Used for viewing details (medicine specifications, batch selection, customer refill history) so the main POS screen or table remains visible underneath.
* **Centered Modals:** Reserved only for disruptive or focused decisions (closing session, final bill payment settlement, database backup).
* **Header Standard:** Fixed top bar with title, breadcrumb/tag, and an explicit `<button><kbd>Esc</kbd></button>` dismiss trigger.

### 6. Empty States
Never show a blank white void when a query returns no results.
* **Standard:** Centered container with muted illustration or Lucide icon (32px), friendly 2-line explanation, and a direct action trigger:
  ```tsx
  <div className="py-12 flex flex-col items-center justify-center text-center">
    <PackageSearch className="w-8 h-8 text-muted/50 mb-2" />
    <p className="text-xs font-semibold text-text">No medicines found</p>
    <p className="text-[11px] text-muted mb-3">Check spelling or search by generic molecule</p>
    <button className="px-3 py-1.5 rounded-md bg-bg2 border border-border text-xs text-text hover:bg-bg3">
      Clear Filters [Esc]
    </button>
  </div>
  ```

---

## 5. Automated Agent Checklist

Any AI agent (Antigravity, Claude, Cursor, Windsurf) authoring UI code in this project must verify the following before submitting changes:

- [ ] **No Raw Colors:** Are all colors using semantic variables (`bg-bg`, `bg-bg2`, `border-border`, `text-text`, `text-muted`)?
- [ ] **Accent Contrast Check:** If an element has `bg-primary` (or other saturated fill), is its text explicitly `text-white`?
- [ ] **Numerics Formatted:** Are prices, quantities, and dates using `font-mono tabular-nums`?
- [ ] **No-GPU Adherence:** Are all `backdrop-blur-*` utilities avoided? Are pulse/bounce animations avoided in favor of static indicators or spin loaders?
- [ ] **Keyboard Shortcuts Visible:** Are shortcuts displayed next to primary actions?
- [ ] **Human-in-the-Loop Gate:** Does any automated or AI workflow allow the human pharmacist to approve/edit before commit?
- [ ] **Guardrails Verified:** Did `node scripts/quick-update.mjs` and `npm run guardrails` pass?
