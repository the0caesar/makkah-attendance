# Protection Portal — refresh-on-return, instant sig pad, storage/history answer (2026-10-12)

## What Essam asked
1. Auto-refresh "sometimes doesn't refresh even after 5s".
2. Sig-pad delay is back (noticed on sign-out; unsure on sign-in).
3. Where is the data saved (signature / site / time)? Can I go back a week / month / a year and download that day's PDF?

## 1. Refresh not working — root cause + fix
- Root cause: Teams/OS **throttles/pauses** the 5s `setInterval` while the tab is backgrounded or the phone screen is locked. So when Essam came back, data looked stale for longer than 5s.
- Fix (app): added `visibilitychange` + `window focus` handlers -> run `doAutoRefresh()` (same guards as the 5s tick: skip hidden/sig modal/edit modal/register field/refreshing). Now it refreshes IMMEDIATELY when he returns to the app.

## 2. Sig-pad delay (sign-out) — root cause + fix
- Root cause: `doSign` `await`ed `getLocation()` (GPS, several seconds) THEN the `/api/signin` POST, THEN opened the pad. So the pad appeared after the whole GPS+POST.
- Fix: open the pad INSTANTLY (`promptSignature` right after the instant shift-window check). GPS + sign-in POST run in the background as `pendingSignin` (a promise). The pad's Save handler `await`s `pendingSignin` (only when this pad was opened by doSign, via the `_sigPadIsSignin` flag) so a signature only commits once the sign-in SUCCEEDED -> no orphan signatures. If the sign-in fails, the pad closes and an error shows.
- Order bug caught: flag `_sigPadIsSignin` must be set BEFORE `promptSignature` (openSigModal reads it synchronously).

## 3. Storage / history — ANSWER (verified in worker code)
- **Sign-in time + site (+ GPS/GPS-derived site, direction)** -> **Dataverse** `new_signins`. Permanent company system of record.
- **Signatures + remarks** -> **Cloudflare KV** store `REG_SIGS`, one key per day `day:YYYY-MM-DD` (signatures are image data URLs; remarks {text,by,at}). Also `reg.exclude` (global hide list).
- **Nothing is ever deleted/pruned/expired** — no `kv.delete`, no TTL, no cron purge in the worker. Sign-ins (Dataverse) and signatures (KV) persist.
- **Register pulls from live data by date**: sign-ins from Dataverse for the day window; signatures from KV `day:<date>`. So picking a past date reconstructs that day.
- **Can you go back a week/month/year and download the PDF?** YES. The register's date picker (`#reg-date`, a plain `type=date`) accepts ANY date; it loads that day's sign-ins + signatures from the stores and the Download PDF button builds that day's PDF. So a week, month, or year ago all work.
- **Caveat (honest):** the signature pad always saves to **today**'s key (`todayISO()`). So you can download an old day's PDF (it has that day's sigs), but you CANNOT retroactively add a signature to a past date from the pad.

## Verified
- Live == local (828328 bytes). vischange=2, pendingSignin=7, _sigPadIsSignin present. All app blocks pass node --check. No worker change.
- grep confirmed no KV delete/TTL/prune in worker.

## Files
`scratch/live2.html` (= main/index.html). Commit 3c2ee81.
