#!/usr/bin/env python3
"""
Local dev proxy for the Makkah Teams attendance app.
Serves ../app/ statically and forwards /api/* to Dataverse.
ALL api logic lives in api_core.py (shared with the Azure Function) — keep this thin.
Dev identity comes from dev_identity.json.
Run:  python proxy/proxy.py   →  http://localhost:8787
"""
import os, sys, json, urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(BASE))
from api_core import handle_api, identity_dev

APP_DIR = os.path.normpath(os.path.join(BASE, "..", "app"))
PORT = 8787

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _result(self, res):
        if isinstance(res, tuple):
            return res[0], res[1]
        return res, 200

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            res = handle_api("GET", self.path.split("?")[0], self._q(), None, identity_dev())
            obj, code = self._result(res)
            self._send_json(obj, code)
            return
        return super().do_GET()

    def _q(self):
        return urllib.parse.parse_qs(self.path.split("?")[1] if "?" in self.path else "")

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode())
        except Exception:
            return {}

    def do_POST(self):
        if self.path.startswith("/api/"):
            res = handle_api("POST", self.path, self._q(), self._read_body(), identity_dev())
            obj, code = self._result(res)
            self._send_json(obj, code)
            return
        return super().do_POST()

    def do_PATCH(self):
        if self.path.startswith("/api/"):
            res = handle_api("PATCH", self.path, self._q(), self._read_body(), identity_dev())
            obj, code = self._result(res)
            self._send_json(obj, code)
            return
        return super().do_PATCH()

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            res = handle_api("DELETE", self.path, self._q(), None, identity_dev())
            obj, code = self._result(res)
            self._send_json(obj, code)
            return
        return super().do_DELETE()

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + fmt % args + "\n")

if __name__ == "__main__":
    print("Makkah attendance proxy → http://localhost:%d  (app dir: %s)" % (PORT, APP_DIR))
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
