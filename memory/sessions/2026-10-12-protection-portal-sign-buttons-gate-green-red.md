# Protection Portal — sign buttons: gate by state + green/red (2026-10-12)

## What Essam asked
- If signed out -> can ONLY sign in. If signed in -> can ONLY sign out.
- Sign In = greenish, Sign Out = reddish (distinctive).

## Changes
### Worker (deployed v eea28b5f)
- `/api/whoami` now returns `signed_in` (bool): queries the person's allowed sign-ins for today (AST day window, same as register), takes the most recent; true iff it's a DIR_IN+allowed sign-in. Unlinked/no match -> false. (Constants DIR_IN/ALLOWED_YES used.)

### App (main a5cbfdc)
- `setSignState()`: colors + enables only the allowed button.
  - Signed in -> Sign Out red (#d64545) enabled, Sign In green (#1fa85a) DISABLED ("already signed in").
  - Signed out -> Sign In green enabled, Sign Out red DISABLED ("not signed in").
- `doSign(direction)`: hard guard — rejects the disallowed transition with a toast (defense-in-depth beyond the disabled button).
- After a successful sign: `S.me.signed_in = (direction==="in"); setSignState()` flips the buttons immediately; `finally` also re-applies state.
- `loadBase()` (whoami) calls `setSignState()` so the initial state is correct on load. 5s auto-refresh keeps `S.me` fresh.

## Verified live (Worker /app)
Live == local (823672 bytes). setSignState=1, green #1fa85a present, red #d64545 present. Worker whoami signed_in present. All blocks + worker pass node --check.

## Files
`scratch/live2.html` (= main/index.html), `worker/index.js` (whoami signed_in).
