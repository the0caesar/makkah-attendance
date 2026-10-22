# Protection Portal — weekly register (kashaf format) — 2026-10-15

## What Essam asked
Use the format of the real hand-filled weekly kashaf Excel ("كشف الحضور والانصراف - دائرة الحماية مكة.xlsx"): clean it, keep only our 26-person list, make the app collect it weekly (Sun–Thu). No more daily PDFs — signatures are auto-collected at sign-in/out so the PDF is just an archive artifact. "Set it up and we'll refine as we go."

## Changes

### Worker (deployed v 0890129a)
- New `GET /api/register/week?date=<any day>`: returns the Sun–Thu week containing that date — `{ week_start, days:[{date, signins[], vacations[], sigs{}, remarks{}}], roster, exclude }`. Per-day Dataverse sign-in query (same AST day window as daily) + per-day KV `day:<date>` sigs/remarks. Week start = most-recent-Sunday math (`dow` days back; verified Sat/Fri anchor to previous week's Sunday).

### App (main 53ad31d)
- **Register screen → weekly grid**: 2-row header (#, Name, Emp # + 5 day columns each with Arabic weekday+date, sub-columns وقت الحضور/التوقيع... actually 4 sub-columns per day: in-time, in-sig, out-time, out-sig — 5×4=20 day cells + 3 = 23 body cells). People sorted by ID, sequential 1..N, exclude checkboxes (permanent, all days) per row.
- **Week navigation**: `‹ ›` prev/next week buttons + date picker (any day → its week). `weekKey(iso)` = Sunday of its week; re-loads only when the week changes.
- **Admin tools preserved, now per-day**: ✎ edit time/site (per-day cell, modal stores date), delete sign-in, ✕ sig clear (per-day, two-step confirm), tap a sig cell to add/edit that person's sig for that day (saves to that day's KV bucket via `sigDate`).
- **Add signature button**: now person + day dropdowns; condition = only people who signed that direction ON THAT DAY (verified per-day from the 5 days of the week).
- **Weekly PDF** (`regPdf` rewritten): A4 portrait, title "سجل توقيع الحضور اليومي لموظفي دائرة الحماية والإختبارات" + "مدير الدائرة وموظفوه", week line "الأسبوع رقم : N (start - end) year" (ISO-8601 week number auto-calculated from the week's Wednesday), logo top-right, 5-day header grid, rows = visible people (26) with per-day in-time/in-sig/out-time/out-sig, vacation shows إجازة. Multi-page slicing if the week overflows one A4 page (canvas slice + addPage). Filename `attendance-register-<week_start>.pdf`.
- Auto-refresh re-loads the current week (`loadRegister($("#reg-date").value || S_reg.week_start)`).
- CSS: sticky first row + sticky #/Name/Emp# columns, `.reg-dayhead`, `.reg-subh`, `.reg-timecell`, `.reg-sigcell`, `.vac`.

## Verified
- All 4 app blocks + worker pass node --check. Week math verified with node (2026-09-20 Sun → same week; 2026-09-26 Sat → previous week).
- Live app markers present (weekKey=5, weekly PDF filename, exclude handler, reg-thead). `/api/register/week` returns 401 (wired, auth-gated).
- CDP mock render: `{"rows":4,"head1":8,"head2":13,"bodyCells":23,"status":"2026-10-04 → 2026-10-08 • 4 staff"}` — correct 5-day structure. Vision-confirmed the grid renders (day columns Sunday–Thursday, sub-columns, person rows).

## Template diff (reference)
Real kashaf file has 41 people; app roster is 26. In template not app: 16 (incl. 97585 تركي الهذلي the one Essam removed). In app not template: 105586 رأفت علي بنا. Template is blank (0 filled times) — it's the form, not data.

## Honest caveats
- PDF week number = ISO-8601 week of the week's Wednesday; Essam may want to correct the "official" week number visually later (he said refine as we go).
- The screen grid shows both time+sig for in AND out per day (4 cells/day); the real Excel only has حضور/انصراف columns (2/day) since the physical sheet writes times+signatures into 2 columns. May refine to match exactly if he wants.
- CDP screenshot was of a mock dataset (unauthenticated headless), not real data.

## Files
`scratch/live2.html` (= main/index.html), `worker/index.js`. Commits: main 53ad31d, worker 0890129a. Mock render: `scratch/week_grid2.png`.
