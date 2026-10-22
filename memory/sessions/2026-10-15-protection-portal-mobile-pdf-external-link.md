# Protection Portal — mobile PDF delivery via external link (2026-10-15)

## Essam's problem
"download PDF on the phone inside the Teams app doesn't download. Works on desktop/laptop." Then his idea: **"What if we make it just open an external link and then from the external link we download?"** — i.e. get the file out of the Teams webview (which blocks downloads) into a normal place the phone can save it.

## Why it was broken
jsPDF's `doc.save()` triggers a silent anchor-download. Desktop browsers honor it; the **Teams phone webview blocks file downloads** (the "This action is currently not supported on mobile" message — that's Teams' own dialog, not our code; confirmed it's not in our strings). An earlier attempt (Web Share API with files) also failed on this webview.

## Fix (the external-link approach Essam proposed)
On mobile:
1. Generate the PDF in the browser (unchanged).
2. **Upload it to the worker** — `POST /api/register/pdf?week=YYYY-MM-DD` (admin-only, binary PDF body). Worker stores it in the existing `REG_SIGS` KV under `pdf:<week>-<random>.pdf` (base64). Returns a public URL.
3. **Open that URL EXTERNALLY** via the Teams SDK `microsoftTeams.app.openLink({url})` → lands in the **phone's real browser** (not the webview), which CAN save/share PDFs. Fallback: `window.open`, and a tappable in-page link bar (`#pdf-link-bar`) if auto-open is blocked.
Desktop: unchanged (`doc.save()` normal download).

### Worker changes (deployed v 496ddd05)
- `GET /pdf/<name>` — public, serves stored PDF (`Content-Type: application/pdf`, `no-store`). Name regex-validated `^\d{4}-\d{2}-\d{2}-[a-z0-9]+\.pdf$`; random token makes it unguessable. 404 if missing, 400 if bad name.
- `POST /api/register/pdf?week=` — identity + admin gate (`is_approver` or ADMIN_ONLY_NUMBERS), 15MB cap, stores base64 in KV.
- `b64encode`/`b64decode` helpers (KV stores strings).

### App changes (main 8cd56ea)
- `regPdf()` mobile branch: upload → `openExternal(url)` → toast.
- `openExternal(url)` helper (Teams `app.openLink`, fallback `window.open`).
- `showPdfLink(url,name)` fallback link bar.

## Verified
- `node --check` worker + all app blocks OK.
- Worker deployed (REG_SIGS KV bound); endpoint tests: `POST /api/register/pdf` (no token) = **401** (auth-gated), `GET /pdf/bad-name` = **400**, `GET /pdf/2026-10-11-abc123.pdf` (missing) = **404** — all wired correctly.
- App live: `openExternal` + upload call present in the served file.
- b64 round-trip of a sample PDF = OK; name regex validates.
- **NOT testable from my end:** the actual phone-in-Teams openLink → browser hand-off (needs Essam's phone). That's the one thing he must confirm.

## Files
`worker/index.js`, `scratch/live2.html` (= main/index.html). Commits: worker v 496ddd05, main 8cd56ea.
