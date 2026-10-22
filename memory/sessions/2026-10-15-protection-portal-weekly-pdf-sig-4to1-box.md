# Protection Portal — weekly PDF: signature box = pad shape (4:1), no clip (2026-10-15)

## Essam's ask
"i care about the PDF showing the signature properly, do whatever it takes to make it not get cut off — e.g. make the signature pad the exact dimensions as the cell in the PDF."

## Root cause (why it kept clipping)
The signature pad is **4:1** (`lw = wrap.clientWidth||400, lh = Math.round(lw/4)` — line 2742). The PDF forced the image into a **54px-wide × 22px-tall** box (ratio ~2.4:1), i.e. a *different* shape than the pad. A 4:1 image squeezed into a ~2.4:1 box is wider than the box → clipped at an edge (left, in RTL). My prior band-aids (max-width, object-fit) only shrank it to fit, so the signature rendered small AND still at risk.

## Fix (main 579d85d) — match the pad shape exactly
- `dayCols = [44,78,44,78]` (sig column 64→**78px**).
- `#pdfpage .sigimg{width:100%;height:auto;aspect-ratio:4/1;object-fit:contain;...}` — the signature box is now **exactly 4:1, same as the pad**. The 4:1 signature fills it at native ratio: full width, no squish, **no clip**.

## Verified end-to-end (not just "should work")
Ran the REAL `regPdf()` in headless Chrome (intercepted its html2canvas output — the exact image that becomes the PDF page), with a full-width 4:1 test signature:
- Rendered page = 2970px wide (true PDF output), 23 columns, sig cell = 78px.
- Signature image box measured **71×20** (4:1) inside the 78px cell.
- Vision check: signature sits **entirely inside the cell, white margin, not touching any edge, not clipped**. (It looked like a black bar only because my synthetic test sig is a full-width solid fill; a real signature is handwritten ink at the same 4:1.)

### Two earlier false alarms (test-data, not app bugs)
1. First render showed "no signature" — my test stored raw base64 as `data` (must be a full `data:image/png;base64,` URL). Fixed test → signature renders.
2. "missing/clip" was never a real app regression; the standalone CSS measurements were correct all along.

## Files
`scratch/live2.html` (= main/index.html). Commit 579d85d. No worker change. Tests: `scratch/cdp_pdfreal.py` (real render), `scratch/cdp_pdfdiag.py` (pre-capture diagnostics), `scratch/pdf_page.png` / `scratch/pdf_sigcrop.png` (proof images).
