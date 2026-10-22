# Protection Portal — add 16 missing employees from Excel (2026-10-22)

## Task
Essam supplied `C:\Users\Essam Omar\OneDrive - ITC - Saudi Electicity Company\1Personal\New Microsoft Excel Worksheet.xlsx`
(sheet ورقة1, cols: رقم | إسم الموظف, 43 rows). Add all missing names, activate so they can sign in/out,
ensure in env + tables + PDF output.

## Roster math
- Excel: 43 names. Dataverse (new_employeeses) before: 26.
- Missing = 17. ONE (97585 تركي طلال تركي الهذلي) was intentionally deleted earlier → SKIPPED on purpose.
- Added: 16.

## The 16 added (number | name)
56283 تركي عبدالله العصيمي
63010 فريد الأخضر محمد المغربي
63591 سمير مغبش حسن أبو السيل
64568 تركي زبرماوي
71171 محمد حبيب العصيمي
76459 سعود عبدالعزيز زيد
81290 شاكر محمد بن شاكر الحازمي
83519 بسام نايف بن عايد المغامسى
85486 نادر عبد الحفيظ العمري
87167 أسعد عبدالغني هوساوي
93230 محمد سعود الجيزاني
93371 خالد سمير بن عبدالله حسن
101253 مصطفى محمد عبداللطيف
105587 عبدالله خالد العتيبي
109585 عبدالله أحمد السريحي
113786 عثمان عبدالله الخطابي

## What was set per employee
- new_employeenumber = number
- new_fullname = Arabic name (from Excel)
- new_email = new_primaryemail = {number}@SEC.se.com.sa
  (sign-in matches identity UPN against new_primaryemail, case-insensitive — worker line ~104)
- statecode=0 / statuscode=1 (Active) — verified on all 16
- new_employees_isapprover left null (regular staff, not approvers)

## Why they show everywhere without a worker redeploy
- Worker fetches roster LIVE from Dataverse each request (register: $top=500, no statecode/email filter)
  → all 42 appear in the register + PDF automatically. No worker change needed.
- App display Arabic names come from the AR_NAMES constant (live2.html) → added 16 entries (26→42),
  sorted by number. Deployed via index.html on main → GitHub Pages.

## Verification
- dv_verify_42.py: 16/16 new present, email + active state OK. Total 42.
- App syntax: all inline scripts node --check OK.
- AR_NAMES: 42 entries, all 16 new names present.
- Live: commit d142f27 pushed to main; live /app/ serves the new AR_NAMES (marker confirmed).

## Standing facts
- 97585 remains DELETED (not re-added). If Essam wants it back, one line.
- Roster is now 42 active employees in Dataverse.
- Sign-in for new staff requires their UPN to be number@SEC.se.com.sa (standard pattern).
  If anyone's real UPN differs (like the 2 ngrid admins 63021/70180), set their new_primaryemail to that.

## Scripts (scratch/)
dv_schema.py, dv_one_record.py, dv_email_pattern.py, diff_roster2.py,
dv_insert_employees.py, dv_verify_42.py, current_roster.json, missing_employees.json, dv_insert_result.json
