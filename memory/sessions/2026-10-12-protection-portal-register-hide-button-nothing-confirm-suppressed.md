# Protection Portal — register hide/sig-clear "button does nothing" fix (2026-10-12)

## Symptom
Register's "–" (hide person for the day) and "✕" (clear signature) buttons did nothing on click.

## Root cause
They used the browser's **native `confirm()`**. Teams **suppresses native dialogs inside the iframe**, so `confirm()` never showed and returned false → the handler bailed → nothing happened. (The app already documented this at the site-delete handler: "two-step (native confirm() is suppressed in the Teams iframe)".)

## Fix
Converted both handlers to the app's existing **two-step "Confirm?"** pattern (same as site delete): first click arms the button → text becomes "Confirm?"; click again within 3s performs the action; auto-disarms after 3s. No native dialog.

## Deployed + verified live (main d4780b0)
- 2 × "native confirm() is suppressed inside the Teams iframe" handlers present.
- 0 × `if (!confirm(` remaining.
- Worker untouched (index.html-only commit).

## Note
Essam is confirmed an admin/approver (button only renders for approvers; he's clicking it). Separate transient: my direct Dataverse test client started 401-ing on every query (valid token, 401 with WWW-Authenticate) — did NOT block this (live worker works). Investigate separately if it recurs.

## Files
- `scratch/live2.html` (= main/index.html), `scratch/dv_approver.py` (approver check attempt).
