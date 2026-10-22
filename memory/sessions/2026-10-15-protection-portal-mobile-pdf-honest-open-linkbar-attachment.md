# Protection Portal — mobile PDF: honest open + link bar + attachment header (2026-10-15)

## Essam's report
Tapped Saved PDFs → Get → only got the toast "PDF opened — use ⋯ to save or share it", no file.

## Root cause
`openExternal()` fired Teams `app.openLink` and **assumed success** (returned true without awaiting the promise). It cannot actually confirm the phone opened anything — and on some phone Teams versions `openLink` opens inside Teams' own in-app browser (same download block), not the phone's real browser. So the toast lied.

## Fixes (app main 3a432c0, worker 948f3277)
1. **`openExternal` is now async + honest**: awaits the `openLink` promise with a 2.5s timeout; resolves true only on reported success. `window.open` fallback returns the real window (or false).
2. **Link bar ALWAYS shows after Get/Download** (both call sites): `showPdfLink` now displays the **full raw URL** as a tappable + long-press-copyable link (so if Teams opens it in-app, Essam can open it in Chrome/Safari). Toast is honest: "If it opened inside Teams, use the link at the bottom."
3. **Worker serves the PDF with `Content-Disposition: attachment`** (was `inline`) — so when the phone's real browser opens the link it **downloads the file directly** instead of just previewing it. That's exactly the "external link → phone downloads" flow Essam asked for.

## Verified
- node --check both. Worker deployed (948f3277) — note: the first attempt failed with "stdin is not a tty" when wrangler ran under a background terminal; foreground re-run succeeded (lesson: run wrangler deploy foreground).
- App live: honest toast present ×2, raw-URL link bar present, async openExternal present.
- The one thing still unverifiable from here: whether phone Teams' openLink actually lands in the phone's browser. The always-visible raw link is the guaranteed fallback — tap/copy it into Chrome.

## Files
`worker/index.js` (attachment header), `scratch/live2.html` (= main/index.html). Commit 3a432c0.
