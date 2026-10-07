# Teams Packaging — Deploy & Distribution Notes

Status: **manifest + icons ready** (`manifest.json`, `color.png`, `outline.png`).
The `contentUrl` in the manifest is a **placeholder** until the static site is live — see step 1.

## 1. Deploy static site (GitHub Pages — $0)
1. Create GitHub repo `makkah-attendance` (public or private).
2. Push `app/` contents to the repo root: `index.html`, `style.css`, `app.js`.
3. Settings → Pages → source: main branch, root (/).
4. URL will be `https://<user>.github.io/makkah-attendance/`.
5. **Replace the placeholder URL** in `manifest.json` (2 places) and re-zip.
6. Set `API_BASE` at the top of `app/app.js` to the API host (step 2).

## 2. Deploy API proxy (Azure Functions — $0 within F1 free grant)
The dev proxy (`proxy/proxy.py`) is the reference implementation:
- Static files move to Pages; the **`/api/*` handlers move into one HTTP-trigger function**
  (single `@app.route("/api/{path:path}")` catch-all), same logic, same Dataverse calls.
- Consumption plan = $0 within the F1 grant (1M requests/month ≈ 900/day — 22 people, no problem).
- CORS: allow the Pages origin.
- Secrets: tenant/client id/secret + org URL as function app settings.
- If there is **no Azure subscription**: keep the dev proxy running on any always-on box
  the company has (even this PC via a reverse tunnel) — decision point for Essam.

## 3. Entra app registration (SSO — step 8)
- Register a **web** app in Entra: redirect/home URL = Pages URL.
- `webApplicationInfo.url` in the manifest must equal it (it does, post-deploy).
- The function validates the Teams-issued JWT (Entra) → resolves email → roster person.
- One-time admin screen links Teams email → `new_employeenumber` (dev equivalent: `proxy/dev_identity.json`).

## 4. Distribute the zip (per the confirmed plan — no IT store)
Zip = `manifest.json` + `color.png` + `outline.png` (3 files, root of zip).
Each of the 22 members, once:
- **Teams → Apps → "…" (top-right) → "Upload a custom app from a zip file"**
- Fallbacks if the org policy blocks user uploads (Essam is not Teams admin):
  - Add a **website tab** in the team channel with the Pages URL (no manifest needed).
  - Ask IT to upload the zip as an org catalog app once.

## 5. Verification after deploy
- `curl -I https://<pages-url>` → 200, serves index.html
- `curl https://<function>/api/whoami` (with token) → your employee record
- Teams tab loads, Today screen shows roster + status, sign-in works on the Samsung S24 Ultra.
