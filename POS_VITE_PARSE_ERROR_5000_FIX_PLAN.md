# Implementation Plan: Fix Vite Parse Error at POS/index.tsx:5000

## 1. Problem Description
Vite with OXC parser reported:
```
[PARSE_ERROR] Unexpected token. Did you mean `{'}'}` or `&rbrace;`?
      ╭─[ src/pages/POS/index.tsx:5000:18 ]
 5000 │                 )}
```

## 2. Root Cause
In `frontend/src/pages/POS/index.tsx`:
- Line 4650 opened: `<div ref={searchResultsRef} className="absolute left-0 right-0 top-full z-[100] mt-2 bg-bg2 border border-border rounded-2xl overflow-hidden shadow-2xl flex flex-col [will-change:scroll-position]">`
- Line 4705 opened: `<div className="max-h-72 overflow-y-auto flex-1 divide-y divide-border/10">`
- Line 4733 opened: `<div className="flex flex-col">`
- Line 4998 closed: `</div>` (for line 4733)
- Line 4999 closed: `</div>` (for line 4705)
- Line 5000 had: `)}` directly, without closing the outer `searchResultsRef` div from line 4650.
Because the JSX element `<div ref={searchResultsRef} ...>` was still unclosed, the parser treated `)}` as raw text inside a JSX element, failing with unexpected token.

## 3. Tasks Completed
- [x] Analyze AST structure and opening/closing tag pairs around lines 4418–5004.
- [x] Add the missing `</div>` tag at line 5000 before `)}`.
- [x] Run typescript typecheck / build validation to ensure no parse errors or compilation errors remain (`npx tsc --noEmit` exited 0).
- [x] Run mandatory guardrails (`npm run guardrails` passed with 0 violations).
- [x] Update bug register in `SMALL_BUG_FIX_PLAN.md` (P1-35).
- [x] Run knowledge graph update (`node scripts/quick-update.mjs` synced).
