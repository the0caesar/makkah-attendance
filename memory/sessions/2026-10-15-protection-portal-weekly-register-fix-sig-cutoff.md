# Protection Portal — weekly register: stop signature cutoff (2026-10-15)

## Essam's report (screenshot)
"signature was cut off, we need the signature window to match the cell size to avoid this."

## Root cause
Signatures are saved as **4:1** images (the pad's shape). On the screen the sig cell was ~58px wide, and the CSS forced the image to a fixed **24px height** with `width:auto` → a 4:1 image at 24px height is ~96px wide → the cell can't hold 96px, so the left/right edges of the stroke were clipped. (The PDF was NOT affected — it uses `object-fit:contain` inside a fixed box.)

## Fix (main 9e5c7c1)
- `#reg-table .sig-img`: `height:24px;width:auto` → **`max-width:100%; height:auto; max-height:34px; object-fit:contain`** — the image now scales to the cell width (keeps 4:1), capped at 34px tall, so it can't overflow.
- `td.reg-sigcell`: `min-width:58px` → **`min-width:84px; display:flex; align-items:center; gap:2px`** — wider cell + flex so the signature and the ✕ clear-button share the cell without squeezing the image.

## Verified
- node --check OK. Live (Worker /app): both new CSS rules present.
- CDP mock render: signature image no longer overflows its cell (`clipped:false`); grid renders with 5 day columns + 4 sub-columns/day, no layout breakage (vision-confirmed, `scratch/sigfit.png`).

## Note
Cell is now 84px wide — the screen signature is small by nature of fitting 5 days + in/out in one row. If Essam wants bigger signatures on screen, options: reduce to 2 cells/day (match paper) or a dedicated "view signature" tap. Refine-as-we-go.

## Files
`scratch/live2.html` (= main/index.html). Commit 9e5c7c1. No worker change. Test: `scratch/cdp_sigfit.py`.
