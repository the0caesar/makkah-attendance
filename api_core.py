"""Shared API core for the Makkah Teams attendance app.

Single source of truth for all /api/* logic — used by:
  - proxy/proxy.py          (local dev server)
  - functionapp/function_app.py (Azure Functions, production)

Keep the two wrappers thin; change logic HERE only.
Picklist values + OData quirks: see SPEC.md §4 and §8.
"""
import json, os, math, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta

CFG_PATH = os.path.expanduser(r"~\AppData\Local\hermes\dataverse.json")
IDENT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy", "dev_identity.json")

def load_cfg():
    return json.load(open(CFG_PATH))

CFG = load_cfg()
ORG = CFG["org_url"]
API = ORG + "/api/data/v9.2/"

def dv_token():
    d = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CFG["client_id"],
        "client_secret": CFG["client_" + "secret"],
        "scope": ORG + "/.default",
    }).encode()
    r = urllib.request.Request(
        "https://login.microsoftonline.com/%s/oauth2/v2.0/token" % CFG["tenant_id"],
        data=d, headers={"Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(r, timeout=60))["access_token"]

TOK = dv_token()
TOK_AT = 0.0

def call_h(method, path, body=None, extra=None):
    global TOK, TOK_AT
    if time.time() - TOK_AT > 5000:
        TOK = dv_token(); TOK_AT = time.time()
    url = API + urllib.parse.quote(path, safe="/?&=$(),'")
    data = json.dumps(body).encode() if body is not None else None
    h = {"Authorization": "Bearer " + TOK, "Accept": "application/json",
         "OData-MaxVersion": "4.0", "OData-Version": "4.0"}
    if body is not None:
        h["Content-Type"] = "application/json; charset=utf-8"
    if extra:
        h.update(extra)
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=90)
        b = resp.read().decode()
        return 200, (json.loads(b) if b else None), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), {}

def call(method, path, body=None, extra=None):
    st, body, _ = call_h(method, path, body, extra)
    return st, body

# ---------- picklist constants (verified 2026-10-07, see SPEC.md §4) ----------
DIR_IN, DIR_OUT = 100000001, 100000002
ALLOWED_YES, ALLOWED_NO = 100000001, 100000002
ST_REQUESTED, ST_APPROVED, ST_REJECTED, ST_CANCELLED = 100000001, 100000002, 100000003, 100000004
EXC_NO, EXC_YES = 100000001, 100000002
APPR_NO, APPR_YES = 100000001, 100000002
SRC_ROTATION, SRC_REQUEST, SRC_MANUAL = 100000001, 100000002, 100000003
SITE_ON, SITE_OFF = 100000001, 100000002

def identity_dev():
    """Dev identity from proxy/dev_identity.json (local proxy only)."""
    ident = json.load(open(IDENT_PATH))
    return _identity_by_number(str(ident["employee_number"]), ident.get("email"), dev=True)

def identity_by_email(email):
    """Production identity: Teams/Entra email -> roster person (case-insensitive)."""
    email = (email or "").strip().lower()
    if not email:
        return None
    st, r = call("GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover")
    if st != 200 or not isinstance(r, dict):
        return None
    for row in r.get("value") or []:
        if str(row.get("new_primaryemail") or "").lower() == email:
            return {"employee_number": str(row["new_employeenumber"]), "email": email,
                    "name": row.get("new_fullname"),
                    "is_approver": row.get("new_employees_isapprover") == APPR_YES,
                    "linked": True, "dev": False}
    return None

def _identity_by_number(num, email, dev=False):
    st, r = call("GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover&$filter=new_employeenumber eq '%s'" % num)
    row = r["value"][0] if (st == 200 and isinstance(r, dict) and r.get("value")) else None
    return {
        "employee_number": num,
        "email": email or (row.get("new_primaryemail") if row else None),
        "name": row.get("new_fullname") if row else None,
        "is_approver": bool(row and row.get("new_employees_isapprover") == APPR_YES),
        "linked": True,
        "dev": dev,
    }

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def get_settings():
    st, r = call("GET", "new_settingses")
    out = {}
    for row in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
        out[row["new_name"]] = row.get("new_value_str") if row.get("new_value_str") else row.get("new_value")
    return out

def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def get_sites():
    st, r = call("GET", "new_sites?$select=new_siteid,new_site_name,new_site_latstr,new_site_lonstr,new_site_radiusstr,new_site_enabled,new_site_note")
    sites = []
    for row in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
        sites.append({
            "id": row["new_siteid"], "name": row.get("new_site_name"),
            "lat": fnum(row.get("new_site_latstr")), "lon": fnum(row.get("new_site_lonstr")),
            "radius": fnum(row.get("new_site_radiusstr")), "enabled": row.get("new_site_enabled") == SITE_ON,
            "note": row.get("new_site_note"),
        })
    return sites

def geo_check(lat, lon):
    """Return (allowed, site_name, dist_m) against enabled sites."""
    best = None
    for s in get_sites():
        if not s["enabled"] or s["lat"] is None:
            continue
        d = haversine(lat, lon, s["lat"], s["lon"])
        if d <= (s["radius"] or 0):
            return True, s["name"], d
        if best is None or d < best[0]:
            best = (d, s["name"])
    return False, (best[1] if best else "No site"), (best[0] if best else None)

def req_row(row):
    return {
        "id": row.get("new_requestsid"), "name": row.get("new_requests_name"),
        "employee": row.get("new_requests_employeenumber"), "type": row.get("new_requests_type"),
        "date": (row.get("new_requests_date") or "")[:10],
        "date2": (row.get("new_requests_date2") or "")[:10],
        "otheremp": row.get("new_requests_otheremp"), "status": row.get("new_requests_status"),
        "reason": row.get("new_requests_reason"), "approver": row.get("new_requests_approver"),
        "requestedat": row.get("new_requests_requestedat"), "decidedat": row.get("new_requests_decidedat"),
        "proofurl": row.get("new_requests_proofurl"), "exceeds": row.get("new_requests_exceeds"),
        "absentnote": row.get("new_requests_absentnote"),
    }

def absence_types(settings):
    return [t.strip() for t in str(settings.get("absence_types", "")).split(",") if t.strip()]

def daily_limit(settings):
    try:
        return int(settings.get("daily_limit", 2))
    except (TypeError, ValueError):
        return 2

def limit_check(emp, date_iso, settings, exclude_id=None):
    """Return (exceeds, note) for adding one absence of `emp` on `date_iso`."""
    at = absence_types(settings)
    st, r = call("GET", "new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date&$filter=new_requests_status eq %d" % ST_APPROVED)
    rows = r.get("value") or [] if st == 200 and isinstance(r, dict) else []
    approved = [x for x in rows if x.get("new_requests_type") in at and
                (x.get("new_requests_date") or "")[:10] == date_iso and
                x.get("new_requestsid") != exclude_id]
    same_emp = [x for x in approved if x.get("new_requests_employeenumber") == str(emp)]
    limit = daily_limit(settings)
    others = [x for x in approved if x.get("new_requests_employeenumber") != str(emp)]
    note = "; ".join("%s (%s)" % (x.get("new_requests_employeenumber"), x.get("new_requests_type"))
                     for x in approved)
    return (len(same_emp) + 1 > limit, "Absences on %s: %s (limit %d)" % (date_iso, note or "none", limit))

# ---------- API handlers ----------

def handle_api(method, path, query, body, m):
    """Route one API call. `m` = identity dict (see identity_dev / identity_by_email).
    Returns a payload, or (payload, http_code)."""
    p = path.rstrip("/")
    if p == "/api/whoami":
        return m
    if p == "/api/roster":
        st, r = call("GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_site_default,new_employees_isapprover&$orderby=new_fullname")
        return [{"employee": x["new_employeenumber"], "name": x.get("new_fullname"),
                 "email": x.get("new_primaryemail"), "site": x.get("new_site_default"),
                 "is_approver": x.get("new_employees_isapprover") == APPR_YES}
                for x in (r.get("value") or [])] if st == 200 else {"error": "roster", "code": st}
    if p == "/api/settings":
        return get_settings()
    if p == "/api/sites":
        return get_sites()
    if p == "/api/signins":
        days = int(query.get("days", ["7"])[0])
        st, r = call("GET", "new_signins?$select=new_signin_name,new_signin_employeenumber,new_signin_datetime,new_signin_direction,new_signin_allowed,new_signin_site,new_signin_accstr&$orderby=new_signin_datetime desc&$top=500")
        out = []
        for x in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
            out.append({"employee": x.get("new_signin_employeenumber"),
                        "at": x.get("new_signin_datetime"),
                        "direction": "in" if x.get("new_signin_direction") == DIR_IN else "out",
                        "allowed": x.get("new_signin_allowed") == ALLOWED_YES,
                        "site": x.get("new_signin_site"),
                        "accuracy": fnum(x.get("new_signin_accstr"))})
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        return [o for o in out if (o["at"] or "") >= cutoff]
    if p == "/api/oncall":
        f = query.get("from", ["2000-01-01"])[0]; t = query.get("to", ["2999-12-31"])[0]
        st, r = call("GET", "new_oncalls?$select=new_oncall_name,new_oncall_employeenumber,new_oncall_date,new_oncall_source,new_oncall_assignedby&$filter=(new_oncall_date ge %sT00:00:00Z) and (new_oncall_date le %sT23:59:59Z)" % (f, t))
        return [{"employee": x.get("new_oncall_employeenumber"),
                 "date": (x.get("new_oncall_date") or "")[:10],
                 "source": x.get("new_oncall_source"), "assignedby": x.get("new_oncall_assignedby")}
                for x in (r.get("value") or [])] if st == 200 else []
    if p == "/api/training":
        f = query.get("from", ["2000-01-01"])[0]; t = query.get("to", ["2999-12-31"])[0]
        st, r = call("GET", "new_trainings?$select=new_training_employeenumber,new_training_course,new_training_startdate,new_training_enddate,new_training_subject&$filter=(new_training_startdate ge %sT00:00:00Z) and (new_training_enddate le %sT23:59:59Z)" % (f, t))
        return [{"employee": x.get("new_training_employeenumber"), "course": x.get("new_training_course"),
                 "start": (x.get("new_training_startdate") or "")[:10], "end": (x.get("new_training_enddate") or "")[:10],
                 "subject": x.get("new_training_subject")}
                for x in (r.get("value") or [])] if st == 200 else []
    if p == "/api/requests" and method == "GET":
        f = query.get("from", ["2000-01-01"])[0]; t = query.get("to", ["2999-12-31"])[0]
        filt = "true"
        if query.get("mine") == ["1"]:
            filt = "(new_requests_employeenumber eq '%s')" % m["employee_number"]
        if query.get("status"):
            s = {"requested": ST_REQUESTED, "approved": ST_APPROVED, "rejected": ST_REJECTED, "cancelled": ST_CANCELLED}[query["status"][0]]
            filt = "(%s) and (new_requests_status eq %d)" % (filt, s)
        st, r = call("GET", "new_requestses?$select=new_requestsid,new_requests_name,new_requests_employeenumber,new_requests_type,new_requests_date,new_requests_date2,new_requests_otheremp,new_requests_status,new_requests_reason,new_requests_approver,new_requests_requestedat,new_requests_decidedat,new_requests_proofurl,new_requests_exceeds,new_requests_absentnote&$filter=(%s) and (new_requests_date le %sT23:59:59Z) and (new_requests_date2 eq null or new_requests_date2 le %sT23:59:59Z)" % (filt, t, t))
        rows = [req_row(x) for x in (r.get("value") or [])] if st == 200 and isinstance(r, dict) else []
        rows = [x for x in rows if x["date"] >= f]
        rows.sort(key=lambda x: x["date"], reverse=True)
        return rows
    if p == "/api/signin" and method == "POST":
        b = body or {}
        direction = DIR_IN if b.get("direction") == "in" else DIR_OUT
        lat, lon = b.get("latitude"), b.get("longitude")
        settings = get_settings()
        enforce_out = str(settings.get("enforce_signout_location", "1")) == "1"
        no_loc = (lat is None or lon is None)
        if direction == DIR_IN and no_loc:
            return {"error": "location required — cannot sign in without GPS"}, 400
        if direction != DIR_IN and no_loc and enforce_out:
            return {"error": "location required — cannot sign out without GPS (enforced)"}, 400
        if no_loc:
            allowed, site, dist = True, "No check (enforced off)", None
        else:
            allowed, site, dist = geo_check(float(lat), float(lon))
            if not allowed:
                return {"error": "blocked: outside allowed locations (nearest: %s, %s m)" % (site, int(dist) if dist else "?"),
                        "allowed": False, "site": site, "distance_m": dist}, 400
        now = datetime.now(timezone.utc)
        name = "%s • %s • %s" % (m["employee_number"], now.strftime("%Y-%m-%d %H:%M"), "IN" if direction == DIR_IN else "OUT")
        pay = {"new_signin_name": name[:120], "new_signin_employeenumber": m["employee_number"],
            "new_signin_datetime": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "new_signin_direction": direction,
            "new_signin_allowed": ALLOWED_YES if allowed else ALLOWED_NO, "new_signin_site": site}
        if lat is not None:
            pay["new_signin_latstr"] = str(lat); pay["new_signin_lonstr"] = str(lon)
            pay["new_signin_accstr"] = str(float(b.get("accuracy") or 0))
        st, r = call("POST", "new_signins", pay)
        return {"ok": True, "at": now.isoformat(), "site": site, "distance_m": dist} if st in (200, 201, 204) else {"error": "write failed", "code": st, "body": str(r)[:300]}, (200 if st in (200, 201, 204) else 400)
    if p == "/api/requests" and method == "POST":
        b = body or {}
        rtype = (b.get("type") or "").strip()
        date = (b.get("date") or "")[:10]
        if not rtype or not date:
            return {"error": "type and date required"}, 400
        settings = get_settings()
        allowed_types = [t.strip() for t in str(settings.get("request_types", "")).split(",") if t.strip()]
        if allowed_types and rtype not in allowed_types:
            return {"error": "unknown type: %s" % rtype}, 400
        pay = {"new_requests_name": ("%s • %s • %s" % (m["employee_number"], rtype, date))[:150],
               "new_requests_employeenumber": m["employee_number"], "new_requests_type": rtype,
               "new_requests_date": date + "T00:00:00Z", "new_requests_reason": (b.get("reason") or "")[:300],
               "new_requests_requestedat": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "new_requests_status": ST_REQUESTED}
        if b.get("date2"):
            pay["new_requests_date2"] = b["date2"][:10] + "T00:00:00Z"
        if b.get("otheremp"):
            pay["new_requests_otheremp"] = str(b["otheremp"])[:20]
        if b.get("proofurl"):
            pay["new_requests_proofurl"] = b["proofurl"][:500]
        if rtype == "Training":  # no approval (constraint 8)
            pay["new_requests_status"] = ST_APPROVED
            pay["new_requests_decidedat"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            pay["new_requests_approver"] = "auto (training)"
        exc = False
        if rtype in absence_types(settings):
            exc, note = limit_check(m["employee_number"], date, settings)
            pay["new_requests_exceeds"] = EXC_YES if exc else EXC_NO
            if exc:
                pay["new_requests_absentnote"] = note[:500]
        st, r2, hdrs = call_h("POST", "new_requestses", pay)
        if st in (200, 201, 204):
            rid = r2.get("new_requestsid", "") if isinstance(r2, dict) else ""
            if not rid:
                loc = hdrs.get("Location", "")
                seg = loc.rstrip("/").rsplit("/", 1)[-1]
                rid = seg.split("(")[1].rstrip(")") if "(" in seg else seg
            return {"ok": True, "id": rid, "exceeds": exc}
        return {"error": "write failed", "code": st, "body": str(r2)[:300]}, 400
    if p.startswith("/api/requests/") and method in ("PATCH", "DELETE"):
        rid = p.split("/")[-1]
        st, r = call("GET", "new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date,new_requests_otheremp,new_requests_name&$filter=new_requestsid eq '%s'" % rid)
        if st != 200 or not (isinstance(r, dict) and r.get("value")):
            return {"error": "not found"}, 404
        row = r["value"][0]
        is_owner = row.get("new_requests_employeenumber") == m["employee_number"]
        action = (body or {}).get("action") if method == "PATCH" else "cancel"
        if action == "cancel":
            if not is_owner and not m["is_approver"]:
                return {"error": "forbidden"}, 403
            st, r2 = call("PATCH", "new_requestses(%s)" % rid, {
                "new_requests_status": ST_CANCELLED,
                "new_requests_decidedat": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "new_requests_approver": m["email"]})
            was_approved = row.get("new_requests_status") == ST_APPROVED
            return {"ok": True, "notify_supervisors": was_approved} if st == 200 else {"error": "write failed", "code": st}
        if action in ("approve", "reject"):
            if not m["is_approver"]:
                return {"error": "forbidden: approver only"}, 403
            st, r2 = call("PATCH", "new_requestses(%s)" % rid, {
                "new_requests_status": ST_APPROVED if action == "approve" else ST_REJECTED,
                "new_requests_approver": m["email"],
                "new_requests_decidedat": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
            if st != 200:
                return {"error": "write failed", "code": st}, 400
            if action == "approve" and row.get("new_requests_type") == "On-Call":
                d = (row.get("new_requests_date") or "")[:10]
                emp = row.get("new_requests_employeenumber")
                if row.get("new_requests_otheremp"):
                    st2, r3 = call("GET", "new_oncalls?$select=new_oncall_name&$filter=" + urllib.parse.quote(
                        "(new_oncall_employeenumber eq '%s') and (new_oncall_date eq datetime'%sT00:00:00Z')" % (row["new_requests_otheremp"], d), safe="'"))
                    for o in (r3.get("value") or []) if st2 == 200 and isinstance(r3, dict) else []:
                        call("DELETE", "new_oncalls('%s')" % o["new_oncall_name"])
                st3, r4 = call("POST", "new_oncalls", {
                    "new_oncall_name": ("OC • %s • %s" % (emp, d))[:120],
                    "new_oncall_employeenumber": emp, "new_oncall_date": d + "T00:00:00Z",
                    "new_oncall_source": SRC_REQUEST, "new_oncall_assignedby": m["email"]})
                if st3 not in (200, 201, 204):
                    return {"ok": True, "oncall_write_failed": st3}
            return {"ok": True}
        return {"error": "unknown action"}, 400
    # ---------- admin ----------
    if p.startswith("/api/admin/"):
        if not m["is_approver"]:
            return {"error": "forbidden: approver only"}, 403
        ap = p[len("/api/admin/"):]
        if ap == "oncall" and method == "POST":
            b = body or {}
            emp = str(b.get("employeenumber") or "").strip()
            dates = b.get("dates") or []
            if not emp or not dates:
                return {"error": "employeenumber + dates required"}, 400
            written = 0
            for d in dates:
                d = d[:10]
                st, r = call("GET", "new_oncalls?$select=new_oncall_name&$filter=(new_oncall_employeenumber eq '%s') and (new_oncall_date eq datetime'%sT00:00:00Z')" % (emp, d))
                for o in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
                    call("DELETE", "new_oncalls('%s')" % o["new_oncall_name"])
                st, r = call("POST", "new_oncalls", {
                    "new_oncall_name": ("OC • %s • %s" % (emp, d))[:120],
                    "new_oncall_employeenumber": emp, "new_oncall_date": d + "T00:00:00Z",
                    "new_oncall_source": SRC_ROTATION, "new_oncall_assignedby": m["email"]})
                if st in (200, 201, 204):
                    written += 1
            return {"ok": True, "written": written}
        if ap == "oncall" and method == "DELETE":
            emp = query.get("emp", [""])[0]; d = (query.get("date", [""])[0])[:10]
            st, r = call("GET", "new_oncalls?$select=new_oncall_name&$filter=(new_oncall_employeenumber eq '%s') and (new_oncall_date eq datetime'%sT00:00:00Z')" % (emp, d))
            n = 0
            for o in (r.get("value") or []) if st == 200 and isinstance(r, dict) else []:
                if call("DELETE", "new_oncalls('%s')" % o["new_oncall_name"])[0] == 200:
                    n += 1
            return {"ok": True, "deleted": n}
        if ap == "sites" and method == "POST":
            b = body or {}
            st, r, hdrs = call_h("POST", "new_sites", {
                "new_site_name": (b.get("name") or "Site")[:100],
                "new_site_latstr": str(float(b.get("latitude") or 0)),
                "new_site_lonstr": str(float(b.get("longitude") or 0)),
                "new_site_radiusstr": str(float(b.get("radius") or 200)),
                "new_site_enabled": SITE_ON, "new_site_note": (b.get("note") or "")[:300]})
            sid = r.get("new_siteid", "") if isinstance(r, dict) else ""
            if not sid:
                seg = hdrs.get("Location", "").rstrip("/").rsplit("/", 1)[-1]
                sid = seg.split("(")[1].rstrip(")") if "(" in seg else seg
            return {"ok": True, "id": sid} if st in (200, 201, 204) else {"error": "write failed", "code": st, "body": str(r)[:300]}, 400
        if ap.startswith("sites/") and method == "PATCH":
            sid = ap.split("/")[-1]
            b = body or {}
            pay = {}
            if "enabled" in b:
                pay["new_site_enabled"] = SITE_ON if b["enabled"] else SITE_OFF
            if "radius" in b:
                pay["new_site_radiusstr"] = str(float(b["radius"]))
            if "latitude" in b:
                pay["new_site_latstr"] = str(float(b["latitude"]))
            if "longitude" in b:
                pay["new_site_lonstr"] = str(float(b["longitude"]))
            st, r = call("PATCH", "new_sites(%s)" % sid, pay)
            return {"ok": True} if st == 200 else {"error": "write failed", "code": st}
        if ap.startswith("employees/") and method == "PATCH":
            num = ap.split("/")[-1]
            b = body or {}
            pay = {}
            if "teams_email" in b:
                pay["new_teams_email"] = b["teams_email"]
            if "is_approver" in b:
                pay["new_employees_isapprover"] = APPR_YES if b["is_approver"] else APPR_NO
            st, r = call("GET", "new_employeeses?$select=new_employeesid&$filter=new_employeenumber eq '%s'" % num)
            if not (st == 200 and isinstance(r, dict) and r.get("value")):
                return {"error": "employee not found"}, 404
            st, r = call("PATCH", "new_employeeses(%s)" % r["value"][0]["new_employeesid"], pay)
            return {"ok": True} if st == 200 else {"error": "write failed", "code": st, "body": str(r)[:200]}
        if ap == "settings" and method == "POST":
            b = body or {}
            name = b.get("name")
            if not name:
                return {"error": "name required"}, 400
            st, r = call("GET", "new_settingses?$filter=new_name eq '%s'" % name)
            pay = {"new_value_str": str(b.get("value_str", ""))[:200], "new_desc": (b.get("desc") or "")[:300]}
            if b.get("value") is not None:
                pay["new_value"] = str(int(b["value"]))
            if st == 200 and isinstance(r, dict) and r.get("value"):
                st2, r2 = call("PATCH", "new_settingses(%s)" % r["value"][0]["new_settingsid"], pay)
                return {"ok": True} if st2 == 200 else {"error": "write failed", "code": st2}
            pay["new_name"] = name
            st2, r2 = call("POST", "new_settingses", pay)
            return {"ok": True} if st2 in (200, 201, 204) else {"error": "write failed", "code": st2, "body": str(r2)[:200]}
        return {"error": "unknown admin endpoint"}, 404
    return {"error": "not found: " + path}, 404
