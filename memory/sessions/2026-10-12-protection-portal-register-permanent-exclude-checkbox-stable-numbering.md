# Protection Portal — register: permanent exclude checkbox + stable numbering (2026-10-12)

## What Essam asked
1. Make the hide control a **check-mark box**: checked = person IS shown, unchecked = NOT shown.
2. It must be **permanent (all days / forever)**, not just today.
3. When hidden, the person **stays in place — the list does NOT renumber/drop**.
4. The register list must be **sorted by employee number**.

## Implementation
### Worker (deployed v d055c389)
- New `POST /api/register/exclude` (admin only). Body `{employee, show}`. `show=true` -> include (remove from list), `show=false` -> exclude. Stored in KV key `reg.exclude` (global list, applies to ALL days).
- `GET /api/register` now also returns `exclude: []` (the global list).
- (Per-day `reg.hidden` / `POST /api/register/hidden` still exist in worker but are no longer used by the app.)

### App (main b5c5bf0)
- Replaced the "–" two-step button with a **checkbox** (`.reg-vis`) in the # cell, admin only. Change fires `POST /api/register/exclude` with `show = cb.checked`, then reloads.
- **Stable numbering**: number = each person's rank in the FULL roster sorted by employee number (numBy). Hiding a person leaves the others' numbers unchanged. Applied to BOTH on-screen register and PDF.
- Register rows sorted by employee number (numeric) — was localeCompare before.
- People who are hidden don't disappear from the roster; a "Not shown (all days):" strip lists them (admin) with their names + #. Status line shows "N not shown".
- PDF filters the global `exclude` set (not per-day hidden), same stable numbering.
- Added CSS for `.reg-numcell / .reg-num / .reg-vislab / .reg-vis`.

## Verified live
- exclude endpoint: 401 (wired + auth).
- served /app: reg-vis=1, api/register/exclude=1, S_reg.exclude=4, numBy=2.
- All 4 app script blocks + worker pass node --check.

## Files
- `worker/index.js` (exclude endpoint + GET exclude field), `scratch/live2.html` (= main/index.html).
