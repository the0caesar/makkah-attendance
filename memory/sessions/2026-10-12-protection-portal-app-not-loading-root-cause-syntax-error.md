# Protection Portal — "app not loading" ROOT CAUSE (2026-10-12)

## Root cause (verified, not theory)
A **syntax error I introduced in the hide-person feature** (commit a71e03c, "register/PDF filter hidden") — an extra `)` in the hide-button handler:

```js
if (!confirm("Hide this person from today's register & PDF?"))) return;   // 3 close parens
```

That one stray `)` is a parse error in the **entire app `<script>` block**, so **zero JavaScript runs**: no sign-in, no data load, date field stuck at `dd/mm/yyyy`, body blank dark, Teams loading bar spinning. Exactly the user's screenshot.

## Why I missed it (lesson)
My "APP SYNTAX OK" checks used `max(re.findall(...), key=len)` — they only validated the **largest** script block (the 290KB MSAL block), NOT the 128KB app-logic block where the error was. **False positive.**

## Fix (deployed + verified)
- Removed the stray `)` → `if (!confirm("...")) return;`
- Checked **ALL 4 script blocks** individually with `node --check` → ALL OK.
- Pushed to main, deployed. Verified live: stray `)` count = 0, fixed count = 1, 0 JS errors on fresh load.
- Local / git-main / live are byte-identical (816280 bytes).

## Also added (diagnostic, now in the app)
- `dbg()` persistent red banner (bottom-left, monospace) that logs boot stage + every fetch URL/status/ms. Shows exactly where boot is if it ever gets stuck again. Auto-removed on successful load.
- fetch wrapper logs each request to the banner while the banner is present.

## Process rule (going forward)
- Syntax-checking an HTML file with inline scripts: check EVERY script block, not just the biggest. Use the per-block loop, never `max(key=len)`.

## Files
- `scratch/live2.html` (= main/index.html), `scratch/_b*.js` / `scratch/_l*.js` (per-block node checks), `scratch/cdp_dbgcheck.py` (live boot banner check).
