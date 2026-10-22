# Protection Portal — week-view date bug + day-view width + register sig cell (2026-10-15)

Essam: (1) week view shows "Sunday October 15" but it's Thursday; (2) day view (now default) still very wide, person column covers date when scrolling; (3) register sig cell shows a smaller cell inside the cell. Also: "if I click Today it fixes the whole thing."

Commits main c8b200b → f1ab020. All verified live via CDP + pixel sampling.

## 1) Week-view wrong weekday — FIXED
- Root cause: `weekCols()` labeled columns **by position** (Sun,Mon,Tue…) from wherever `S.weekStart` pointed. Since default `S.weekStart = new Date()` (today = Thu 15), "Sun" landed on the 15th. Clicking "Today" snapped the anchor to the real Sunday → that's why it "fixed it."
- Fix (two-part): `weekCols` now labels each column by its **actual weekday** (`new Date(d+"T12:00:00").getDay()` → DAYN[wd]), so the header is always correct. AND the view-toggle, when entering week view, sets `S.weekStart = startOfWeek(S.weekStart)` so the week grid always shows the **Sun→Sat** week containing the anchor.
- Verified live: week label "11 Oct – 17 Oct", headers `Sun10-11 … Thu10-15` — Thursday now correctly under Thu.

## 2) Day view too wide / overlap — FIXED
- Root cause: base `table.grid { min-width:760px }` forced the 2-column day table wider than the phone → horizontal scroll → sticky Person column covered the date column.
- Fix: day view class caps width: `table.grid.day { min-width:0; max-width:540px; margin:0 auto; table-layout:fixed }`, Person 40% / date 60%. Now fits the viewport → no scroll → no overlap.
- Verified live: `cssMax:540px`, `fits:true`, no overlap.

## 3) Register signature "cell inside a cell" — FIXED
- Root cause: the signature `<img>` carried `background:#fff` sized by its OWN tiny dimensions → a small white box floating in the dark cell (and the ✕ button took horizontal room).
- Fix: the **signed cell itself** is the white box — `td.reg-sigcell.has-sig { background:#fff; padding:3px 4px }` (added `has-sig` class in the render). The ink is transparent + `object-fit:contain` inside it. The ✕ is now a **position:absolute overlay** in the top-left corner (no layout push). Matches the PDF's white 4:1 sig box.
- Verified by **pixel sampling** (definitive, since the vision model misread it as still "box-in-box"): cell region is 255,255,255 top-to-bottom, ink (17,17,17) only in the middle row → white box fills the cell.
- Note: PDF is a SEPARATE code path (its own 78px 4:1 box) — untouched.

## Also (from this message's earlier items, already done)
- Names on one line (`.reg-name` nowrap), day sub-cells even width (62px) — carried in.

## CRITICAL LESSON this session (measurement gotcha)
The headless CDP Chrome page was **stuck on the old live URL**; my `file://` navigations weren't landing, so "local" measurements were silently reading the OLD deployed CSS and looked like my edits "weren't applying." Also the live deploy has a **~30s propagation delay**. FIX: always `curl` the live `/app/index.html` and grep for the new rule BEFORE measuring, use `Network.setCacheDisabled` + `Page.reload ignoreCache`, and when vision and pixel/geometry disagree, **trust pixels** (`getpixel`) over the vision model's narrative.

## Files
`scratch/live2.html` (= main/index.html): weekCols actual-weekday + week-toggle Sunday anchor; `.day` grid width cap; `.reg-sigcell.has-sig` white box + `.sig-img` transparent contain + `.reg-sigclear` overlay. Probes: `cdp_verify_final.py`, `cdp_final_shot.py`, `cdp_pixel.py`. Shots: `reg_final.png`.
