# Protection Portal — app "stuck and loading" fix: fail-fast sign-in (2026-10-12)

## Symptom
App opened to the shell (tabs + controls) but never signed in: no email, no data, no sign-in button — "stuck and loading."

## Diagnosis
- App itself healthy: worker + Pages both 200 in ~0.4s; all /api/* endpoints 401 fast (no hang/500). Headless load renders the Today shell with zero console errors.
- So NOT my register/PDF/hidden changes (those don't run at page load).
- Root cause: `ensureAuth()` (line ~2840) is `await`ed with NO timeout. Inside it, the Teams SSO path (`teamsContextProbe` → `getContext` HAS a 5s race, but `teamsSsoIdToken` → `microsoftTeams.authentication.getAuthToken` and `teamsContextEmail` → `getContext` have NO timeout). If the SSO token handshake stalls, that await never settles → app sits on the shell forever, never reaches `showAuthScreen("login")`. This is the known-fragile Teams SSO handshake (the long-standing "unexpected logout / no sign-in" issue), NOT a new bug from the register work.

## Fix (fail-fast, workaround not root-cause)
- Wrapped `ensureAuth()` at load (line ~2840) AND in `pkceLogin()` (the retry handler) with `Promise.race([ensureAuth(), 15s timeout])`. On timeout → sets `AUTH_ERR = "sign-in timed out — please retry"` → falls through to the sign-in screen (which shows the "Sign in with work account" button) instead of hanging.
- Did NOT fix the SSO handshake itself (that needs the Teams SSO / app-registration permission side — IT is a dead end per constraints). This makes a stall visible + retryable.

## Deployed
- main `5c76f42` (index.html). Verified live on Worker /app + Pages: 2 `}, 15000` guards, new build.
- No worker change needed (auth is client-side; worker endpoints all healthy).

## If it still fails after the button appears
- SSO is genuinely broken for the session. Try: reload, or sign out/in, or another device. Persistent failure = the Teams SSO token path (getAuthToken) is being refused — needs the app-registration `user_impersonation` / delegated Dataverse scope checked (IT/Entra).
