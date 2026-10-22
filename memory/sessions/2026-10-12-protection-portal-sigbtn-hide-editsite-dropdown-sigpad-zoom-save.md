# Protection Portal — sign button hide/show, edit-site dropdown, sig pad zoom + single-tap save (2026-10-12)

## What Essam asked
1. Hide the disallowed button: signed out -> ONLY see green Sign In; signed in -> ONLY see red Sign Out. (Previous fix DISABLED it; he wants it GONE.)
2. Edit-sign-in time/site: the Site field was a free-text box; make it a DROPDOWN pulled from the sites DB.
3. Sig pad "stops reacting" after zoom in/out — has to tap specific spots until it registers.
4. Has to tap Save signature TWICE before it saves.

## Changes (app only, no worker — commit a5edda5)

### 1. Hide the disallowed button — `setSignState()`
- `bi.style.display = signedIn ? "none" : ""` and `bo.style.display = signedIn ? "" : "none"`.
- Sign In = green #1fa85a, Sign Out = red #d64545 (set unconditionally on the visible one).
- Guard in `doSign` still rejects a wrong-direction tap (defense-in-depth).

### 2. Edit-sign-in site -> `<select>`
- Replaced `<input type="text" list=...>` + `<datalist>` with `<select id="editsig-site">`.
- Populated from `S.sites` (the /api/sites result, already loaded in loadBase).
- If the record's stored site isn't in the current DB list, add it as "… (not in list)" so we don't lose it; else preselect the match. No stored site -> first option.
- Save still reads `$("#editsig-site").value` (select.value = the site name).

### 3. Sig pad zoom-resilient — rewrote `openSigModal`
- Root cause: canvas backing store sized once at load dpr; after zoom the CSS size/dpr changes so `getBoundingClientRect()`-based coords desync from the backing store -> strokes land wrong / stop.
- Fix: `logicalSize()` (CSS 4:1) + `resync()` which, when dpr OR size changed, rebuilds `c.width/height` (= lw*dpr), sets `c.style.width/height` to the fixed logical px (so zoom can't stretch it), resets the transform, repaints white, and REDRAWS the committed image.
- `resync()` runs on every `pointerdown`, so the next stroke is always correct regardless of zoom.
- Switched from `onpointerdown` property to `addEventListener` (pointerdown/pointerup/pointercancel) + `ev.preventDefault()` + try/catch on setPointerCapture.

### 4. Single-tap save — `#sig-save`
- Added `sigSaving` guard + `disabled` + "Saving…" text during the await -> a second tap is a no-op (prevents double-fire / two saves).
- `saveBtn.type="button"` (no form submit risk).
- On success: `committed = data` (used by resync), close modal, toast, reload register if it's today.

## Verified live (Worker /app)
Live == local (825738 bytes). hide-display=1, `<select id="editsig-site">`=1, sigSaving=4. All 4 app blocks + (unchanged) worker pass node --check.

## Honest caveat
Can't replicate Essam's actual zoom gesture on the phone/Teams tab, so the pad fix (3) is verified by code logic, not by watching it. If it still misbehaves after a HARD refresh, need a short video of it happening.

## Files
`scratch/live2.html` (= main/index.html). No worker change.
