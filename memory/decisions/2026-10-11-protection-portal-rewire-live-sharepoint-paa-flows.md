# 2026-10-11 — Protection Portal rewire: LIVE on SharePoint via PAA flows

## What happened (one pass, user away ~1h)
- **Goal:** the SharePoint-hosted app (old 10-08 build, dead data path pointing at deleted worker/flows) rewired to the live Power Automate flows so it is fully interactive in a browser on work PCs (SEC firewall allows only MS domains; `api.powerplatform.com` + `sharepoint.com` reachable).
- **Result: DONE + DEPLOYED.** Same URL, new version: `https://seccomsa.sharepoint.com/sites/Prot_Mak/Shared%20Documents/Protection%20Portal/ProtectionPortal.html` (786,344 bytes, verified live).

## Verified (evidence)
1. **CORS from the page:** fetch(POST) from a seccomsa.sharepoint.com page (CDP 9333) → flow run URL → 200 + readable JSON body. Gateway preflight 204: `ACAO:*`, `Allow-Methods: GET,POST,PUT,DELETE,PATCH,HEAD`, `Max-Age:7200`.
2. **Proxy E2E:** `PP proxy` (recreated, fid 8b6610a3) — roster GET returns the app's exact `{value:[…]}` shape with real employees; DV errors wrap as 500 `{ok:false, error:"dataverse_call_failed", dv:{…}}`.
3. **Signin E2E:** `PP op signin` (recreated, fid 4fbfb12a) — real POST → 200 `{ok:true,id:null}`; a real row was created in `new_signins` (employee `00000`, note "E2E test 2026-10-11 - delete me" — **left in data; Essam deletes via admin log**).
4. **Deployed file:** 200, byte-size match, new signed-URL sigs present, old sigs absent.

## Key bugs found/fixed
- **Signin flow window was HARDCODED 450–930 (07:30–15:30 AST)** instead of reading `shift_start`/`shift_end` settings (live settings = 00:00–23:59 = no block). Rebuilt settings-driven: two filtered `new_settingses` GETs + `coalesce(body('Get_start')['value'][0]['new_value_str'],'06:30')`. Reads live on every sign-in attempt.
- **Proxy guard was too broad** (blocked ALL non-GET `new_signins`) → admin log delete/edit (app lines ~1137/1154) would 403. Now blocks **POST only**.

## PAA platform gotchas (new, cost 5 recreations)
1. `lambda()`/`filter`/`any`/`select` expressions FAIL at runtime in this env ("property 'X' cannot be selected") despite passing template validation. Use plain indexing `body('Get')['value'][0]['col']`.
2. `body('Action')` is an auto-parsed **Object** — `json(body(…))` errors; `outputs('X')?['body/value']` compound keys misbehave.
3. Run-history UI = ground truth: `https://make.powerautomate.com/environments/{env}/flows/{fid}/runs/{runName}` (CDP 9222 browser) shows failed action + exact expression error; the run-details API gives only top-level.
4. No flow-update endpoint (POST/PUT 404) → **delete + recreate**. Create: `POST /flows?api-version=1`, props `displayName` (not `workflowName`), no `state` field, spaces OK in displayName.
5. SAS run URLs (listCallbackUrl) must be called WITHOUT `Authorization` (401 `DirectApiRequestHasMoreThanOneAuthorization` otherwise).

## Identity / Teams
- Page keeps MSAL work-account sign-in (id_token → roster match). Flows ignore the Bearer header (trigger auth None); window check is server-side.
- **Manifest v1.0.12** (`teams/protection-portal-1.0.12.zip`): web-tab `contentUrl` → the SharePoint file URL, `validDomains` updated. Page CSP `frame-ancestors` allows `teams.microsoft.com` (embedding MAY work — untested; XFO is SAMEORIGIN). SSO-in-Teams still dead (August 2026).

## Remaining for Essam
1. Open the live URL on a work PC → sign in → real sign-in/out (first human E2E).
2. Delete the `00000` test row (Admin → sign-in log).
3. Want a real hard window? Set `shift_start`/`shift_end` in Admin → Settings (e.g. 06:30/18:30) — flow reads them live.
4. Optional: sideload v1.0.12 zip to test the Teams web tab.

## Git
- `e21b2fd` — app rewire (URL swap in deploy/github/ProtectionPortal.html)
- `6f77531` — SPEC log + build state + manifest v1.0.12 + SP deploy file
