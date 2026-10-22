# Protection Portal — day view + register cell cleanup + hidden-people restore (2026-10-15)

Three requests in one message; all done, app-only change (worker untouched), commit main 2cacff2, verified live.

## 1) Day view on the main grid
- New **Day** toggle (left of Week/Month/Year) in the main grid's view switch.
- `dayCols(ws)` → single column for one date; `cellDay(emp,date)` renders full detail in that one wide column: ON-CALL badge, request badges (type code, outline = not yet approved), and **real in/out times** (green = signed in at site, red = signed in outside site, blue = signed out). Tap a cell → `openDetail` drawer (same as other views).
- Prev/Next step **1 day** in Day view (week = 7, month = 1 month, year = 1 year). Switching TO Day jumps to today. Label shows the date (e.g. "15 October 2026").
- New `.b-out` badge class (blue outline) for sign-out.
- Data window for Day reuses the month fetch (week-view branch), so on-call/requests/training for that day load fine.

## 2) Register signature cells (the "two cells, one thinner")
Cause: on-screen sig-fit fix made `.reg-sigcell { min-width:84px }` while `.reg-timecell` stayed `52px` → sig cells visibly wider than time cells within a day.
Fix: sig cell min-width → 52px (matches time cell) + `justify-content:center`. Each day's 4 cells (time/sig/time/sig) now equal width. **This is screen-only — the PDF renders separately with its own 78px 4:1 sig box (untouched), so the PDF signature fit is unaffected.**

## 3) Hidden people can't be re-shown
Cause: the "Not shown (all days): … — tick their box again" strip was plain text; the visibility checkboxes only exist on VISIBLE rows, so a hidden person had no box to tick.
Fix: strip now renders a real **Show checkbox per hidden person** (name + emp #). Ticking it → `POST /api/register/exclude {employee, show:true}` → reload + re-render, person back in the grid. (Worker already supported show:true/false — no worker change.)

## Verified
- node --check all script blocks OK; worker index.js unchanged.
- Live (worker-served /app/index.html): dayCols=1, dayBtn=1, reg-vis-show≥2.
- Screen sig cells and PDF sig box are independent code paths — PDF 4:1 fit (579d85d) still in place.

## Files
`scratch/live2.html` (= main/index.html): Day view (toggle/dayCols/cellDay/prev-next/label), `.b-out` class, `.reg-sigcell` min-width 52px, hidden-people Show checkboxes. main 2cacff2.
