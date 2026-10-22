# Protection Portal — hide per-day, header bidi fix, storage model (2026-10-12)

## Per-day hide/show people (DONE)
- New Worker endpoint: `POST /api/register/hidden` (admin only). Body {date, employee, action:"remove"|"add"}. Stored in the SAME KV as sigs/remarks: key `day:<date>` → { sigs, remarks, hidden:[empNos] }.
- `GET /api/register` now also returns `hidden: []`.
- App: register table + PDF both filter out hidden people (clean sequential numbering). Per-row "–" button (admin) hides a person for THAT day only (does NOT delete the roster record). A dashed "Hidden this day" strip under the table lets admin re-show them.
- Why per-day, not delete: deleting the roster record would wipe all their history. Hiding is per-day and reversible.

## Day/date header bidi fix (DONE)
- Was jumbled: mixing LTR date `12 / 10 / 2026` in an RTL string scattered the number to the edge / reversed the year.
- Fix: `.dd` is now flex-centered with 3 isolated fields — `اليوم : الثلاثاء` (rtl), `التاريخ :` (rtl), `12 / 10 / 2026` (dir=ltr, unicode-bidi:isolate). Verified via CDP render: reads correctly, number not stranded, year not reversed.

## Storage model (answer to Essam)
- **Sign-in/out time, site, GPS** → **Dataverse** (permanent, `new_signins`).
- **Signatures + remarks + hidden list** → **Cloudflare KV** (`REG_SIGS`), key per day, $0.
- **PDF** → **NOT stored.** Generated on demand when "Download PDF" is clicked, rebuilt fresh from Dataverse (time/site) + KV (signatures/remarks/hidden). No per-day PDF archive exists. (If Essam later wants archived PDFs per day, that needs new storage + a generation job — not built yet.)

## Deployed
- main `a71e03c` (index.html). Worker deployed (reg-hide hidden endpoint wired, /app serves new index — verified reg-hide=2, hidden-api=2, siteOf=2 on both Pages + Worker, bytes 813755).
- Worker hidden endpoint: 401 (wired + auth required).

## Files
- `scratch/live2.html` (live source → main/index.html), `worker/index.js` (hidden endpoint), `scratch/cdp_h2c4.py` + `scratch/h2c_header.png` (header bidi render verification).
