# Protection Portal — Arabic names, PDF exact-Excel template, remove Turki (2026-10-12)

## Arabic names (DONE)
- Source: SharePoint `تخطيط الاجازات 2026.xlsb` (real binary XLSB, NOT OOXML — openpyxl can't read; used `pyxlsb` to parse).
- Parsed Sheet1 col F=phone, G=emp#, H=Arabic name. 26 extracted.
- Matched to Dataverse by `new_employeenumber`: 25 of 27 matched.
- Essam's corrections: added `68589=نبيل خان` (Nabeel Khan), `63021=أحمد بتاوي` (Ahmad Batawi); dropped `97585 Turki` (different group); ignored `عبدالفتاح سيد` (bad emp# 2359791957 in file = a phone number).
- **Final map: 26 employees.** Stored as `const AR_NAMES` (emp# → Arabic name) inside `index.html` (main). Regenerate from `scratch/ar_final.json` if the plan changes.
- Arabic name shown in register table + PDF (falls back to Latin `new_fullname` if no Arabic entry).

## Turki removed (DONE)
- DELETE on Dataverse `new_employeeses` (found by `new_employeenumber eq '97585'`, quoted string — field is Edm.String). Verified 204, roster now 26.

## PDF = exact Excel template (DONE)
- `template_kashaf.xlsx` geometry: RTL, portrait, cols A..J. Title A1:J1 merged (Arial 22 bold), اليوم:/التاريخ: row, 9 headers B..J (Calibri 11). Column px widths: A=59,B=291,C=215,D=108,E=190,F=90,G=215,H=190,I=256,J=59.
- **Logo** `xl/media/image1.jpeg` (National Grid SA, 16278 B) sits top-right (col J, row 0, ~2.16"x0.59"). Extracted to repo root `logo_ngsa.jpeg`.
- New `regPdf`: builds off-screen RTL `<div id=pdfpage>` (1521px wide) with logo top-right + centered Arabic title + day/date line + 10-col table (A=#,B=name..J=notes), colgroup from template px widths. Rows sorted by **numeric ID** (`parseInt(emp)`, not localeCompare). html2canvas(scale 2) → jsPDF image (unchanged mechanism — jsPDF can't shape Arabic).
- Added `logo_ngsa.jpeg` to Worker `/app/` ALLOWED map.

## Deployed
- `main` commit `44632f2` (index.html + logo). GitHub Pages live (verified AR_NAMES + logo 200).
- Worker `8a3311c1` (logo allowlist). Verified `/app/logo_ngsa.jpeg` 200/16278B, index has AR_NAMES/CLW/logo ref.
- CDP render test (`scratch/cdp_shot.py` + `scratch/cdp_make_sample.py`): vision-verified logo top-right, centered title, 9 Arabic headers, connected names, ID-ascending rows.

## Files
- `scratch/plan2026.xlsb` (source), `scratch/ar_final.json` (26-name map), `scratch/ar_names_js.txt` (AR_NAMES constant), `scratch/splice_regpdf.py` (regPdf splicer), `scratch/template_kashaf.xlsx` + `scratch/template_geom.py` (template geometry), `scratch/dv_turki_del.py` (Turki delete).
- `index.html` (main/live) — `AR_NAMES` after `REG_SECTION`; `regPdf` rewritten.
