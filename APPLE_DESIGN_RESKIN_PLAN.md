# Apple-Design Reskin Plan — Full App, Within Hard Constraints

> Scope locked by owner: **Full app reskin + keep all constraints** (light/dark toggle, no-GPU/no-blur, semantic tokens, guardrails green).
> Flavour: **Hybrid — macOS chrome (Sidebar/Topbar/inspector) + iOS cards/controls** (best fit for an Electron desktop shop app).
> Status: PLAN ONLY — no code touched. Build phases below are proposals for a future build-mode session.

## 1. What we have today (so Apple maps cleanly)

- Tokens `frontend/src/index.css:26-76`: light `--bg #ffffff / --bg2 #f9fafb / --bg3 #f3f4f6 / --text #14532d / --muted #44604f / --glass-bg #ffffff`, dark `--bg #090d16 / --bg2 #111827` + `--app-border-radius 0.75rem`, `--app-font-size-base 14px`. Tailwind semantic only: `bg-bg/bg2/bg3/bg-glass-bg, text-text/muted, border-border` (`tailwind.config.js:9-45`). Guardrail F6 blocks raw `bg-white/black/gray-*/[#hex]`.
- Surfaces: page roots **transparent** (24 pages, e.g. `CRM/index.tsx:45`, `Settings/index.tsx:142`, shell `Layout.tsx:3346,3379`) sit on `body bg-bg`; cards paint `bg-bg border-border rounded-2xl shadow-sm`. Dropdown panels **opaque** `var(--bg2) + 0 4px 12px` (`index.css:343-346`). `.glass-panel:123-129` is solid `bg-glass-bg`, **not glass**.
- Hard bans (owner policy, guardrail E1): `*,::before,::after{backdrop-filter:none!important}:101-104`. No blur on sticky headers/cards. `animate-pulse/ping/bounce` = 3 cycles only `:116-118`; only `animate-spin` endless. Scroll `behavior:auto` instant, `.dropdown-scroll contain:layout style`, highlight via `onMouseMove` guard. Z tokens `z-dropdown 999 → z-toast 10050` (`tailwind.config.js:50-59`, `index.css:5-19`).
- Font live: `Inter,sans-serif` (`tailwind.config.js:47-49`), body `font-sans` (`index.css:469`), no webfont import (`main.tsx:1-6`). Theme: `<html class=light>` default (`index.html:2,19`), `useAppearanceSync.ts:50-73` DB `app_theme_mode light/dark/system` + `matchMedia`, UI `AppearanceTab.tsx:175-205`.

## 2. What "Apple" means here (no-blur translation)

| Apple idiom | Normal Apple way | This app's no-GPU-safe version |
|---|---|---|
| Vibrancy / frosted Sidebar, sheets | `backdrop-blur 20px` | Layered **solids**: Sidebar `bg-glass-bg + border-r glass-border`, cards `bg-bg`, nested `bg-bg2/bg3` + hairline `border-border`. Depth via 1px borders + tiny shadows only |
| SF font | San Francisco | `font-sans: -apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,...` — zero download, native on Mac, clean fallback on Windows |
| Continuous corners | 10/12/16/20pt | Drive via existing `--app-border-radius` var: cards `rounded-2xl`, modals `rounded-3xl`, pills/inputs `rounded-xl/2xl`, Sidebar active pill `rounded-xl`. Default `standard 0.75rem → 1rem` |
| macOS Sidebar | grouped + active pill | Keep `Layout.tsx:278-496` structure; restyle: section labels `text-muted 11px uppercase tracking`, items `rounded-xl`, active `bg-primary/15 + text-text + border-l-2 border-primary` (already `470-475`, soften gradient to flat) |
| iOS segmented | tabs | CRM tab strip (`CRM/index.tsx:60` `bg-bg2`) + Settings Day/Night/System cards → true `segmented` component (solid `bg-bg3`, thumb `bg-bg` + shadow-sm) |
| Sheets | rounded + drag | `BaseModal.tsx:80` already `rounded-3xl + z-modal + Esc` (`useModalEscape`). Only tune padding/shadow to `0 4px 24px rgba(0,0,0,.06)` (existing glass shadow `127-128`) |
| Tiny shadows | large blur | Keep small: dropdown `0 4px 12px`, cards `0 4px 24px + 0 1px 6px`, toasts `0 10px 30px` (`Layout.tsx:530-535`). Never large `0 25px 65px` except existing NotificationPanel — shrink it |
| Motion | springs | Keep finite: press `scale .98` via `transform` only (no `transition-all`), `behavior:auto` scroll stays, `animate-spin` loaders only |

Explicitly **OUT**: any `backdrop-blur`, translucent `bg-*/NN` dropdowns, `will-change:scroll-position`, `transition-all` on `.glass-panel`, new endless keyframes, `bg-white/black` solids, hard `z-[99999]`, `alert()/confirm()`.

## 3. Build plan (phases — for a future build session, NOT executed now)

**Phase 0 — token foundation (1 file + config)**
- `frontend/src/index.css`: extend `:root/.light/.dark` with Apple aliases **as vars only** (`--apple-label/--apple-secondary/--apple-separator` pointing at existing `--text/--muted/--border`), redefine `font-sans` stack to Apple-first, set `--app-border-radius:1rem` default, tighten `.glass-panel` to Apple card (`rounded-2xl, border glass-border, shadow 0 4px 24px`), shrink toast/shadow outliers. No new colors — aliases point at existing vars so Day/Night both work.
- `frontend/tailwind.config.js`: add `apple:` aliases mapping to vars (or reuse `bg-bg2/text-muted` — Ponytail: don't add tokens if reuse suffices). Keep F6-green.
- `frontend/src/hooks/useAppearanceSync.ts:13-38,88-90` + `Settings/AppearanceTab.tsx:129-133`: change radius presets to Apple `Compact 8 / Standard 16 / Curved 20`, keep DB keys.

**Phase 1 — chrome (Sidebar/Topbar/QuickAssist/Footer)**
- `frontend/src/components/Layout.tsx:278-496,1370-,3383-3393`: Sidebar sections + pill active, Topbar macOS toolbar (search centered, actions trailing, `React.memo` stable props preserved), QuickAssist inspector cards. No layout-tree moves (KeepAlive + SSE single `EventSource:2998` untouched).
- `ConnectedDevicesFooterBar`, `NotificationPanel.tsx:706` (`rounded-3xl → 2xl`, shadow down), `FlashToast:550` iOS banner style.

**Phase 2 — shared kit (biggest win, pages inherit)**
- `components/common/BaseModal.tsx:80`, `DataTableShell.tsx:64`, `FilterBar.tsx`, `premium-input:492-496 / premium-btn:498-502` in `index.css`, `InfiniteTable/StickyTable` headers (`bg-glass-bg` stays), all dropdowns keep `bg-bg2 + dropdown-scroll + onMouseMove` pattern (`POS:4280`, `CRM/RefillsSection:1209` as reference). Convert tab strips to one new `AppleSegmented.tsx` (used by CRM/Settings/Returns).
- Icon pass: keep current glyphs, normalize to 17px/20px + `text-muted`, active `text-text`. No new icon dep (Ponytail rung 4).

**Phase 3 — page sweep (mechanical, 24 pages)**
- Page roots stay transparent (contract). Per page: cards → Apple card, headers → large-title (`text-text 20 semibold` + `text-muted` subtitle), tables → `app-scalable-table` density stays, chips → existing 3-state (`Stock N / -0 / Master DB`) restyled as iOS pills (transparent-bg rule `677-744` respected), modals → sheet style. Order: POS → Purchases/Sells → Inventory → CRM → Dispatch/Mail/Settings → rest. Each page: visual diff + `PageQueryTracker` keys untouched.

**Phase 4 — motion + dark**
- Press states `active:scale-[.98]`, focus rings `ring-2 ring-primary/30` (no blur), re-trigger finite pulse by re-mount (existing rule). Verify dark `:57-76` contrast (muted `#9ca3af` on `#111827` already ≥5:1; light `--text #14532d` stays).
- Print/boot (`printBill.ts`, `index.html:21`) untouched — still `system-ui` + white tiles.

## 4. Verify (must all pass before any build is called done)

1. `npm run guardrails` — E1 (no `backdrop-filter`/GPU flags), F6 (no raw colors), no `setInterval/refetchInterval` regressions, single EventSource.
2. `tsc --noEmit` + ESLint (keep zero-`any` files clean, React Compiler purity: cache writes in module helpers only).
3. Theme matrix: Day/Night/System × font 13/14/15/16/18 × radius Sharp/Standard/Curved — Sidebar/Topbar/modal/dropdown/table screenshots.
4. No-GPU sanity: idle CPU same as before (no endless animations, `behavior:auto` kept), dropdown scroll smooth on software render.
5. `node scripts/quick-update.mjs` + update `frontend/AGENTS.md` UI Guidelines + `design-system/` note (durable contract change).

## 5. Risks

- True iOS translucency **impossible** under the no-GPU lock — design compensates with layered solids; blur needs an owner exception + `ALLOW` rationale + perf proof on a low PC. Not recommended.
- Full-app sweep touches ~60–80 files; risk is visual regression, not logic. Mitigation: Phase 0–2 first (tokens + chrome + kit = ~80% of the look), pages mechanical after, KeepAlive/SSE/query keys frozen.

## 6. Next decision (owner)

Reply `go pilot (tokens + chrome + POS)` or `go full (Phase 0–4)` + `macOS / iOS / hybrid` to emit the exact file:line edit list for build mode.
