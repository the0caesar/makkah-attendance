# Makkah Attendance API — Cloudflare Worker (production)

JS port of `../api_core.py` (single source of truth: `../SPEC.md` §4 + §8).
Free tier: 100k req/day, **no credit card**, 50 subrequests/req.

## Files
- `index.js` — the Worker (API only; static UI lives on GitHub Pages)
- `wrangler.jsonc` — config + non-secret vars
- `.dev.vars` — local dev secrets (`wrangler dev` only; **gitignored, never commit**)

## Local test (no Cloudflare account needed)
```
cd worker
npm i -D wrangler            # once
npx wrangler dev --port 8788 # runs Miniflare locally; loads .dev.vars
```
Dev identity hatch: `.dev.vars` has `DEV_EMPLOYEE_NUMBER=70180` → every request
is treated as that person (same hatch as the Azure Function).

```
bash ../e2e_worker.sh        # 22 checks incl. live Pages static
python ../wipe_test.py       # wipe E2E rows afterwards
```

## Deploy (needs a free Cloudflare account — no card)
```
cd worker
npx wrangler login                       # browser OAuth (once)
npx wrangler secret put DV_CLIENT_SECRET # paste the Dataverse client secret
npx wrangler deploy
```
→ live URL: `https://makkah-attendance-api.<subdomain>.workers.dev`

Then:
1. Set `API_BASE` in `../app/app.js` to that URL.
2. Copy `app/` → `../deploy/web/` and push (Pages rebuild).
3. `API_BASE` left empty = same-origin (local proxy / static-only mode).

## Identity
- **Prod:** `Authorization: Bearer <MSAL JWT>` → decode email → roster match
  (`new_primaryemail`, case-insensitive) + `is_approver`.
  v1 = decode-only. **Hardening (step 8b):** verify RS256 via tenant JWKS
  (`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`),
  check `iss`, `aud` (user-app client id), `exp`.
- **Dev:** `DEV_EMPLOYEE_NUMBER` var → dev identity (hatch).

## CORS
Allowed origins: `ALLOWED_ORIGIN` (default `https://the0caesar.github.io`) +
localhost/127.0.0.1 any port (dev). Preflight → 204.
