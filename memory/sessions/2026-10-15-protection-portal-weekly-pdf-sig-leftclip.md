# Protection Portal — weekly PDF: signature clipped on LEFT edge (2026-10-15)

## Essam's report (screenshot of the downloaded PDF)
"its still cutoff." The signature (row 2, عصام عمر الاحمدي 70180, الخميس 15/10, arrival-signature cell) was clipped on the **LEFT edge only** — the leftmost stroke cut flat by the cell's left border.

## Root cause (PDF, not screen)
The earlier sig-fix only touched the on-screen register. The **PDF** had its own bug:
- Signature **column width = 54px** (`dayCols = [46,54,46,54]`).
- Signature **image forced to `width:88px`** (`#pdfpage .sigimg{width:88px;...}`) — WIDER than the 54px cell.
- In an RTL table the image aligns to the right (RTL "start"), so the 88px image in a 54px cell overflows and the overflow is sliced off the **left** → exactly the flat left-edge cut Essam saw.
- (html2canvas captures what's laid out, so the clipped render is what lands in the PDF.)

## Fix (main 5588d14)
1. `dayCols = [46,54,46,54]` → **[44,64,44,64]** — sig columns widened 54→64px (more room, better legibility); time columns 46→44 to keep total width ~same.
2. `#pdfpage .sigimg{width:88px;height:22px;...}` → **`max-width:100%;height:22px;object-fit:contain;...`** — image now scales to fit the cell width (keeps 4:1), never wider than the cell → cannot overflow/clip.

## Verified
- node --check OK. Both changes present live (Worker /app).
- CDP real-render measurement (reproduced the exact regPdf colgroup + cell + CSS with a full-width 4:1 test sig): `{"imgW":57,"imgH":22,"cellW":64,"cellH":34,"overflows":false,"totalW":1345}` — image fits inside cell with margin, no overflow.

## Files
`scratch/live2.html` (= main/index.html). Commit 5588d14. No worker change. Test: `scratch/cdp_pdfmeasure2.py`.
