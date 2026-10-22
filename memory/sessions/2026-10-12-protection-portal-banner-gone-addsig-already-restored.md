# Protection Portal — banner already removed, Add-signature already restored (2026-10-12)

## What Essam asked
1. Add the "Add signature" button back. Condition: only for people who ALREADY signed (sign-in or sign-out) that day. (He noted the normal flow requires time+location+signature, so a signature is usually already captured — the button is a safety net.)
2. Remove the bottom-left debug box (looks like sign-in debugging) — "something you put and forgot."

## STATUS: BOTH ALREADY DONE — no new work
- My compacted summary was WRONG: I had recorded "Add-signature button removed" and "edit/delete not deployed", but the actual git history shows commit **a7b9e80** (Mon Oct 12 22:08, on `main` AND pushed to `origin/main`) already:
  - removed the boot debug banner (fetch wrapper + `dbg`), and
  - re-added the register Add-signature button (only people who signed that day; saves to that day's bucket).
- Verified: `scratch/live2.html` == `index.html` == LIVE (all 828,272 bytes). Live has 0 `net OK`/banner markers, and `reg-add-sig` present (button + listener + `openRegSigPicker`).

## How the Add-signature button actually works (verified in code)
- `#reg-add-sig` (Register toolbar) -> `openRegSigPicker()`:
  - Builds a `signed{}` map from `S_reg.signins` for the SELECTED day.
  - Dropdown lists ONLY people who signed in/out that day (`.filter(p => signed[p.employee])`). Empty -> "No one has signed <day> yet."
  - "Add sign-in signature" / "Add sign-out signature" -> `pick(dir)` checks `signed[emp][dir]` (else "That person didn't sign in/out this day").
  - `sigDate = S_reg.date` so `openSigModal` saves to THAT day's KV bucket (`/api/register/sig` `date: targetDate`), not hard-coded to today.
- Normal sign-in/out flow still sets `sigDate = todayISO()` (line 2885), so it saves to today.
- This matches Essam's condition exactly. He said "put the button back, we'll see if we ever use it."

## Action
Told Essam: both are already live; hard-refresh to pick up (banner gone, button present). Nothing changed this turn.

## Files
No changes this turn. `scratch/live2.html` (= main/index.html). Commit a7b9e80 (pre-existing, already pushed).
