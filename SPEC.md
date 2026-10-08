# Makkah Protection Team — Teams Attendance App

> **SOURCE OF TRUTH.** If the chat dies, this file is where we resume.
> Read this file FIRST before doing any work on this project.
> Update §7 (Build State) and §9 (Session Log) after every milestone.
> **DURABLE LOG (Essam's standing instruction, 2026-10-07):** EVERYTHING discussed or decided
> about this app — requirements, corrections, design decisions, "refine later" items — gets logged
> here (session log + relevant sections). Nothing app-related lives only in chat.
> Last updated: **2026-10-07 (night — shifts redefinition logged; focus = perfecting sign-in/out)**

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
- **Delivery / auto-refresh (2026-10-08, v1.0.6):** the Teams tab's `contentUrl` now points at the **Worker** (`...workers.dev/app`), which proxies the Pages files with `Cache-Control: no-cache, must-revalidate` (HTML) / `max-age=600` (assets). Result: **the tab always gets the current build the moment it's opened — no more new zips after v1.0.6.** The Pages site is the content origin; the Worker is the freshness gate. `webApplicationInfo.resource` + `validDomains` were moved to the workers.dev origin (SSO resource rule = iframe origin).
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
**Primary key = `new_signinid` (GUID).** `new_signin_name` ("EMP • 2026-10-07 07:31 • IN") is a *display column*, NOT the key — string-key resource addressing (`new_signins('…')`) 400s in this org (see gotcha #24). Address/PATCH/DELETE by `new_signinid`. • `new_signin_employeenumber` (10) • `new_signin_datetime` (DateTime, UTC) • `new_signin_direction` (picklist **100000001=Sign In / 100000002=Sign Out**) • `new_signin_latstr` / `new_signin_lonstr` / `new_signin_accstr` (String — location, see gotcha: Decimals broken) • `new_signin_allowed` (picklist **100000001=Yes / 100000002=No**) • `new_signin_site` (String 100, matched site name) • `new_signin_note` (String 300)
(Decimal columns `new_signin_latitude/longitude/accuracy` exist but are **dead** — writes silently drop to NULL in this env; do not use.)

### new_oncall (published schedule)
**Primary key = `new_oncallid` (GUID)** (address/delete by it, not `new_oncall_name`). • `new_oncall_name` (display: "OC • EMP • date") • `new_oncall_employeenumber` (10) • `new_oncall_date` (DateOnly) • `new_oncall_source` (picklist **100000001=Published Rotation / 100000002=Approved Request / 100000003=Manual Entry**) • `new_oncall_assignedby` (String 200) • `new_oncall_request` (String 150, linking request name)

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
- People (roster rows) × days — with **view toggle: Week / Month / Year** (built 2026-10-08):
  - **Week** (default): 7 day columns, full badges.
  - **Month**: all days of the month (compact chips: `OC`, `VAC`, `RST`, `TRN`, `OVT`, `CO`… + sign-in dot ●; weekends shaded; click a day → detail).
  - **Year**: 12 month columns with per-month **counts** (`3 OC`, `2 VAC`…; click a month → drills into that month's view).
  - Prev/Next nav steps per view (week / month / year); "Today" recenters. Data window auto-matches the view (Worker `$top=10000` on oncall/requests/training so a year never truncates).
- **Filter/sort toolbar** (built 2026-10-08): search rows by name/number; sort rows (Name A→Z / Z→A / Number); **status filter on a chosen day** (date input, default today): On-call / Vacation / Reset / Training / Overtime / Call-Out / Other / **Free** / Signed in (site) / Signed in (outside) / Signed out / No sign-in.
- Cell badges (data-driven from `new_requests` + `new_oncall` + `new_signin`): on-call, vacation, reset, training, overtime, … signed in (allowed location), signed in (outside), signed out, not signed in yet.
- Cell = everything about that person that day (constraint 3 of original ask).
- RLS off → all rows visible to everyone (supervisor mode). RLS on → only own row + (supervisors) all rows.
- Live-ish: refresh button + 60s poll.

### 5.5 Row-level security
- Toggle `rls_enabled` (settings). **Off by default.**
- Off: everyone sees the full grid (this is the supervisor view).
- On: regular users see only their own row; approvers/supervisors still see all.
- Enforced in the **proxy/app API layer** (filter by employee number from the authenticated identity) — Dataverse row-level security is NOT used.

### 5.6 Admin screen (admins only)
- Terminology: **"admin"**, not "approver" (UI + API error text). `is_approver` is the internal field; display is "admin".
- **Sites:** map picker (click = lat/lon) + radius (meters — UI label "Radius (m)"); enable/disable; manual coords fallback.
- **On-call rotation:** assign whole week per person (Sun–Sat) → writes `new_oncall` rows (source = Published Rotation).
- **Logs:** newest-first sign-in/out list (last 30 days). Admin can **edit** (direction, site, allowed, note) and **delete** any record via `/api/admin/signins/update` + `/api/admin/signins/delete` (addressed by `new_signinid` GUID).
- **Approvers:** toggle `new_employees_isapprover` per person.
- **Identity linking:** match `new_employees.new_teams_email` ← the person's Entra email (one-time setup screen shown to anyone not yet linked).
- **Settings:** edit all `new_settings` rows (shift times, limits, reminder timing, toggles).

### 5.8 Shifts (REAL work shifts — **NOT** on-call; redefined by Essam 2026-10-07 night)
**CORRECTED UNDERSTANDING (supersedes the v1 "schedule hub" interpretation):** "Shifts" = the team going **on shifts** — work periods lasting **a month-ish** (less than, equal to, or more than a month). This is a *different beast* from on-call (on-call stays as its own per-day feature, untouched).

A shift (per Essam) has at least:
- **Type** — a selectable kind of shift (list of types TBD with Essam)
- **How many people** — headcount of the shift
- **Shift in-charge** — who leads the shift
- **Duration** — start/end (weeks/months; "<, =, or > 1 month")
- "…and all of that" — details to be refined with Essam

**Status:** the currently-live Shifts tab (shift-hours card + on-call week) was built under the *old* (wrong) interpretation as a best-effort v1. It **remains as a placeholder** (shift-hours card is still useful — it's the Ramadan lever) but the **on-call week section does NOT represent shifts** and the tab will be **reworked** to the real shift model once designed with Essam.

**Design + data model (NOT yet built — discuss with Essam tomorrow):**
- Likely a new entity (e.g. `new_shifts`): type (string, extensible like request types), headcount, in-charge (person), start date, end date, plus members (m:m or list). Exact schema = TBD, to be confirmed before building.
- UI: shift list (active/upcoming/past) + create/edit (admin) + grid integration (people × days shows which shift a person is on).
- Relationship to grid: a person "on a shift" should be visible in the team grid for the shift's date range.
- Open questions for Essam: shift type list? Can a person be on two shifts? How does sign-in/out relate to being on a shift (does it affect the time window)? Approval flow for creating shifts (admin only)?

### 5.7 Reminders (Worker cron, v1)
- **v1 (BUILT, LOCAL VERIFIED 2026-10-07):** Worker cron trigger `*/5 * * * *` (free, 1 of 5) → `scheduled()` reads settings + roster + today's sign-ins + approved absence requests → pure `reminderPlan()` computes who is due (T−`reminder_lead_minutes` first, repeat every `reminder_interval_minutes`, stop after `reminder_stop_after_minutes`; AST/UTC+3 math; skips people with approved absence today; latest signin direction wins) → POSTs `@email …` to a **Teams channel incoming-webhook** (`REMINDER_WEBHOOK_URL` secret, @email mentions notify the person). Dev dry-run endpoint `/api/reminders/plan?now=…` (dev hatch only, never sends).
- **Why not the Flow-bot 1:1 (v2):** PP environment-scoped API `powerautomate` namespace 401s on the portal's MSAL token (no cloud-flow scopes on that client; Graph probe token expired) — a scheduled flow needs an admin/tenant path we can't verify headless. Channel @mention satisfies the functional requirement (T−30, every 10 min, stop-after) with zero setup cost. **v2 upgrade = 1:1 via Flow-bot flow or bot**, when the tenant allows it (needs Essam's UI time or admin).

## 6. Extensibility (confirmed requirement)

- **New request type** (overtime, call-out, work/training comp, …) = new string value in `new_requests_type`. No schema change, no code change (UI renders types from data; approvers/rules read from settings).
- **New badge in grid** = automatic (grid is data-driven on request type).
- **New rule** (e.g. "on-call cannot overlap vacation") = settings-driven checks in the proxy, not hardcoded per-type logic.
- All future work logged in §9.

## 7. BUILD STATE (live tracker)

> **FOCUS (Essam 2026-10-08):** perfect the sign-in/out experience.
> **2026-10-08 done:** grid views (Week/Month/Year) + filter/sort toolbar — BUILT, deployed, manifest v1.0.5.

| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Inspect Dataverse state | ✅ DONE | full state in §4 |
| 2 | Data model final | ✅ DONE | `new_requests` created; duplicates deleted; all picklist values verified by probe writes; settings seeded (2026-10-07) |
| 3 | App UI (grid, sign-in/out, requests, approvals, admin, RLS) | ✅ DONE | `app/` — 4-screen SPA (Today/Requests/Approvals/Admin), `node --check` passes |
| 4 | Local proxy (browser → Dataverse) | ✅ DONE | `proxy/proxy.py` — static + API forward + Haversine geofence; dev identity in `proxy/dev_identity.json` |
| 5 | Run locally + verify with real data | ✅ DONE | `e2e_test.sh` **19/19 PASS** 2026-10-07 (geofence block/allow, request lifecycle, on-call swap→schedule, approvals, cancels); test rows wiped |
| 6 | Teams packaging (manifest + icons + zip) | ✅ DONE (v1) | `teams/manifest.json` (v1.16), generated icons (clock motif), `makkah-attendance-teams-app.zip` (3 files, verified), `DEPLOY.md` — **URL now real (Pages live)**. **Manifest v2 PENDING:** `webApplicationInfo{id,resource}` (needs new Entra client ID), `devicePermissions:["geolocation"]`, `validDomains` |
| 7 | **API port to JS + Cloudflare Worker** | ✅ LIVE | Deployed **2026-10-07 15:44** to `https://makkah-attendance-api.makkah-attendance-api.workers.dev` (free account `e126c504…`, subdomain registered via API `PUT /workers/subdomain` — POST 405s on OAuth auth, gotcha §8.23). `DV_CLIENT_SECRET` set (expires 2028-08-11). **LIVE-VERIFIED:** health 200, CORS preflight 204 + correct `access-control-allow-origin`, real identity `whoami` → 70180 Essam Al-Ahmadi (linked, non-dev), site create, geofence sign-in 0m allowed / 2273km blocked. Cron `*/5 * * * *` armed (no-ops until `REMINDER_WEBHOOK_URL` secret). Live test rows wiped. **REMAINING:** point app `API_BASE` at this URL at cutover (needs the Entra client_id first, step 8) |
| 8 | Identity: Entra reg + SSO/PKCE in app.js | 🟡 LIVE, PENDING USER SIGN-IN | **Registration created by Essam 2026-10-07** (self-service worked for CREATE; VIEW/config still 401 — no role; client ID captured from paused screen-recording: **`0cf32ba0-241d-4518-aa93-039664318a28`**). **Verified from my side without portal access:** PKCE authorize probe (client + Web redirect `https://the0caesar.github.io/makkah-attendance/` + code_challenge) → AAD returned the sign-in page (no AADSTS error = client valid, redirect registered, public-client-flow accepted). **Cutover pushed to Pages:** `API_BASE` → live Worker + real client_id (verified live). **Headless click-through test:** live site → auth screen → click → AAD pre-fills `70180@sec.se.com.sa` → MFA code wall (expected; only user can complete). Manifest `webApplicationInfo{id, resource: api://<tenant>/<client>}` + zip rebuilt. **REMAINING:** Essam signs in once in his own browser (fresh session → should auto-pass) → SSO live-verified → sideload zip test |
| 9 | Reminders | 🟡 LOCAL VERIFIED | **v1 = Worker cron + channel-webhook @mention** (§5.7): `reminderPlan()` pure + `scheduled()`; `test_reminders.mjs` 10/10 PASS (windows, 10-min boundaries, stop-after, latest-direction, vacation exclusion); live dry-run `/api/reminders/plan?now=2026-10-08T04:00:00Z` returned correct due list vs live data; `e2e_worker.sh` still 20/20. **REMAINING:** team creates channel incoming-webhook (30 s) → `wrangler secret put REMINDER_WEBHOOK_URL` → enable. 1:1 Flow-bot = v2 (tenant-dependent) |
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
21. **PP environment-scoped API: `powerautomate` namespace ≠ `powerapps` scopes** — a valid `api.powerplatform.com` MSAL token (from the make.powerapps.com portal) gets 200 on `powerapps/apps/*` but **401** on `powerautomate/flows` (supported versions: 2024-10-01, 2026-05-01-preview, …). The portal's client app (a8f7a65c) has no cloud-flow scopes in its `.default` set; no flow token in the MSAL cache; mgmt-provider path 404s. ⇒ cloud flows can't be created headless from the portal session; use Worker cron instead (chosen) or admin/interactive path.
22. **`node --check` on `worker/index.js` always fails (false alarm)** — no `type:module` in package.json, Node 26 checks it as CJS and chokes on `export`. Check via a `.mjs` copy: `cp worker/index.js /scratch/wchk.mjs && node --check wchk.mjs`. Same trap as the app.js browser-ESM note (§8.17-era).
23. **workers.dev subdomain registration API = `PUT`, not `POST`** — `POST /accounts/{id}/workers/subdomain` → 405 "Method not allowed for this authentication scheme" (that message is misleading: it's the method, not the auth). Correct: `PUT /accounts/{id}/workers/subdomain` with body `{"subdomain": "<name>"}` (NOT `{"name": …}` → 400 "Subdomain '' is invalid"). Wrangler's `wrangler deploy` interactive prompt can't be answered in a non-PTY terminal (silently falls back to "no"). Also: fresh workers.dev hostnames fail TLS handshake (`SEC_E_ILLEGAL_MESSAGE`) for ~1–2 min after deploy — cert propagation; DNS resolves immediately, don't panic.
24. **String-key resource addressing FAILS in this org** — `new_signins('EMP • 2026-10-07 18:34 • OUT')` (quoted string key) → 400 "Error in query syntax", same as the GUID-quoted case (gotcha #11). Every entity here has a `<name>id` GUID key (`new_signinid`, `new_oncallid`, …) that IS the real primary key; the `*_name` column is a *display* string. **Address/PATCH/DELETE by the bare GUID** (`new_signins(guid)`), and filter by the display name with `$filter=... eq '…'` only to FIND the guid first. The old on-call delete used the string key → silently deleted nothing.
25. **On-call lookups used `datetime'…'` literals + string-key deletes → both broken in this org (FIXED 2026-10-07).** The `new_oncall_date eq datetime'…T00:00:00Z'` filter (gotcha #14) 400s (parsed as Edm.String), so on-call assign pre-delete + remove never matched; combined with gotcha #24 the deletes no-op'd. Fix: raw unquoted ISO in the filter (`new_oncall_date eq 2026-10-07T00:00:00Z`) + `DELETE new_oncalls(guid)` by `new_oncallid`. Apply to all three on-call sites (assign pre-delete, remove, request-swap pre-delete).
26. **`/api/signins` history window** was `?days=2` (only last 2 days) — too short for the admin Logs tab. Bumped to `?days=30` (Worker still caps `$top=500`). Side benefit: the grid now shows sign-in badges for past weeks when navigated.

## 8b. BACKLOG (UI polish — deferred per Essam 2026-10-07)
1. **Grid shows REJECTED requests as absence badges** (rejected vacation still visible on the calendar with "rejected"). Decide: grid should show approved absences only (+ optionally pending with a distinct marker). Filter lives in `requestsFor()` (app.js, currently excludes only cancelled).
2. **No reason/comment on approve/reject** — approver email is recorded, but no free-text comment. (Schema check needed: does new_requests have a comment/reason column for decisions? `new_requests_reason` exists on the request itself.)
3. **"Recently decided" list can't be cleared** — auto-prunes after 7 days (`cutoff = now-7d`); Essam wants a manual clear.
4. **On-call editor is duplicated** — the new Shifts tab AND the Admin → On-Call sub-tab both assign/remove on-call. Consider collapsing the Admin sub-tab into a pointer to the Shifts tab once Essam confirms the Shifts design. (Refine later.)

### BUILT 2026-10-07 (this round — done, not backlog)
- **Shifts tab (v1 placeholder — REWORK DUE):** built under the old "schedule hub" interpretation; Essam redefined Shifts as real work shifts (see §5.8). Keep the shift-hours card (Ramadan lever); the on-call-week section does NOT represent shifts. **Next: design real shift model with Essam.**
- **Admin → Logs** sub-tab: edit (direction/site/allowed/note) + delete sign-in records, keyed by `new_signinid`.
- **Terminology** → "admin" (UI + API error text). **Radius (m)** label on the Sites table.
- **Time-window hard block** live (07:30–15:30 AST; reads configured shift_start/shift_end). **Number-match identity** live.

## 9. SESSION LOG (append-only, newest first)

### 2026-10-08 (saved-site map: in-app edit)
- **Ask (Essam):** "when I click map on a saved site, open the same map we use to locate it, and give the option to edit that site specifically."
- **Done:** row button **🗺️ Map** (replaces the external Google link) opens the **same in-app satellite map** centered on that site at zoom 16, pin placed on it, **name + radius pre-filled** from the site. Button reads **Save changes** → PATCHes that site's name/lat/lon/radius → list refreshes (loadBase). New-site flow unchanged (GPS hunt + "Use this location"). Worker `PATCH /api/admin/sites/:id` now also accepts `name`.
- **Deploy:** cache-bust `?v=20261008i`, worker deployed. Verified live: markers present, index 20261008i.

### 2026-10-08 (site delete: refresh bug)
- **Report (Essam):** "I have to refresh the app for the deleted site to disappear."
- **Root cause:** the delete handler called `refresh()` — which re-fetches grid data but NOT sites (sites come from `loadBase()`, only run on full reload). Every other site handler (add/toggle/radius) correctly does `loadBase(); renderAdmin();`. **Fix:** delete now does the same — deleted site disappears immediately, no app reload.
- **Deploy:** cache-bust `?v=20261008h`. Verified live.

### 2026-10-08 (site delete)
- **Ask (Essam):** "give me the option to delete sites."
- **Done:** worker `DELETE /api/admin/sites/:id` → `DELETE new_sites(guid)` (proven live: fake-GUID probe returned Dataverse 404 = plumbing + permissions OK). Frontend: **Delete** button on every sites row, two-step confirm (native confirm() suppressed in Teams iframe; second click deletes + refresh). Tooltip warns people will stop signing in at a deleted site.
- **Deploy:** cache-bust `?v=20261008g`, worker deployed. Verified live: index 20261008g, markers present.

### 2026-10-08 (map picker: satellite imagery)
- **Ask (Essam):** "make the map show satellite image, or use Google Maps."
- **Decision:** Google Maps needs a paid API key (dead under $0). Used **Esri World Imagery** (ArcGIS/Maxar satellite tiles) — **free, no API key**, verified live keyless (real Makkah tile → HTTP 200).
- **Done:** in-app picker + browser fallback (`geo.html`) now default to **Satellite**, with a **Satellite / Streets** layer switcher (top-right). Zoom default bumped 13 → 14 (satellite reads better zoomed in).
- **Deploy:** cache-bust `?v=20261008f`. Verified live: index 20261008f, World_Imagery present in live app.js + geo.html, Esri tile 200 keyless.

### 2026-10-08 (map picker moved INSIDE the app)
- **Report (Essam):** "make it open within the app — Send to portal opens the portal on another page where I can't sign in."
- **Why it happened:** the picker's "Send" opened the app URL in a **second browser tab**, which needs a separate Microsoft sign-in. **Fix:** the map picker is now an **in-app Leaflet overlay** (Leaflet 1.9.4 loaded from CDN in index.html): new **🗺️ Pick on map** button in the Sites tab opens a full-screen map **inside the app** (no new page, no second sign-in) — click/drag pin (GPS auto-center when available, fallback Makkah), live radius circle, name + radius form, **"Use this location"** fills the site form right there → press **Add site**. Old 🌐 browser picker kept as fallback (only used if Leaflet fails to load in the Teams webview).
- **Deploy:** cache-bust `?v=20261008e`. Verified live: index serves 20261008e + leaflet refs, app.js markers present, overlay CSS present, geo.html fallback 200. No worker change, no zip.

### 2026-10-08 (site picker: map + click + name + radius)
- **Ask (Essam):** "make it open a map and I can click on the location, then right there name it and define the radius."
- **Done:** `geo.html` is now a **Leaflet + OpenStreetMap picker** (no key/account, CDN 1.9.4): full-screen map, centers on GPS (fallback Makkah), **click or drag the pin**, **live radius circle** (follows the radius input), **name + radius form** right there, **Copy** + **"Send to Protection Portal →"** → `/app/?site=lat,lon&name=..&radius=..`. App boot hook extended: prefills lat/lon **and name and radius** → user just presses **Add site**.
- **Deploy:** cache-bust `?v=20261008d`. Verified live: geo.html 200 (Site Picker + leaflet present), index serves 20261008d, prefill marker present. No worker change (geo.html already allow-listed), no zip.

### 2026-10-08 (location helper — Teams desktop has no GPS)
- **Report (Essam):** adding a site — "📍 My location" times out (desktop, browser location allowed).
- **Root cause:** the Teams **desktop** webview does not expose geolocation to tab content — `getCurrentPosition` hangs until timeout. Mobile Teams works (that's how phone sign-in gets GPS).
- **Fix (frontend + worker, no zip):** new helper page **`app/geo.html`** (served by Worker `/app/geo.html`, no-cache) — runs in the external **browser** where GPS works: grabs location, shows coords + accuracy, copy button, and **"Open Protection Portal →"** link → `/app/?site=lat,lon`. App boot hook: `?site=lat,lon` (admins only) jumps to **Admin → Sites** and prefills lat/lon — just add name + radius → Add site. Site form: new **"🌐 Get location from browser"** button (opens helper); original 📍 now 6 s timeout (works on mobile) with a guiding toast on failure. Worker `/app` allow-list: `geo.html` (no-cache HTML class).
- **Deploy:** cache-bust `?v=20261008c`. Verified live: geo.html 200 no-cache, index serves 20261008c, both markers present, health OK.
- **Known limitation (documented):** sign-in/out GPS on **desktop** Teams still can't read GPS (core feature) — sign in from the phone. Browser-helper sign-in (geo.html-style flow submitting a sign-in) is a possible future add if Essam wants it.

### 2026-10-08 (bugfixes: log delete + rejected requests on grid)
- **Report (Essam):** "I can't delete logs. Rejected requests still show in calendar."
- **Root cause 1 (delete):** the delete button used native `window.confirm()` — **suppressed inside the Teams iframe** (dialog never shows, returns false → handler silently no-ops). The API path was proven good live (worker→Dataverse DELETE works; fake-GUID probe returned Dataverse 404, real delete round-trip OK). **Fix:** two-step in-page confirm — click Delete → button turns "Confirm?" for 3.5 s → second click deletes. No native dialogs anywhere.
- **Root cause 2 (rejected on grid):** `requestsFor()` only excluded cancelled, so rejected requests rendered as grid chips (week/month/year cells, status filter, detail popup). **Fix:** exclude cancelled AND rejected — grid shows pending + approved only. Requests/Approvals tabs unaffected (they read `S.requests` directly, so rejected still visible where it belongs).
- **Deploy:** frontend-only, cache-bust `?v=20261008b`, no worker change, no zip. Verified live: `/app/` serves 20261008b, both code markers present in live app.js.

### 2026-10-08 (icon v2: bigger shield, Arial Black — v1.0.8)
- **Ask (Essam):** "make the shield a little bit bigger and make it look nicer and use a different font. I don't like this font. It looks childish."
- **Done:** `teams/make_icons_shield_v2.py` (Pillow, Hermes venv python — Pillow already in venv, no install). 4× supersampled LANCZOS. Shield 72% of tile, sharp crest corners, tight deliberate drop shadow, light 3px edge, Arial Black PMK at 90% shield width (navy on blue gradient). Two vision-critique rounds: 4/10 → 7/10 → "ship, comfortable margins, no unprofessional flaw".
- **Manifest v1.0.8 (zip)** — icon swap only; names unchanged from v1.0.7.
- Old generators kept: `make_icons.py` (clock), `make_icons_shield.py` (v1 hand-drawn PMK).

### 2026-10-08 (rebrand: Protection Portal + shield/PMK icon)
- **Ask (Essam):** name the app "Protection Portal"; logo = shield with "PMK" abbreviation.
- **Manifest v1.0.7 (zip):** `name.full` = "Protection Portal"; `name.short` + tab name = "Prot. Portal" (**Teams hard limit: short/tab names ≤ 15 chars** — "Protection Portal" is 17, so the short forms carry the name). Icons replaced: **shield with PMK** on dark-navy (color.png 192² accent-blue shield + navy PMK; outline.png 32² white shield). Generator: `teams/make_icons_shield.py` (pure stdlib, no PIL — hand-drawn strokes; PMK reads clearly, lettering is casual/marker-style).
- **Frontend (no zip — auto-refresh):** page title + header → "Protection Portal".
- **Open option (needs Essam's call):** install Pillow (`pip install pillow`) to regenerate PMK in crisp Arial Bold instead of the hand-drawn strokes — his call (install rule).
- Old icon generator kept at `teams/make_icons.py` (clock motif) in case we revert.

### 2026-10-08 (auto-refresh delivery — last app install)
- **Ask (Essam):** "can we make the app always refresh so we don't have to install it every time?" — YES.
- **How:** the Teams tab's `contentUrl` now points at the **Worker** (`/app`), which serves the Pages files with **freshness headers** (index.html `no-cache, must-revalidate`; assets `max-age=600`). Teams always revalidates with the Worker → **every new build is live the moment the tab is opened**. GitHub Pages stays the content origin (Worker fetches it per request).
- **Manifest v1.0.6 (LAST zip):** contentUrl → `https://makkah-attendance-api.makkah-attendance-api.workers.dev/app`; `webApplicationInfo.resource` + `validDomains` → workers.dev origin (SSO resource must match iframe origin). Worker `/app` route: allow-listed files only (`index.html/app.js/style.css/teams.js/msal-browser.min.js`), 404 otherwise.
- **Standing rule (delivery):** **no more zips.** Frontend deploy = push Pages + done (tab picks it up on next open). Zips only if the delivery mechanism itself changes or SSO resource needs updating.
- **Verified live:** `/app` → 200 + `no-cache` + current build (viewtoggle present); `/app/app.js` streams full file; `/health` OK.
- **Bug + fix (same day):** contentUrl `.../app` (no trailing slash) made the browser resolve asset refs to `/app.js` instead of `/app/app.js` → frozen loading screen for Essam. Fix: Worker 301-redirects `/app` → `/app/`. No zip needed — first real proof of the auto-refresh delivery (fix reached the installed app on tab refresh).
- **Note:** PKCE fallback (non-Teams browser login) may need the workers.dev origin added to the app registration's redirect URIs — Teams SSO (the normal path) is unaffected. Check only if someone opens the page outside Teams.

### 2026-10-08 (grid: week/month/year views + filter/sort toolbar)
- **Ask (Essam):** can only see one week; wants **month** (all weeks of the month) and **year** (all months) views; and the grid should be **filterable + sortable** — e.g. "on a specific day, who is on vacation / on call / free".
- **Built:** (1) **Week / Month / Year view toggle** in the grid nav. Month = all days w/ compact chips (OC/VAC/RST/TRN/OVT/CO…) + sign-in dot, weekends shaded, click day → detail. Year = 12 month columns with per-month counts, click month → drills into month view. Prev/Next steps per view; data window auto-matches view (Worker `$top=10000` on oncall/requests/training so a year never silently truncates at 1000 rows). (2) **Toolbar:** search rows (name/number), sort rows (A→Z / Z→A / number), **status filter on a chosen day** (default today): on-call, vacation, reset, training, overtime, call-out, other, **free** (no on-call/request/training that day), signed in (site / outside), signed out, no sign-in.
- **Deployed:** Worker (year-safe `$top`) + Pages `app.js?v=20261008a` + manifest **v1.0.5**. Verified live: all 3 range endpoints OK with a full-year window; year data = Essam's test vacation (2026-10-08).
- **Open:** Essam to test v1.0.5 (install zip). Refine month/year density later if needed.

### 2026-10-07 (night — Essam redefines "Shifts"; focus shifts to sign-in/out)
- **CORRECTION (Essam, 22:00):** "Shifts" was misunderstood. It is **NOT on-call** — it's **real work shifts**: the team goes on shifts for ~a month (less/equal/more). A shift has: **type** (selectable kind), **how many people**, **shift in-charge**, **duration**. On-call is a separate feature (stays as-is). The live Shifts tab is a **v1 placeholder** under the old interpretation → to be **reworked** to the real shift model (§5.8 now has the corrected spec + open questions).
- **Durable-log instruction (standing):** everything discussed/decided about this app gets logged in THIS SPEC — not just in chat. (Recorded in the file header.)
- **Priority (per Essam):** **perfect sign-in/out** is the main focus for tomorrow. Shifts design comes after.
- **Status at end of day:** all of today's builds (Shifts placeholder tab, admin Logs, terminology, radius label, hard time block, number-match identity, on-call GUID/datetime fixes) are **deployed + verified live**; Teams v1.0.4 zip delivered to Essam for re-install.

### 2026-10-07 (Shifts tab + admin Logs + terminology + data-layer bug fixes)
- **New features (live):** (a) **Shifts tab** — top-level nav, everyone sees it; shift-hours card (admins edit via `/api/admin/settings`, the Ramadan lever) + on-call week (admins assign/remove per day, reuse `/api/admin/oncall`; non-admins read-only). (b) **Admin → Logs** sub-tab — newest-first sign-in/out (30 days); admin **edit** (direction/site/allowed/note) + **delete** any record. (c) **Terminology → "admin"** (UI + API error text; `is_approver` stays the internal field). (d) **Radius (m)** label on the Sites table.
- **Two data-layer bugs found + fixed (verified live):** (1) string-key resource addressing 400s in this org — every entity's real key is its `<name>id` GUID (`new_signinid`, `new_oncallid`); the `*_name` column is display-only. Admin log endpoints now address by bare GUID. (2) on-call lookups used `datetime'…'` literals (400, gotcha #14) + string-key deletes → on-call assign pre-delete + remove silently no-op'd. Fixed all three on-call sites (raw ISO filter + `new_oncalls(guid)`). **Gotchas #24–#26.**
- **`/api/signins`** now returns `id` (new_signinid GUID) + `note`; history window 2d→30d.
- **Verified live:** admin log UPDATE round-trip (set note → read back → revert), GUID addressing, live Pages build (Shifts nav + renderShifts/renderAdminLogs present), manifest v1.0.4 + zip rebuilt.
- **Deployed:** Worker (new admin-log endpoints + on-call fixes) + Pages `app.js?v=20261007e` + Teams manifest **v1.0.4** (`contentUrl ?v=20261007e`).
- **Open for Essam:** test Shifts tab (edit shift hours, assign on-call) + Admin → Logs (edit/delete a record). See also the 3 earlier UI-polish backlog items (§8b).

### 2026-10-07 (identity COMPLETE: Teams SSO + context fallback + number-match + mobile)
- **Teams tab installed & live** (sideloaded zip). Identity chain working end-to-end on desktop + phone.
- **SSO resource rule (MS Teams toolkit team, issue #2039):** `webApplicationInfo.resource` must be `api://<tab-app domain>/<client id>` — Teams rejects SSO when the resource domain ≠ iframe origin ("App resource defined in manifest and iframe origin do not match"). Fixed: `api://the0caesar.github.io/0cf32ba0…`.
- **Context-identity fallback:** when SSO is refused, `getContext().user` UPN (Teams-injected) becomes an unsigned JWT → Worker decode-only (v1 security note; RS256 hardening = 8b).
- **Number-match identity (primary):** UPN embeds the employee number (`70180@SEC.se.com.sa` → `70180` → roster number). Verified live via `/api/whoami` → `{70180, Essam Al-Ahmadi, is_approver, linked}`. Email match kept as silent fallback (all 22 UPNs start with their number — per Essam).
- **Mobile fix:** mobile Teams loads tabs in a TOP-LEVEL webview (not an iframe) — iframe-only detection sent mobile to the broken browser-PKCE path. Fix: `teamsContextProbe()` = UA sniff (`/teams/i`) + `getContext()` resolve (5s timeout). Works desktop + mobile.
- **Desktop GPS sign-in verified by Essam** (sign-in + sign-out ✓ desktop; requests + self-reject exercised).

### 2026-10-07 (SSO cutover — CDN + boot-hang fixes)
- **"Login library not loaded (CDN blocked?)" root cause = MY BUG, not tenant:** index.html referenced `alcdn.msauth.net/browser/3.20.3` + `res.cdn.office.net/teams-js/2.26.2` — both **404 (phantom versions that don't exist** on any CDN). Fixed: self-hosted **MSAL v5.25.0** + **teams-js v2.57.0** (UMD globals `msal` / `microsoftTeams` verified) in the Pages repo — same-origin, filter-proof.
- **MSAL v5 compat:** `handleRedirectPromise` → `initialize()` (shim supports both).
- **Boot-hang bug found & fixed:** teams.js loads in ANY browser, but `microsoftTeams.initialize()` never resolves outside the real Teams webview → boot stalled silently (app visible, no token, no auth screen). Guard: `window.parent !== window` + 5s `Promise.race` timeout.
- **Verified headless end-to-end to the personal wall:** live site → auth screen (login button) → click → AAD authorize, account pre-filled `70180@sec.se.com.sa` → **consent screen** ("Permissions requested — makkah-attendance") → identity-verify step (phone — only Essam). Full chain proven; last hop is standard PKCE exchange (token endpoint already proven valid by authorize probe + 5/5 worker identity tests).
- **Pages gotcha:** browser edge-caches app.js — verify fixes with `curl | grep <marker>` AND cache-busted tabs (query string), or clean tests silently run old code.
- NEXT: Essam Ctrl+Shift+R → Sign in → Accept consent → app live → sideload zip → reminders webhook.

### 2026-10-07 (SSO cutover)
- **Entra registration created by Essam** (App registrations blade: create worked, view 401s — no roles on his account; "No roles assigned" on his profile card; Aug 26 vault note confirms he was never a global admin either — self-service create was possible in August, role/tenant-setting since changed; audit log = IT only).
- **Client ID `0cf32ba0-241d-4518-aa93-039664318a28`** captured from a paused screen-recording of the Overview flash (vision-analyzed crop).
- **Verified headless:** PKCE authorize probe (code_challenge S256 + exact Web redirect) → AAD sign-in page, zero AADSTS codes ⇒ client valid, redirect registered, public-client-flow accepted. The `error=access_denied` in the probe body is the `urlCancel` template — not an error.
- **Cutover deployed to Pages** (cb8709b→496e5c3): `API_BASE` → live Worker, `AUTH.client_id` → real. Manifest v2 final: `webApplicationInfo{id, resource: api://<tenant>/<client>}`, `validDomains`, `devicePermissions:["geolocation"]` — zip rebuilt.
- **Headless click-through:** live site → auth screen renders → button click → AAD pre-filled `70180@sec.se.com.sa` → **MFA code wall** (Authenticator app) — expected; user completes.
- NEXT: Essam signs in once (own browser, fresh session) → SSO proven → sideload zip in Teams → reminders webhook (team) → done.

### 2026-10-07 (deployment day — Worker LIVE)
- **Cloudflare:** Essam created free account (Google login); `wrangler login` OAuth OK (scopes incl. `workers:write`); subdomain `makkah-attendance-api` registered via API `PUT /workers/subdomain` (gotcha §8.23); `npx wrangler deploy` → **`https://makkah-attendance-api.makkah-attendance-api.workers.dev` LIVE 15:44**, cron `*/5 * * * *` armed; `DV_CLIENT_SECRET` secret set (piped from dataverse.json, never echoed; secret valid to 2028-08-11).
- **LIVE-VERIFIED (real Dataverse, from CF edge):** health 200; CORS preflight 204 + `access-control-allow-origin: https://the0caesar.github.io`; `whoami` with real identity → `70180 Essam Al-Ahmadi, linked, dev:false` (first attempt 401 = transient, pre-secret version still active); site create OK; geofence sign-in 0m allowed / 2273km blocked; live test rows wiped (wipe_test.py now also catches 'E2E Live Site').
- **Cutover decision:** live app `API_BASE` deliberately still `""` (dev mode) — flipping it walls the site behind work-account SSO, which can't work until the Entra user-facing registration exists (step 8). Cutover will be one atomic push: `API_BASE` + `AUTH.client_id` + manifest `webApplicationInfo{id,resource}` + zip.
- NEXT: Essam creates Entra registration (5 min, settings prepared below) → cutover push + SSO live test → sideload test → webhook URL (team) → reminders live.

### 2026-10-07 (identity + reminders day)
- **Identity layer complete + tested:** MSAL SSO (Teams tab) + PKCE fallback + two-mode auth screen (login / link-your-email) in `app.js` + `index.html`; Worker `identityFor()` split 401 (no token) vs 403+email (unlinked). **`test_identity.mjs` 5/5 PASS vs live Dataverse** (crafted alg:none JWTs are acceptable in v1 — decode-only per §8.20; RS256 hardening = step 8b). Test secrets deleted after run.
- **Manifest v2:** added `validDomains` + `devicePermissions:["geolocation"]`; `webApplicationInfo.id/resource` waits for the new Entra client_id. Zip rebuilt (manifest validated as JSON first).
- **PP JWT refreshed** from the persistent sp-profile headless Chrome (MSAL localStorage `api.powerplatform.com/.default` token; old one expired at 13:25). Verified 200 on `powerapps/apps`.
- **Flow-API route to reminders CLOSED (§8.21):** `powerautomate/flows` 401s (scope), no cached flow token, mgmt path 404.
- **Reminders v1 built + verified:** Worker cron `*/5` + pure `reminderPlan()` (AST math, lead/interval/stop-after, latest-direction, vacation exclusion) + channel-webhook @email delivery + dev dry-run endpoint. **`test_reminders.mjs` 10/10 PASS; live dry-run at 07:00-AST-Sunday returned the correct unsigned-person list vs real data; `e2e_worker.sh` re-run 20/20 after the patch; test rows wiped.**
- NEXT: CF account (Essam) → live deploy + E2E vs live URL → Entra user-facing registration (Essam, settings prepared) → client_id into app.js + manifest → sideload test → webhook URL (team) → reminders live.

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
