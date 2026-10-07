#!/usr/bin/env python3
"""Wipe E2E test rows from Dataverse (run AFTER e2e_test.sh / e2e_worker.sh).

Safe: new_signin / new_requests / new_oncall hold no production data at this
stage (the app is not live yet). new_site wipes only 'E2E Test Site'.
new_vacation is NEVER touched.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_core import call

# 1) E2E site — NOTE: plural is `new_sites`, NOT `new_siteses` (SPEC §8.4)
st, r = call("GET", "new_sites?$select=new_siteid,new_site_name&$filter=new_site_name eq 'E2E Test Site' or new_site_name eq 'E2E Live Site'")
n = 0
for row in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
    if call("DELETE", "new_sites(%s)" % row["new_siteid"])[0] == 200:
        n += 1
print("sites wiped:", n)

# 2) full wipe of the three event tables (0 rows in prod at this stage)
for tbl, key in [("new_signins", "new_signinid"), ("new_requestses", "new_requestsid"), ("new_oncalls", "new_oncallid")]:
    st, r = call("GET", tbl + "?$select=" + key)
    rows = (r.get("value") or []) if st == 200 and isinstance(r, dict) else []
    k = 0
    for row in rows:
        if call("DELETE", tbl + "(%s)" % row[key])[0] == 200:
            k += 1
    print(tbl, "rows wiped:", k, "(table had", len(rows), ")")

print("wipe complete")
