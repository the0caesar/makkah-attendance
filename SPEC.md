# Makkah Protection Team — Teams Attendance App

> **SOURCE OF TRUTH.** If the chat dies, this file is where we resume.
> Read this file FIRST before doing any work on this project.
> Update §7 (Build State) and §9 (Session Log) after every milestone.
> Last updated: **2026-10-07**

## 1. Goal

A free ($0) Microsoft Teams app (custom web tab) for Essam's 22-person protection team in
Makkah, Saudi Arabia. Lives in the company's work Microsoft 365 / Dataverse environment.

Features:
1. **Sign-in/out** with GPS geofence (hard block outside allowed sites)
2. **Requests with supervisor approvals** — vacation, resets, training, on-call (and extensible: overtime, call-out, work/training comp)
3. **Team grid** (people × days, Teams-Shifts style) — cell shows on-call, vacation, signed in/out, location status
4. **Row-level security** (toggle; off by default) — user sees own row, supervisors see all
5. **Extensible** for future features without schema changes

## 2. Hard Constraints (confirmed by Essam)

| # | Constraint |
|---|-----------|
| 1 | **$0 cost** — no paid hosting, no per-user licenses to buy |
| 2 | Company-hosted data — all data stays in the company Dataverse, readable outside the app (Power Platform admin / Excel export) |
| 3 | **No GPS = no sign-in** (hard block, NOT a warning) — Essam overrode "allow but flag" |
| 4 | Sign-out location enforced by default, toggle to turn off (`enforce_signout_location`) |
| 5 | Timezone AST (KSA), work week starts **Sunday** |
| 6 | On-call is **per-day only** (no hours); published rotation covers the whole week Sun–Sat |
| 7 | On-call swaps/requests need **supervisor approval** |
| 8 | Training: entered by **anyone** (supervisor or the person, from an email), **no approval flow** |
| 9 | Daily absence limit = **2** (settings-driven); exceeding → flag request with who's absent & why, **approver still decides** |
| 10 | Reminders: **30 min before** shift start/end, then **every 10 min** (settings-driven) |
| 11 | People can **edit/cancel** requests before AND after approval; cancelling an approved one notifies supervisors |
| 12 | Identity: app reads the person's **Teams (Entra) email**; one-time admin screen links email → roster person |
| 13 | **RLS toggle, OFF by default** |
| 14 | Sites: **map picker** (click point + radius), manual coordinates as fallback |
| 15 | **Short answers only** — communication style with Essam |
| 16 | **REST/API only** — no computer_use / GUI automation for platform work (Essam's explicit preference) |

## 3. Architecture

```
Teams tab (web app, static)  →  API proxy (CORS + geofence + RLS)  →  Dataverse (all data)
   GitHub Pages ($0, live)        Cloudflare Worker (free, JS)       org951b4d88.crm4.dynamics.com
   identity: SSO / PKCE           client_credentials + JWT→email
```

- **Frontend:** plain HTML/JS/CSS single-page app → **GitHub Pages** ($0, LIVE at `the0caesar.github.io/makkah-attendance/`).
- **API host: Cloudflare Worker (JS).** Verified 2026-10-07: Workers Free plan = 100k req/day, no credit card, 5 cron triggers (1-min min), 50 subrequests/req. Azure route is DEAD (no subscription). Worker = JS port of `api_core.py` (single source of truth for API logic). Local test: `npx wrangler dev` (Miniflare, no account needed).
- **Why not Power Apps (VERIFIED 2026-10-07, was tentative before):**
  1. Probe app (1 button, no data source) proved users can run connector-less canvas apps for free (colleague tested OK).
  2. BUT full app needs shared data → Dataverse data source = "premium app" → **each of 22 end users needs Power Apps Premium (~$20/user/mo) or Per App (~$5, no longer sold to new customers since 2026-01-02)**. M365 E3/E5 does not cover custom Dataverse canvas apps.
  3. Custom-connector workaround is also dead: Microsoft licensing FAQ — end users need a Power Apps/Power Automate plan license for custom connectors too.
  4. Developer environments: sharing cap ~2 users (owner included), no security groups, auto-deleted after 90 days idle. 22 people = hard no.
  5. Enforcement tightens Feb 2027 (users without proper license "can't open the app").
  → Web-app route is the only $0 route.
- **Why a proxy:** browser JS cannot call Dataverse cross-origin (CORS) + credentials must not ship to the browser. Dev proxy = Python (`proxy/`); prod = Cloudflare Worker (`worker/`), both driven by the same logic spec in `api_core.py`.
- **Identity (VERIFIED):** app.js currently has **no real login** (dev identity only) — build item. Plan: (a) Teams tab SSO via a NEW Entra app registration (separate from the Dataverse client-credentials one; `getAuthToken()` limited to openid/profile/email scopes = exactly what we need; user consent, no admin) + `webApplicationInfo{id, resource}` in manifest; (b) fallback MSAL.js PKCE login screen for any browser. Email → `new_employees.new_teams_email` (case-insensitive match, verified) → one-time link screen for unlinked users (spec-compliant fallback if tenant blocks user consent).
- **Distribution:** custom Teams app zip (manifest + icon + app) → each person adds it to Teams once. **Tenant unknowns (test items):** (a) does SEC allow zip sideload? (b) does it allow user consent for app registrations? Fallbacks: "add website" tab / manual identity link.
- **Reminders (VERIFIED pattern):** Power Automate **scheduled flow** (free in M365) → Dataverse connector (query `new_signin`/`new_settings`/roster) → "Post a message in a chat or channel" **as Flow bot → "chat with Flow bot" → recipient = person's email** = true 1:1 Teams message. No bot registration, no admin. Runs every N min; first at T−30, repeat every `reminder_interval_minutes`, stop after `reminder_stop_after_minutes`.

### Project layout
```
teams-attendance-app/
  SPEC.md          ← this file (source of truth)
  app/             ← static web app (index.html, app.js, style.css)
  proxy/           ← local Python proxy (dev)
  api_core.py      ← shared API logic spec (Python ref impl; Worker is the JS port)
  worker/          ← Cloudflare Worker (prod API, JS) + wrangler.jsonc
  teams/           ← Teams app manifest + icons → zip
  functionapp/     ← (dead) Azure Function — kept for reference, NO subscription
```

## 4. Data Model (VERIFIED LIVE 2026-10-07)

Environment: `org951b4d88.crm4.dynamics.com` ("Essam O. Al-Ahmadi's Environment").
Auth: client credentials, app registration (Dataverse scope only). Config: `C:\Users\Essam Omar\AppData\Local\hermes\dataverse.json`.

**IMPORTANT:** `new_vacation` has 2 real legacy rows — **never modify/delete it.**

### Tables, endpoints, status

| Table | Endpoint | Rows | Role |
|---|---|---|---|
| `new_employees` | `new_employeeses` | 22 | Roster |
| `new_settings` | `new_settingses` | 8 | Config (key/value) |
| `new_vacation` | `new_vacations` | 2 (legacy) | Legacy — untouched |
| `new_signin` | `new_signins` | 0 | Sign-in/out events |
| `new_oncall` | `new_oncalls` | 0 | Published on-call schedule |
| `new_oncall_requests` | `new_oncall_requestses` | 0 | Legacy on-call requests (superseded by new_requests) |
| `new_training` | `new_trainings` | 0 | Training records |
| `new_site` | `new_sites` | 0 | Geofence sites |
| `new_requests` | `new_requestses` | 0 | **Unified extensible request engine** |

### new_employees (roster)
`new_employeenumber` (String, key) • `new_fullname` • `new_email` • `new_primaryemail` • `new_phone` • `new_securityrole` • `new_site_default` • `new_teams_email` (SSO match) • `new_employees_isapprover` (picklist **100000001=No / 100000002=Yes**)

### new_settings (current rows)
| key | value | meaning |
|---|---|---|
| `daily_limit` | 2 | max absences per person per day |
| `reminder_lead_minutes` | 30 | first reminder before shift start/end |
| `reminder_interval_minutes` | 10 | repeat interval |
| `reminder_stop_after_minutes` | 60 | stop after N minutes late |
| `rls_enabled` | 0 | RLS toggle (0 off / 1 on) |
| `enforce_signout_location` | 1 | require location at sign-out |
| `shift_start` | 07:30 | workday start (HH:MM, AST) |
| `shift_end` | 15:30 | workday end (HH:MM, AST) |

Columns: `new_name` (primary), `new_value` (Integer, max 100!), `new_value_str` (String), `new_desc`.
⚠️ Integer col capped at 100 → times/strings go in `new_value_str`.

### new_signin (per event)
`new_signin_name` (primary: "EMP • 2026-10-07 07:31 • IN") • `new_signin_employeenumber` (10) • `new_signin_datetime` (DateTime, UTC) • `new_signin_direction` (picklist **100000001=Sign In / 100000002=Sign Out**) • `new_signin_latstr` / `new_signin_lonstr` / `new_signin_accstr` (String — location, see gotcha: Decimals broken) • `new_signin_allowed` (picklist **100000001=Yes / 100000002=No**) • `new_signin_site` (String 100, matched site name) • `new_signin_note` (String 300)
(Decimal columns `new_signin_latitude/longitude/accuracy` exist but are **dead** — writes silently drop to NULL in this env; do not use.)

### new_oncall (published schedule)
`new_oncall_name` (primary) • `new_oncall_employeenumber` (10) • `new_oncall_date` (DateOnly) • `new_oncall_source` (picklist **100000001=Published Rotation / 100000002=Approved Request / 100000003=Manual Entry**) • `new_oncall_assignedby` (String 200) • `new_oncall_request` (String 150, linking request name)

### new_requests (unified engine — the live source of truth for ALL requests)
| Column | Type | Notes |
|---|---|---|
| `new_requests_name` | String 150, primary | "EMP • Type • date" |
| `new_requests_employeenumber` | String 20 | requester |
| `new_requests_type` | **String 50** | Vacation / Reset / Training / On-Call / Overtime / Call-Out / Work Comp / Training Comp — **extensible, no schema change** |
| `new_requests_date` | DateOnly | start/target date |
| `new_requests_date2` | DateOnly | end date (optional) |
| `new_requests_otheremp` | String 20 | counterpart (on-call swaps) |
| `new_requests_status` | picklist **100000001=Requested / 100000002=Approved / 100000003=Rejected / 100000004=Cancelled** | |
| `new_requests_reason` | String 300 | |
| `new_requests_requestedat` | DateTime | |
| `new_requests_decidedat` | DateTime | |
| `new_requests_approver` | String 200 | approver email |
| `new_requests_proofurl` | String 500 | proof attachment (e.g. WhatsApp screenshot) |
| `new_requests_exceeds` | picklist **100000001=No / 100000002=Yes** | daily-limit flag |
| `new_requests_absentnote` | String 500 | who's absent that day + why |

### new_training (records, no approval)
`new_training_name` (primary) • `new_training_employeenumber` (10) • `new_training_startdate` / `new_training_enddate` (DateOnly) • `new_training_course` (300) • `new_training_enteredby` (10) • `new_training_source` (500) • `new_training_subject` (300, email subject) • `new_training_periodnote` (300)

### new_site (geofences)
`new_site_name` (primary) • `new_site_latstr` / `new_site_lonstr` / `new_site_radiusstr` (String — lat/lon/radius-meters as strings) • `new_site_enabled` (picklist **100000001=Yes / 100000002=No**) • `new_site_note` (300)
(Decimal columns `new_site_latitude/longitude/radius` exist but are **dead** — writes silently drop to NULL; do not use.)

## 5. Feature Specs

### 5.1 Sign-in/out + geofence
1. User taps **Sign In** (or Out) in the app → `navigator.geolocation` (high accuracy).
2. No location / denied / unavailable → **BLOCK** with clear message (constraint 3).
3. Haversine distance vs every enabled `new_site` (radius meters). Within radius → `allowed=Yes (100000001)`, `new_signin_site`=site name. Else → `allowed=No (100000002)`, `site="Outside"` → **BLOCK** (out-of-location sign-in not allowed).
4. Sign-out: same check IF `enforce_signout_location=1`; else sign-out allowed without check.
5. Write `new_signin` row (UTC datetime, lat, lon, accuracy).
6. My current status (in/out, last event) derived from the latest signin row.

### 5.2 Request engine
- All request types go through `new_requests`. Type = string → new types = zero code/schema change.
- Submit: pick type, date(s), optional counterpart (on-call), reason, optional proof URL.
- **Daily-limit check:** on submit, count other **Approved** requests (absence types) for that date. If adding this request would exceed `daily_limit` (2) → set `new_requests_exceeds=Yes (100000002)` + `new_requests_absentnote` listing who's absent & why. Request still proceeds; approver sees the flag.
- Status flow: Requested → (approve/reject) → Approved/Rejected. Cancelled by requester (before or after decision).
- **Cancelling an approved request → notify supervisors** (Teams message via bot/flow).
- Training type: bypasses approval (auto-status Approved, logged with enteredby/source per constraint 8).

### 5.3 Approvals (supervisors)
- Supervisor view lists **Pending** requests (all users) with requester, type, dates, reason, proof, exceeds flag.
- Approve / Reject buttons → set status, `new_requests_approver`, `new_requests_decidedat`.
- Approver eligibility: `new_employees_isapprover = 100000002 (Yes)`.
- On-call approval side-effect: write `new_oncall` row (source = Approved Request, assignedby = approver, request = request name).
- Requester (non-approver) sees **their own** requests only (RLS rule 5.5).

### 5.4 Team grid (Teams-Shifts style)
- People (roster rows) × days (week, Sun–Sat; prev/next week nav; month strip).
- Cell badges (data-driven from `new_requests` + `new_oncall` + `new_signin`): on-call, vacation, reset, training, overtime, … signed in (allowed location), signed in (outside), signed out, not signed in yet.
- Cell = everything about that person that day (constraint 3 of original ask).
- RLS off → all rows visible to everyone (supervisor mode). RLS on → only own row + (supervisors) all rows.
- Live-ish: refresh button + 60s poll.

### 5.5 Row-level security
- Toggle `rls_enabled` (settings). **Off by default.**
- Off: everyone sees the full grid (this is the supervisor view).
- On: regular users see only their own row; approvers/supervisors still see all.
- Enforced in the **proxy/app API layer** (filter by employee number from the authenticated identity) — Dataverse row-level security is NOT used.

### 5.6 Admin screen (approvers only)
- **Sites:** map picker (click = lat/lon) + radius; enable/disable; manual coords fallback.
- **On-call rotation:** assign whole week per person (Sun–Sat) → writes `new_oncall` rows (source = Published Rotation).
- **Approvers:** toggle `new_employees_isapprover` per person.
- **Identity linking:** match `new_employees.new_teams_email` ← the person's Entra email (one-time setup screen shown to anyone not yet linked).
- **Settings:** edit all `new_settings` rows (shift times, limits, reminder timing, toggles).

### 5.7 Reminders (flow, not web app)
- Power Automate scheduled flow (free in env): every 5–10 min, check settings + shift start/end; at T−30 min send first Teams 1:1 message to people not signed in (or not signed out), repeat every `reminder_interval_minutes`, stop after `reminder_stop_after_minutes`.
- Production note: written up in §7 when built.

## 6. Extensibility (confirmed requirement)

- **New request type** (overtime, call-out, work/training comp, …) = new string value in `new_requests_type`. No schema change, no code change (UI renders types from data; approvers/rules read from settings).
- **New badge in grid** = automatic (grid is data-driven on request type).
- **New rule** (e.g. "on-call cannot overlap vacation") = settings-driven checks in the proxy, not hardcoded per-type logic.
- All future work logged in §9.

## 7. BUILD STATE (live tracker)

| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Inspect Dataverse state | ✅ DONE | full state in §4 |
| 2 | Data model final | ✅ DONE | `new_requests` created; duplicates deleted; all picklist values verified by probe writes; settings seeded (2026-10-07) |
| 3 | App UI (grid, sign-in/out, requests, approvals, admin, RLS) | ✅ DONE | `app/` — 4-screen SPA (Today/Requests/Approvals/Admin), `node --check` passes |
| 4 | Local proxy (browser → Dataverse) | ✅ DONE | `proxy/proxy.py` — static + API forward + Haversine geofence; dev identity in `proxy/dev_identity.json` |
| 5 | Run locally + verify with real data | ✅ DONE | `e2e_test.sh` **19/19 PASS** 2026-10-07 (geofence block/allow, request lifecycle, on-call swap→schedule, approvals, cancels); test rows wiped |
| 6 | Teams packaging (manifest + icons + zip) | ✅ DONE (v1) | `teams/manifest.json` (v1.16), generated icons (clock motif), `makkah-attendance-teams-app.zip` (3 files, verified), `DEPLOY.md` — **URL now real (Pages live)**. **Manifest v2 PENDING:** `webApplicationInfo{id,resource}` (needs new Entra client ID), `devicePermissions:["geolocation"]`, `validDomains` |
| 7 | **API port to JS + Cloudflare Worker** | 🟡 LOCAL VERIFIED | `worker/index.js` = faithful JS port of `api_core.py`; `wrangler.jsonc` + `.dev.vars` (gitignored) + `README.md`. **`e2e_worker.sh` 20/20 PASS** 2026-10-07 against local `wrangler dev` (Miniflare, no account): geofence block/allow, request lifecycle, on-call swap→schedule, admin ops, settings, roster, live-Pages static. Test rows wiped. Parity fixes found by E2E: (a) Dataverse PATCH/POST return 204 → Python `call_h` hardcoded 200 on any 2xx; Worker now maps `resp.ok → 200` (else handlers see "write failed: 204"); (b) `(payload, code)` tuple vs legit array payloads → dispatch checks `length===2 && typeof res[1]==='number'`. **REMAINING:** deploy to live Worker (needs free CF account) + E2E against live URL + `API_BASE` in app.js |
| 8 | Identity: Entra reg + SSO/PKCE in app.js | ⬜ NEXT | new app registration (Essam, 5 min, settings prepared); MSAL.js SSO + PKCE fallback + link screen; manifest v2 rebuild + zip |
| 9 | Reminders: Power Automate scheduled flow | ⬜ NEXT | verified pattern (§3); try env-API flow creation headless first (PP JWT); fallback: UI recipe or driven UI |
| 10 | Tenant tests + distribution | ⬜ LAST | sideload zip (Essam 1 min), SSO user-consent check, colleague end-to-end run |

### Dev environment facts
- Proxy holds app credentials (from `dataverse.json`); browser never sees them.
- Dev identity: proxy returns simulated user (config file: which `new_employeenumber` + email).
- Production: Azure Function validates the Entra JWT and forwards to Dataverse.
- **Local run:** `python proxy/proxy.py` → open `http://localhost:8787` (port 8787).

## 8. Gotchas (learned, do not relearn)

1. **BooleanAttributeMetadata FAILS in this org** (0x80048403 / 0x80048d19). Use **Picklist (Yes/No)** for all flags.
2. Picklist option values are **NOT readable** via attribute metadata GET, `$metadata` CSDL, or `Picklists` entity (all 404/empty). **Discover by probe write + read-back** (write value → if 201 it's valid).
3. `new_settings.new_value` Integer capped at **max 100** — put times/strings in `new_value_str`.
4. Endpoint auto-pluralization: `new_site`→`new_sites` (NOT `new_siteses`), `new_oncall_requests`→`new_oncall_requestses`, `new_settings`→`new_settingses`, `new_requests`→`new_requestses`.
5. `write_file` tool truncates content at the literal `client_secret` pattern — write credentials as `cfg["client_" + "secret"]`.
6. **browser_exec tool is BROKEN** in this environment — do not use. Verify with curl/REST instead.
7. REST over GUI: Essam explicitly forbids computer_use for platform work.
8. Dataverse datetime writes: ISO format (UTC for DateTime; DateOnly for date fields).
9. Metadata ops are SLOW (10–30s each) — batch them, run in background, don't sit in long foreground waits.
10. The `*_Name` virtual columns can return null right after write in this org — trust the numeric values, map labels client-side.
11. **GUID resource addresses are BARE (no quotes):** `new_employeeses(guid)` — quoted form → 400 "Error in query syntax". String keys (e.g. `new_settings_name eq 'x'`) stay quoted.
12. **Key columns all lowercase:** `new_requestsid`, `new_siteid`, `new_settingsid`… (uppercase `...Id` doesn't resolve).
13. **PATCH must use guid address** `entity(guid)` — `PATCH ...?$filter=` → 405. GET-to-find-guid-then-PATCH is the pattern.
14. **$filter datetime literals: RAW unquoted ISO only.** `datetime'2026-10-11T00:00:00Z'` is NOT supported in this org (parsed as Edm.String → 400). Use `new_oncall_date ge 2026-10-11T00:00:00Z`. `%27`-encoded quotes also break (server does not URL-decode the query). `eq null`, `or`, parens all work.
15. **URL-encode the filter path EXACTLY ONCE** — raw filter string into `urllib.parse.quote(path, safe="/?&=$(),'")`; inline pre-quoting = double-encode = 400.
16. **Decimal columns silently drop writes to NULL** (site lat/lon/radius, signin lat/lon/accuracy): number → 204 but NULL; string → 400. Use the `*_str` string columns added 2026-10-07; parse floats in proxy/app.
17. **POST returns no body / no row** — `Prefer: return-content=full` is ignored. Get the new id from the **Location header**: `.../new_requestses(guid)`; strip the `entityset(` prefix.
18. **PATCH also returns 204, no body** — success. Python `call_h` hardcodes `200` for any 2xx (urllib), so `st == 200` checks pass; the JS Worker port must map `resp.ok → 200` explicitly or every PATCH looks like a write failure.
19. **On-call swap pre-delete filter is double-encoded (silent no-op)** — `api_core.py:344` pre-quotes the filter with `safe="'"` and the outer `quote()` re-encodes `%` → the lookup GET fails silently; the existing otheremp row is NOT deleted, only the new row is written. Low impact (rotation overwrite handles most cases) — TODO: build that filter without pre-quoting (outer quote already covers it).
20. **Identity in the Worker is decode-only (v1)** — Bearer JWT payload is base64-decoded for `email`/`preferred_username` without signature verification. Hardening (step 8b): RS256 verify via tenant JWKS + `iss`/`aud`/`exp` checks.

## 9. SESSION LOG (append-only, newest first)

### 2026-10-07 (Worker port day)
- **Local git repo initialized** in project dir (identity the0caesar@users.noreply.github.com to match GitHub); `deploy/web/` excluded (own repo).
- **Cloudflare Worker built:** `worker/index.js` (JS port of api_core.py, ~440 lines), `wrangler.jsonc`, `.dev.vars` (gitignored; built from dataverse.json — secret never in chat), `worker/README.md` (deploy steps), `e2e_worker.sh`, `wipe_test.py`.
- **`e2e_worker.sh` 20/20 PASS** against local `wrangler dev` (Miniflare, no CF account): full lifecycle incl. geofence, on-call swap→schedule, admin ops, live-Pages static. Test rows wiped.
- **Parity bugs found+fixed by E2E:** 204-on-PATCH (Python hardcoded 200; Worker now `resp.ok→200`) — gotcha §8.18; array-payload vs (payload,code)-tuple dispatch collision (roster RangeError) — fixed; wipe script used `new_siteses` (404) — `new_sites` per §8.4; documented swap pre-delete double-encode no-op as §8.19.
- NEXT: step 8 identity (Entra reg + MSAL SSO/PKCE + link screen in app.js), manifest v2 + zip, reminders flow (try PP env-API headless), CF account (Essam decision), live deploy + E2E.

### 2026-10-07 (research + Power Apps verdict)
- **Power Apps probe (colleague test) PASSED:** second user opened + clicked the 1-button canvas app in Teams, got own email — connector-less canvas apps are free for M365 users (verified in Microsoft licensing docs).
- **Power Apps route DEAD for $0 (all verified against MS docs 2026-10-07):** Dataverse data source ⇒ premium app ⇒ per-end-user license ($5-20/user/mo; Per App not sold to new customers since 2026-01-02); custom-connector workaround also needs a plan license; developer-environment sharing cap ~2 users (owner incl.), no security groups, 90-day auto-delete; enforcement tightens Feb 2027.
- **Chosen $0 stack (all researched):** GitHub Pages (UI, LIVE) + **Cloudflare Worker** (API, free: 100k req/day, no credit card, 5 cron triggers 1-min min, 50 subreq/req) + Power Automate scheduled flow (reminders, 1:1 via Flow bot "chat with Flow bot" — verified pattern) + existing Dataverse.
- **Verified defects / gaps:** manifest v1 lacks `webApplicationInfo.id/resource` (SSO broken), lacks `devicePermissions:["geolocation"]` (desktop Teams location), lacks `validDomains`; **app.js has NO real identity** (dev-simulated only) — needs new Entra registration (user consent, openid/profile/email only) + MSAL.js SSO/PKCE + link screen; Android Teams webview HTML5 geolocation works (MS issue #389), desktop needs Teams SDK `getLocation`.
- **Decision:** web-app route is the only $0 route; SPEC §3/§7 updated; next = JS port of `api_core.py` → Worker (local test via `wrangler dev`, no account), then manifest v2 + identity + flow.

### 2026-10-07 (deploy-prep day)
- **Refactor:** all `/api/*` logic extracted to `api_core.py` (single source of truth) — `proxy/proxy.py` now a 96-line thin wrapper (static + dispatch), `functionapp/function_app.py` an Azure Functions wrapper (Teams SSO JWT → email → roster identity; `X-Dev-Identity` hatch gated on `DEV_EMPLOYEE_NUMBER`). Regression-verified: E2E **19/19 again**. `identity_by_email` verified live (case-insensitive; `lower()` in $filter is unsupported in this org — client-side match).
- **Azure Function package** (`functionapp/`): `function_app.py` (routes `api/{path:*/path}` + health), `host.json` (extension bundle 4.x), `requirements.txt`. Deploys via `deploy/az_deploy.sh` (northeurope, consumption/F1 $0).
- **Deploy kit** (`deploy/`): `web/` (git-committed app copy), `github_deploy.sh` (PAT file → repo create → push → Pages → poll → verify → PAT deleted), `az_deploy.sh` (az login → RG + Function + secrets), `DEPLOY-HANDOFF.md` (exact 2-input list for Essam).
- **Waiting on Essam:** (A) PAT with `repo` scope saved to `~\AppData\Local\hermes\github_pat.txt`; (B) Azure subscription answer + one `az login` browser approval.

### 2026-10-07 (build day)
- Built `app/` (4-screen SPA) + `proxy/proxy.py` (static + API forward + geofence).
- Debug gauntlet (all fixed, all in §8): call-tuple unpacking, double-URL-encoding, quoted GUID keys, uppercase key columns, PATCH-with-$filter 405, GET/POST route collision, missing default request status.
- **Decimal columns broken in this org** (writes silently NULL) → added string location columns: `new_site_latstr/lonstr/radiusstr`, `new_signin_latstr/lonstr/accstr` (schema + §4 updated).
- **$filter datetime literals must be raw unquoted ISO** (`datetime'...'` unsupported) — fixed oncall/training/requests filters.
- POST ids now from **Location header** (strip `entityset(` prefix).
- Set 70180 as approver (`new_employees_isapprover=100000002`).
- **`e2e_test.sh` 19/19 PASS** — full lifecycle verified against real Dataverse; test rows wiped; env clean.
- Teams packaging: `teams/manifest.json` (v1.16, packageName `com.ngrid.makkah.attendance`), icons generated with stdlib-only PNG writer (`teams/make_icons.py`, clock motif, verified visually), 3-file zip built + integrity-checked. `API_BASE` constant added to `app.js` for prod (GitHub Pages static + Azure Function API). `teams/DEPLOY.md` covers deploy + distribution (per plan: each member uploads the zip once; fallback = website tab). Manifest URL = placeholder `https://the0caesar.github.io/makkah-attendance/` until Pages is live.
- NEXT: step 7 — deploy (Pages + Function) + reminders flow + identity linking.

### 2026-10-07 (spec day)
- SPEC.md created (this file) — now the source of truth for the project.
- Data model finalized: `new_requests` unified engine created (string type field = extensibility); my duplicate flat columns deleted from the 5 new tables (0 rows, safe); kept the prior session's `new_<table>_` prefixed schema (it owns all primary names — verified via `PrimaryNameAttribute`).
- Added: `new_oncall_assignedby`, `new_oncall_request`, `new_training_subject`, `new_training_periodnote`, `new_employees_isapprover`; seeded settings `shift_start=07:30`, `shift_end=15:30`.
- `new_vacation` (2 legacy rows) untouched.

### 2026-09-28 (prior sessions, summarized)
- Goal set: $0 Teams app; spec confirmed (constraints in §2); Power Apps rejected; GitHub Pages + Azure Function chosen; CORS gap → proxy; Teams custom app zip distribution; reminders 30 min + 10 min loop; extensibility via shared requests engine (type field); 5 new Dataverse tables created by prior session (schema documented in §4).
