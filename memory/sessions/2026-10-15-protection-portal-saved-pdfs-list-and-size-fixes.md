# Protection Portal — Saved PDFs list + PDF size fixes (2026-10-15)

## Context
Phone download flow (upload → worker → external link) was built earlier. Essam hit "too large (max 15MB)" — my own upload cap firing on a real weekly PDF. Then asked for a list of saved PDFs ("is the storage limited?" / "all I want is tap download on phone, get the file").

## Fixes deployed this round
1. **Worker cap 15MB → 24MB** (KV hard max is 25MB/file — set by Cloudflare, can't raise). Weekly PDFs are ~1–2MB, so 24MB is ~20× headroom.
2. **PDF size at source**: `html2canvas scale 2 → 1.5`, slices **PNG → JPEG q0.85** (white bg painted first; JPEG has no alpha). Smaller + faster on phone, still crisp.
3. **Saved PDFs list (new)**:
   - Worker: upload now writes a `pdfindex` KV entry (newest first, capped at 500) with {name, week, at, bytes}. New `GET /api/register/pdfs` (admin-only) returns the list with full URLs.
   - App: new **📁 Saved PDFs** button next to Download PDF (register toolbar) → modal listing each saved week (week start, saved date in AST, size) with a **⬇ Get** button that uses `openExternal()` (phone browser) + link-bar fallback.

## Verified
- node --check worker + all app blocks OK.
- Worker deployed (wrangler, live). `GET /api/register/pdfs` (no token) = **401** (auth-gated, wired).
- App live (main dda7599): `#reg-pdfs` button + `#savedpdfs-modal` present in served file.
- Storage answer: KV free tier ~1GB total; weekly PDF ~1–2MB → 500+ weeks. Not a constraint.

## Files
`worker/index.js` (pdfindex + /api/register/pdfs + 24MB cap), `scratch/live2.html` (= main/index.html: saved-pdfs button/modal/loader, JPEG slices, scale 1.5). Commits: main dda7599; worker version from wrangler deploy.

## Note
SharePoint upload route (Essam's idea) was TESTED and is dead: our app registration gets a SharePoint token but the site rejects it 401 — the registration has no SharePoint permission, and only a tenant admin (or a new app registration, which IT disabled) can grant it. Worker-storage route stands as the mechanism.
