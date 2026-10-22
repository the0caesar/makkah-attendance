# Protection Portal — register numbering, stale-data fix, autosave, sig thickness (2026-10-12)

## What Essam asked (this round)
1. Register panel numbering was still stable (gaps) — make it sequential like the PDF.
2. Signature sometimes doesn't show in register right away (time shows, sig doesn't) → not in PDF.
3. Make signature ~50% thicker.
4. (mid-turn) Signature pad opens slow after sign-in/out — couple seconds.
5. (mid-turn) App shouldn't require manual refresh to see updates; auto-refresh (~1s requested).

## Changes
### App (main 59b9a0b)
- **Register sequential numbering**: removed stable `numBy`; register now numbers visible people 1..N (same as PDF). `rows.map((p,i)` → `${i+1}`.
- **Auto-refresh**: replaced the 60s Today/Approvals-only `setInterval` with a **5s** loop on ALL screens (incl. register). Each tick: `refresh()` + `loadRegister(S_reg.date)`+`renderRegister()` (register reads from S_reg, so it must re-fetch). Guards: skip if `document.hidden`, if sig modal open, if `S.refreshing` (no overlap), and if a register field is focused (don't clobber a remark being typed). (5s, not 1s — 1s would hammer the Dataverse-backed worker; data is fresh enough.)
- **Sig pad instant**: in `doSign`, moved `promptSignature()` BEFORE the data refresh (pad opens immediately; `refresh()` runs in background instead of `await`ed first).
- **Sig 50% thicker**: `lineWidth 2.4 → 3.6`.

### Worker (deployed v 238c7ca0)
- **Root cause of stale data / missing signature**: `corsHeaders` set NO `Cache-Control`, so Cloudflare cached API GETs (up to ~4h) — a just-saved signature didn't appear. Added `"Cache-Control": "no-store"` to every API response. Verified live: `/api/whoami` → `Cache-Control: no-store`.

## Verified live
- Worker no-store header confirmed (401 + no-store).
- Served /app byte-identical to local: reg-num (i+1)=1, 5s refresh=1, 3.6 width=1, numBy=0, instant pad=1.
- All 4 app blocks + worker pass node --check.

## Files
`scratch/live2.html` (= main/index.html), `worker/index.js` (no-store).
