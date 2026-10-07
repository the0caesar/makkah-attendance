# DEPLOY HANDOFF — what Essam does, what I do

Everything else is already built and verified (local E2E 19/19, Teams zip ready).
Two small inputs from you unlock the full deploy. Then I run everything.

## A. GitHub (unlocks the public site) — ~2 min

1. Open `https://github.com/settings/tokens/new`
   - Note: "makkah-deploy" (any description)
   - Expiration: whatever you like (I delete the file after use; you can revoke the token after)
   - Scopes: check **`repo`** (the first group, all of it)
   - **Generate token**
2. **Do NOT paste it in chat.** Save it to a file instead:
   create `C:\Users\Essam Omar\AppData\Local\hermes\github_pat.txt` and paste the token in (one line, no quotes).
3. Tell me **"PAT ready"**.

→ I run `deploy/github_deploy.sh`: creates repo `makkah-attendance` (private), pushes the app, enables GitHub Pages, waits for the build, verifies the URL, deletes the PAT file.
→ Site goes live at `https://the0caesar.github.io/makkah-attendance/` (manifest placeholder already matches — no re-zip needed unless the URL differs).

## B. Azure (unlocks the API) — 2 questions + 1 click

1. **Do you have an Azure subscription?** (free tier / existing company one) — yes/no.
   - If no: tell me and we pick a fallback host for the API (decision, not a blocker for the site).
2. I install the Azure CLI and run `az login` — a **browser window appears once**; you sign in (MFA if your org asks). That's the only click.
3. Tell me **"Azure ready"**.

→ I run `deploy/az_deploy.sh`: resource group + Consumption-plan Function (northeurope, $0 within F1 grant: 1M calls/month), publishes `functionapp/` (shared `api_core` code), sets the Dataverse secrets.
→ API goes live at `https://makkah-attendance-api.azurewebsites.net` with a dev-testing header so I can smoke-test it (whoami, sign-in geofence, request lifecycle) — same 19-test suite against prod.

## C. After both (all me, no input)

- Point `app.js` `API_BASE` at the Function, re-push Pages, re-verify site + API together.
- Re-zip the Teams app if the URL changed; you distribute the zip to the 22 (or add the website tab per person — your call at that point).
- Identity: Teams SSO JWT → roster email match (built + tested locally; `X-Dev-Identity` hatch stays disabled in prod unless we want curl testing).
- Then the last spec item: reminders (30 min → every 10 min).

## Status snapshot
| Piece | State |
|---|---|
| Data model (9 tables, string location cols) | ✅ live |
| App UI + local proxy | ✅ running :8787, E2E 19/19 |
| Shared API core (proxy + Function) | ✅ refactored + re-verified 19/19 |
| Azure Function code | ✅ written (deploys on your "Azure ready") |
| Teams zip | ✅ ready (manifest URL = final Pages URL) |
| Site | ⬜ waiting on PAT file |
| API | ⬜ waiting on Azure answer + az login |
