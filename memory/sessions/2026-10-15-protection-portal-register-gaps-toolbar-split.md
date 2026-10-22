# Protection Portal — register column gaps + Today toolbar split (2026-10-15)

Essam's screenshot (Teams, 22 staff register): gaps between the day columns; and the Today page's view-toggle + date selector + Today + refresh are ONE section that stretches full-width on phone (forces horizontal scroll), while the filter row (search/sort/date/scope) wraps fine because it's multiple items. "Make it clear / split them."

Commit main 62d9942. Both verified live via CDP + vision.

## 1) Register gaps between day columns — FIXED
- Root cause (measured with the 26 real Arabic names): `#reg-table` used `table-layout:auto`, so columns sized to the WIDER of header/body. The Arabic day sub-labels (وقت الحضور…) auto-stretched day columns to ~70–76px while the body cells were fixed 62px → the leftover showed as 7px/14px gaps between columns; header drifted ~1px off the body.
- Fix: `#reg-table { table-layout: fixed }` + a `<colgroup>` generated in `renderRegister` (64 / 170 / 64 / 62×20) inserted before the thead. Header and body now share EXACT widths.
- Verified (live, real names): head and body widths identical, drifts all 0, gaps all 0, tableW 1539.

## 2) Today toolbar split — FIXED
- Root cause: `.weeknav` was ONE `display:flex` (no wrap) bar holding view-toggle + ‹ date › + Today + refresh → single non-wrapping box overflows the phone width → horizontal scroll.
- Fix: split into TWO `.wn-block` pills (view-toggle | date-nav) inside a `flex-wrap:wrap` `.weeknav`. On ≤760px the date-nav pill drops to its own full-width row (like the filter row already does). `.viewtoggle` keeps its own border; each pill has panel bg + border + radius.
- Verified (live + vision): two separate rounded pills side by side, no overlap, no right overflow; `flexWrap:wrap`; all control ids intact.

## Notes
- Headless CDP shows "—" placeholders (no auth) — irrelevant; real values on the phone.
- Deploy propagation took ~75s this time; confirmed via curl-grep for unique new strings (`wn-block date-nav`, `col style="width:62px"`) BEFORE measuring.

## Files
`scratch/live2.html` (= main/index.html): register colgroup + table-layout:fixed; `.weeknav` two-pill wrap split + mobile media query. Probes: `cdp_reggaps.py`, `cdp_toolbar.py`. Shot: `toolbar_now.png`.
