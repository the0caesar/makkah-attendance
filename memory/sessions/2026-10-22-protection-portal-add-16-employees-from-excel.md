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

## Follow-up (same day)
- Name re-verification (verify_names.py): all 16 NEW names codepoint-exact vs the new Excel (app AR_NAMES + Dataverse new_fullname).
  17 of the OLD 26 differ from THIS Excel file — pre-existing, sourced from the 2026 xlsb + Essam's corrections. Left untouched.
- 97585 still absent from app + Dataverse (deliberate).
- Admin-only removed for 63021 (Ahmad Batawi) + 68589 (Nabeel Khan):
  * app const ADMIN_ONLY_NUMBERS = "" (live2.html)
  * worker wrangler.jsonc ADMIN_ONLY_NUMBERS="" → redeployed (version b4351c61)
  * commit 18bb911 on main, live-verified.
  * Both now appear as regular members in ALL team views + register/PDF. is_approver (APPR_YES) KEPT — they can still approve.
- Dataverse new_fullname for the 16 new = Arabic (only source was the Arabic Excel). Main-page header (#who, fed by whoami → new_fullname)
  therefore shows Arabic for the new people, English for the old 26. Flagged to Essam; he may want English transliterations.

## Names fully Arabic in the table (same day)
- Essam asked to convert the 26 English directory names to Arabic. Source = the approved AR_NAMES list
  (xlsb + Essam's corrections) — NOT transliteration.
- ar_names_to_table.py PATCHed new_fullname for the 26 (16 new were already Arabic). verify_all_arabic.py:
  42/42 table names now match AR_NAMES codepoint-exact, zero latin names remain.
- Effect: sign-in header (#who, fed by /api/whoami -> new_fullname) now shows Arabic for everyone.
- Directory (Graph) still not readable by the app (403) — checked; env systemusers has only the original 26,
  none of the new 16. Auto-backfill-from-id-token idea proposed to Essam, not yet approved/implemented.

## Phone sign-in hang: Ahmad (63021) / Nabeel (68589) (same day)
- Symptom: pad opens, no message, sign-in never registers, button stuck (can't tap again).
- Verified: identity OK (pad only opens post-auth), sign-in path has no approver-specific code,
  zero sign-in records for both (death is pre-POST), API_BASE = same worker origin as the page.
- Root cause (assumption labeled): Android Teams webview silently hangs getCurrentPosition when the
  host app lacks the Location permission — neither callback fires, native timeout ignored.
- Fix (commit 3e90dea, live-verified): JS watchdog in getLocation() (force-settle at ms+5s=20s);
  humanizeSignError messages now give exact phone settings steps (Settings → Apps → Teams → Location).
- Action for Ahmad/Nabeel: grant Location to the Teams app on their phones, reload, sign in.

## Owner-only visibility (commit 115771f)
- OWNER_EMPLOYEE = "70180" constant added.
- Main tabs: Today = everyone; Requests / Shifts / Approvals = owner only; Admin = all admins (unchanged).
- Admin sub-tabs: On-Call = owner only (button hidden + forced bounce to Register for non-owners).
- UI-level hiding only (nav buttons); showScreen only fires from those buttons, so hidden = unreachable.

## Settings page: refresh wipe + Save All state (commit 91c573b)
- Root cause of "refresh clobbers settings edits": refresh() every 5s (and on focus)
  -> renderCurrent() -> renderAdmin() -> renderAdminSettings() rebuilt the form.
- Fix: settingsFormLive flag — settings tab never re-rendered while live; rebuilt on
  tab entry / leaving Admin screen (unsaved edits dropped then, = Cancel semantics).
- Save All button: grey + disabled when clean, green when dirty (refreshDirty);
  re-evaluated after save.

## Per-person No-site exemption (app commit e0532c2, worker 2537d58c)
- New setting `nosite_numbers` (comma-separated employee numbers) in new_settingses.
- Admin → People page: new "No-site" toggle column (after Approver); one tap saves.
- Worker /api/signin: exempt numbers skip the GPS requirement + geofence; site logged
  as "No-site (exempt)". Time window still hard-blocks them.
- Client: exempt people skip getLocation() entirely (no GPS prompt, no phone hang).
