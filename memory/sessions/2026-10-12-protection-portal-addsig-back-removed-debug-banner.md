# Protection Portal — re-add register Add-signature (signed-only) + remove debug banner (2026-10-12)

## What Essam asked
1. Re-add the "Add signature" button (removed earlier as redundant), with the condition: only people who ALREADY signed that day. (He reasoned a signature normally completes sign-in, so this is a rare fallback — add it anyway and "we'll see if we ever use it".)
2. Remove the bottom-left debug banner that appears on app open ("looks like debugging for signing in ... something you put and forgot").

## 1. Debug banner — removed entirely (was my own diagnostic)
- Removed the `window.fetch` wrapper that logged every request to the banner.
- Removed `function dbg()` + `function dbgDone()` (created `#dbg-banner`, bottom-left red box).
- Removed all `dbg(...)`/`dbgDone()` call sites (DOM ready, auth guard, refreshAll, error).
- Verified: 0 references to `dbg`/`__dbg`/`dbg-banner` in the file.
- The 15s SSO fail-fast guard and the "Failed to load" toast remain (those are real, not diagnostic UI).

## 2. Add-signature button — re-added with the signed-only condition
- Button `#reg-add-sig` ("✍ Add signature") added to the register bar (between Refresh and Download PDF); wired to `openRegSigPicker()`.
- Rewrote `openRegSigPicker()`:
  - Builds `signed[emp] = {in, out}` from `S_reg.signins` for the LOADED day.
  - Dropdown lists ONLY people with a sign-in/out record that day (`.filter(p => signed[p.employee])`).
  - If nobody signed that day: shows "No one has signed <date> yet."
  - Two buttons: "Add sign-in signature" / "Add sign-out signature". `pick(dir)` validates the person actually signed that direction (`signed[emp][dir]`) before opening the pad.
- **Storage-date bug I caught & fixed:** the pad's Save always wrote to `todayISO()`. So adding a past day's signature would wrongly save to today.
  - Added `sigDate` global. Set at every pad-open path:
    - `promptSignature` (post sign-in/out, Today screen) -> `sigDate = todayISO()`.
    - `openRegSigPicker` pick -> `sigDate = S_reg.date` (the selected day).
    - register sig-cell tap -> `sigDate = S_reg.date`.
  - Save handler now uses `const targetDate = sigDate || todayISO();` and POSTs `/api/register/sig` with that date; reloads that day's register.
  - This means you CAN now backdate a signature to a past day (saves to that day's KV bucket) — answers the earlier "can't add to a past date" caveat.

## Verified live (Worker /app)
Live == local (828272 bytes). dbg-banner/function dbg = 0. reg-add-sig = 2 (button + listener). All app blocks pass node --check. No worker change.

## Files
`scratch/live2.html` (= main/index.html). Commit a7b9e80.
