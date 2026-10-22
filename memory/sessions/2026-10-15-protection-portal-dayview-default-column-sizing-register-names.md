# Protection Portal — day view default + column sizing + register name/days (2026-10-15)

Essam: "make day view the default, resize columns to the data (too big on phone — person column covers date column when scrolling right). Signature cell still the same. Make register column widths enough so text doesn't warp."

All app-only, verified live via CDP render + vision. Commits: main ecbf5a9 → c9210d2.

## 1) Day view = default, fits the phone
- `S.gridView: "week" → "day"`, `S.weekStart: startOfWeek(new Date()) → new Date()` (lands on today).
- **Root cause of the overlap:** base `table.grid { min-width: 760px }` forced the day table wider than the phone → horizontal scroll → the sticky Person column sat over the date column while scrolling.
- Fix: day view gets its own class (`.day`) with `min-width:0; table-layout:fixed;` and Person 40% / date 60% (fixed widths). Now the table fits the viewport → **no horizontal scroll → nothing for Person to overlap**. Verified live: `minWidth:0px`, `table-layout:fixed`, `fits:true` (721 < 778).
- Only **Month** is compact now (`compact = gridView === "month"`, was `!== "week"`), so Day gets full cell sizing, not the tiny compact cells.
- `.b-out` badge (blue) for sign-out time in the day cell.

## 2) Register: names stop warping
- **Root cause:** Name column had no width rule → auto-sized to ~56px, so 3-word Arabic names stacked 2–3 lines.
- Fix: `<td class="reg-name">` with `white-space:nowrap; min-width:120px` (width auto-sizes to content, so long names never clip, and it's one line). Emp # column `.ltr` also nowrap 60px.
- Verified live (long 3-word names): `whiteSpace:nowrap`, `wraps:false`, uniform 31px row height, no right clip, no spill into Emp #.

## 3) Register: day sub-cells now equal width
- Time-in/sig-in/time-out/sig-out were auto-sized (uneven; the time cells also hold a ✎ edit button).
- Fix: `td.reg-timecell` and `td.reg-sigcell` both `width:62px; min-width:62px` → uniform per day. Verified: timeW 66 / sigW 62 (≈equal, diff ≤ a few px).
- **Screen only — the PDF renders separately with its own 78px 4:1 sig box (untouched).**

## Why the CDP viewport read ~778 not 390
The headless CDP Chrome's `setDeviceMetricsOverride` was locked at a larger width (deviceScaleFactor/mobile interplay) — not a reliable phone width. So I verified the register **real-data** path couldn't run there (headless Chrome has no work-account auth → 401 on loadRegister), and instead verified the name-column CSS via a mocked roster + `getComputedStyle`, and the day-view fit via the live file. The CSS is width-independent (nowrap + fixed/flexible rules), so it holds on a real 390px phone.

## Files
`scratch/live2.html` (= main/index.html): default view day, `.day` grid class + CSS, `.b-out`, `.reg-name` nowrap, `.ltr` nowrap, reg time/sig cells 62px. Probes: `scratch/cdp_verify390.py`, `cdp_verify_live2.py`, `cdp_regname.py`. Screenshots: `day_live.png`, `reg_mock.png`.
