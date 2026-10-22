# Protection Portal — register: admin edit time/site + delete sign-in; remove Add-sig (2026-10-12)

## What Essam asked
1. Admin option to EDIT the site and time in the register.
2. Option to DELETE the whole sign-in entry (not rely on the logs to delete).
3. Explain the "Add signature" button (asked before, never answered).

## Answer (button)
"Add signature" was a redundant shortcut: pick person → pick in/out → draw. Tapping any signature cell does the same. **Removed it** (button + listener). The dead `openRegSigPicker()` function is left unused (harmless, no listener).

## Changes
### Worker (deployed v 837aace6)
- `/api/register` now returns each sign-in's record `id` (`new_signinid`) so the app can edit/delete it. (`signins/update` + `signins/delete` admin endpoints already existed and are `/api/admin`-gated to approvers.)

### App (main 3c188e0)
- **✎ edit button** next to each sign-in/sign-out time (admin only). Opens `#editsig-modal`:
  - Time (AST) `HH:MM` input → combined with the sign-in's date, emitted as UTC ISO, PATCHed via `/api/admin/signins/update` (fields: id, datetime, site).
  - Site text input with a datalist of existing sites.
  - **Delete** button → two-step "Confirm delete?" (native confirm suppressed in Teams) → `/api/admin/signins/delete`.
  - Cancel/Save; both reload the register.
- Removed the redundant `✍ Add signature` button + its listener.
- Auto-refresh (5s) now also skips while the edit modal is open (so it can't clobber it).
- CSS: `.reg-timecell`, `.reg-edit`.

## Verified live (Worker /app)
- reg-edit=4, editsig-modal=3 (live == local bytes 822499). Worker `id: x.new_signinid` present.
- All 4 app blocks + worker pass node --check.

## Files
`scratch/live2.html` (= main/index.html), `worker/index.js` (signin id).
