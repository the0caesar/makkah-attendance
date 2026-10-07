"""Azure Functions wrapper for the Makkah Teams attendance API.

Thin adapter: identity from the Teams/Entra JWT, then dispatch to
api_core.handle_api (single source of truth shared with the dev proxy).

App settings (secrets): TENANT_ID, CLIENT_ID, CLIENT_SECRET, ORG_URL.
Optional: DEV_EMPLOYEE_NUMBER — when set, requests with header
`X-Dev-Identity: 1` run as that employee (curl testing only).
"""
import os, sys, json, base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import azure.functions as func
from api_core import handle_api, identity_by_email

app = func.FunctionApp()

def _claims(tok):
    try:
        p = tok.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return None

def resolve_identity(auth_header):
    """Bearer JWT (Teams silent SSO) -> identity dict, or None."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    c = _claims(auth_header[len("Bearer "):])
    if not c:
        return None
    # light validation: Entra-issued, right tenant (full MSAL validation = TODO, see SPEC §9)
    tenant = os.environ.get("TENANT_ID", "")
    iss = str(c.get("iss", ""))
    if not iss.startswith("https://login.microsoftonline.com/"):
        return None
    if tenant and c.get("tid") and c["tid"] != tenant:
        return None
    email = c.get("upn") or c.get("preferred_username") or (c.get("emails") or [None])[0]
    if not email:
        return None
    return identity_by_email(email)

def _result(res):
    if isinstance(res, tuple):
        return res[0], res[1]
    return res, 200

@app.route(route="", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"ok": True, "app": "makkah-attendance-api"}),
                             content_type="application/json")

@app.route(route="api/{path:*/path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api(req: func.HttpRequest) -> func.HttpResponse:
    # dev/testing escape hatch (disabled unless DEV_EMPLOYEE_NUMBER is set)
    dev_num = os.environ.get("DEV_EMPLOYEE_NUMBER", "")
    if dev_num and req.headers.get("X-Dev-Identity") == "1":
        import api_core
        m = api_core._identity_by_number(dev_num, os.environ.get("DEV_EMAIL"), dev=True)
    else:
        m = resolve_identity(req.headers.get("Authorization", ""))
    if not m:
        return func.HttpResponse(json.dumps({"error": "unauthorized"}), status_code=401,
                                 content_type="application/json")
    query = {k: v for k, v in (req.params or {}).items()}
    try:
        body = req.get_json().as_dict() if req.headers.get("Content-Type", "").startswith("application/json") else {}
    except Exception:
        body = {}
    res = handle_api(req.method, req.route.values.get("path", ""), query, body, m)
    obj, code = _result(res)
    return func.HttpResponse(json.dumps(obj), status_code=code, content_type="application/json")
