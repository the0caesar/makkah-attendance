# Protection Portal — weekly register: fix wrong-cell + dead pencil (2026-10-15)

## Essam's report (with screenshot)
- "it lands in the wrong cell" — the sign-in time (e.g. 10:16) rendered in a header-less column to the RIGHT of all 5 day headers.
- "cant edit it if i click the pencil" — ✎ button did nothing / "Sign-in not found".

## Root causes
1. **Header/body column mismatch.** Day header was `<th colspan="2">` (time + signature) and sub-header had 2 labels/day (وقت الحضور، التوقيع) → header = 3 + 5×2 = 13 cols. But the body rendered **4 cells per day** (in-time, in-sig, out-time, out-sig) → 3 + 5×4 = 23 cols. Body wider than header → overflow columns with no header; the time landed there.
2. **Edit handler wrong key.** `renderRegister` builds `S_regMap[date] = { si:{emp:rec}, so:{emp:rec} }` keyed by **employee number**. But the ✎ handler looked it up with `[b.dataset.id]` (the record id) → always undefined → "Sign-in not found".

## Fixes (main e05eadf)
1. Day header → `colspan="4"`; sub-header now 4 labels/day: **وقت الحضور، توقيع الحضور، وقت الانصراف، توقيع الانصراف**. Header = 3 + 5×4 = 23 cols = body. Aligned.
2. Added `data-emp` to the ✎ button; handler looks up `[b.dataset.emp]` (matches the map key). Pencil now opens the edit modal correctly.

## Verified
- node --check all blocks OK. Live (Worker /app): colspan4=2, emp-lookup present. (Byte delta vs local = CRLF normalization, content confirmed by marker greps.)

## Note
The week grid has 4 cells/day (in-time/in-sig/out-time/out-sig) — wider than the real paper Excel (2/day: حضور/انصراف). Kept the full 4-cell layout so sign-in and sign-out both stay visible; if Essam wants to match the paper exactly (merge to 2/day), that's a refinement.

## Files
`scratch/live2.html` (= main/index.html). Commit e05eadf. No worker change.
