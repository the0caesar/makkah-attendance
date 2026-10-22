# Protection Portal — register numbering + signature visibility/size (2026-10-12)

## What Essam asked
1. PDF should number the VISIBLE people 1,2,3 (first shown = #1), not leave gaps. (On-screen register keeps stable numbers so it doesn't drop — from prior request.)
2. "What's the point of the Add signature button?"
3. Signature in register needs WHITE background (black ink invisible on dark theme).
4. The signature scratchpad should reflect the exact cell size / PDF size (no squish/stretch).

## Changes (app-only, main 49a0b2a)
- **PDF numbering → sequential 1..N** of the VISIBLE rows (reverted PDF to `(i+1)`). On-screen register still uses STABLE numbers (rank in full roster) so it never drops.
- **Signature white bg in register**: `.sig-img` now `background:#fff; padding:2px 4px; border-radius:4px; height:24px`.
- **Signature size match (4:1 aspect)**: 
  - pad canvas: `h = round(w/4)` (was fixed 160px), CSS `height:auto` so display follows the 4:1 buffer.
  - PDF `.sigimg`: fixed `width:96px;height:24px;object-fit:contain` (96x24 = 4:1, same as pad) on a white `td.sigc` base.
  - Register `.sig-img`: height 24px (was 22).
  - Net effect: what you draw = what shows in register = what's in the PDF, at the true ratio.

## Answered (button)
"Add signature" (✍) is a shortcut to pick a person + in/out and draw their signature. It's redundant — tapping any signature cell does the same. Left in place; Essam may ask to remove.

## Verified live (Worker /app)
pad 4:1=1, canvas auto=1, sigimg 96x24=1, sig-img white=1. Line 2759 PDF `(i+1)`, line 2540 register `numBy`. All script blocks pass.

## Files
`scratch/live2.html` (= main/index.html). No worker change.
