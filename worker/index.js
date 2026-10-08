/* Makkah Attendance API — Cloudflare Worker (production API).
 *
 * JS PORT of api_core.py (the Python reference implementation).
 * Source of truth for all API semantics: SPEC.md §4 (data model) + §8 (gotchas).
 * If logic changes, change api_core.py AND this file (or regenerate).
 *
 * Identity:
 *   - DEV: env.DEV_EMPLOYEE_NUMBER set -> dev identity (X-Dev-Email optional).
 *   - PROD: Authorization: Bearer <MSAL JWT> -> decode email/preferred_username
 *           (v1: decode-only; JWKS signature verification = step 8b hardening).
 *           -> roster match on new_primaryemail (case-insensitive) + is_approver.
 *
 * Secrets (wrangler secret / .dev.vars): DV_CLIENT_SECRET
 * Plain vars (wrangler.jsonc): DV_ORG_URL, DV_TENANT_ID, DV_CLIENT_ID,
 *   ALLOWED_ORIGIN, DEV_EMPLOYEE_NUMBER (dev only), DEV_DEV_EMAIL (dev only).
 */

// ---------- URL quoting (parity with Python urllib.parse.quote, safe="/?&=$(),'") ----------
const SAFE = /^[A-Za-z0-9_.\-~\/\?\&=\$\(\),']$/;
function qpath(s) {
  let out = "";
  for (const c of s) out += SAFE.test(c) ? c : encodeURIComponent(c);
  return out;
}
// parity with quote(..., safe="'") used by api_core.py:344 (on-call swap pre-delete)
const SAFE2 = /^[A-Za-z0-9_.\-~']$/;
function qstrict(s) {
  let out = "";
  for (const c of s) out += SAFE2.test(c) ? c : encodeURIComponent(c);
  return out;
}

// ---------- Dataverse client ----------
let TOK = null, TOK_AT = 0;

async function dvToken(env) {
  const d = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.DV_CLIENT_ID,
    client_secret: env.DV_CLIENT_SECRET,
    scope: env.DV_ORG_URL + "/.default",
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${env.DV_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const j = await r.json();
  if (!j.access_token) throw new Error("token endpoint failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

function isObj(x) { return x !== null && typeof x === "object"; }

async function callH(env, method, path, body, extra) {
  if (Date.now() / 1000 - TOK_AT > 5000) { TOK = await dvToken(env); TOK_AT = Date.now() / 1000; }
  const url = (env.DV_ORG_URL + "/api/data/v9.2/") + qpath(path);
  const h = {
    Authorization: "Bearer " + TOK,
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
  };
  const init = { method, headers: h };
  if (body !== null && body !== undefined) {
    h["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  if (extra) Object.assign(h, extra);
  const resp = await fetch(url, init);
  const t = await resp.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  const hdrs = {};
  resp.headers.forEach((v, k) => { hdrs[k] = v; });
  // parity with Python urllib: any 2xx => "200" (call_h hardcoded 200 on success);
  // only HTTPError (4xx/5xx) surfaces its real code.
  const status = resp.ok ? 200 : resp.status;
  // parity with Python: 200-with-body -> parsed object; else -> raw string (or undefined if empty)
  return { status, body: j !== null ? j : (t || undefined), headers: hdrs };
}
function call(env, method, path, body) { return callH(env, method, path, body); }

// ---------- picklist constants (verified 2026-10-07, SPEC.md §4) ----------
const DIR_IN = 100000001, DIR_OUT = 100000002;
const ALLOWED_YES = 100000001;
const ST_REQUESTED = 100000001, ST_APPROVED = 100000002, ST_REJECTED = 100000003, ST_CANCELLED = 100000004;
const EXC_YES = 100000002;
const APPR_YES = 100000002, APPR_NO = 100000001;
const SRC_REQUEST = 100000002, SRC_ROTATION = 100000001;
const SITE_ON = 100000001, SITE_OFF = 100000002;

// ---------- dates (UTC, parity with Python datetime.strftime) ----------
const nowZ = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const nameStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const d10 = (v) => (v || "").slice(0, 10);

// ---------- identity ----------
async function identityByEmail(env, email) {
  email = (email || "").trim().toLowerCase();
  if (!email) return null;
  const r = await call(env, "GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover");
  if (r.status !== 200 || !isObj(r.body)) return null;
  for (const row of r.body.value || []) {
    if (String(row.new_primaryemail || "").toLowerCase() === email) {
      return {
        employee_number: String(row.new_employeenumber), email,
        name: row.new_fullname, is_approver: row.new_employees_isapprover === APPR_YES,
        linked: true, dev: false,
      };
    }
  }
  return null;
}

async function identityByNumber(env, num, email, dev) {
  const r = await call(env, "GET",
    `new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover&$filter=new_employeenumber eq '${num}'`);
  const row = (r.status === 200 && isObj(r.body) && (r.body.value || [])[0]) || null;
  return {
    employee_number: num,
    email: email || (row && row.new_primaryemail) || null,
    name: row ? row.new_fullname : null,
    is_approver: !!(row && row.new_employees_isapprover === APPR_YES),
    linked: true, dev: !!dev,
  };
}

function jwtEmail(req) {
  const a = req.headers.get("authorization") || "";
  const m = a.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || payload.preferred_username || null;
  } catch { return null; }
}

// ---------- geofence ----------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fnum(v) { const f = parseFloat(v); return Number.isFinite(f) ? f : null; }

async function getSettings(env) {
  const r = await call(env, "GET", "new_settingses");
  const out = {};
  if (r.status === 200 && isObj(r.body)) {
    for (const row of r.body.value || []) {
      out[row.new_name] = row.new_value_str || row.new_value;
    }
  }
  return out;
}

async function getSites(env) {
  const r = await call(env, "GET",
    "new_sites?$select=new_siteid,new_site_name,new_site_latstr,new_site_lonstr,new_site_radiusstr,new_site_enabled,new_site_note");
  const sites = [];
  if (r.status === 200 && isObj(r.body)) {
    for (const row of r.body.value || []) {
      sites.push({
        id: row.new_siteid, name: row.new_site_name,
        lat: fnum(row.new_site_latstr), lon: fnum(row.new_site_lonstr),
        radius: fnum(row.new_site_radiusstr), enabled: row.new_site_enabled === SITE_ON,
        note: row.new_site_note,
      });
    }
  }
  return sites;
}

// returns [allowed, siteName, distM]
async function geoCheck(env, lat, lon) {
  let best = null;
  for (const s of await getSites(env)) {
    if (!s.enabled || s.lat === null) continue;
    const d = haversine(lat, lon, s.lat, s.lon);
    if (d <= (s.radius || 0)) return [true, s.name, d];
    if (!best || d < best[0]) best = [d, s.name];
  }
  return [false, best ? best[1] : "No site", best ? best[0] : null];
}

function reqRow(row) {
  return {
    id: row.new_requestsid, name: row.new_requests_name,
    employee: row.new_requests_employeenumber, type: row.new_requests_type,
    date: d10(row.new_requests_date), date2: d10(row.new_requests_date2),
    otheremp: row.new_requests_otheremp, status: row.new_requests_status,
    reason: row.new_requests_reason, approver: row.new_requests_approver,
    requestedat: row.new_requests_requestedat, decidedat: row.new_requests_decidedat,
    proofurl: row.new_requests_proofurl, exceeds: row.new_requests_exceeds,
    absentnote: row.new_requests_absentnote,
  };
}

function absenceTypes(settings) {
  return String(settings.absence_types || "").split(",").map((t) => t.trim()).filter(Boolean);
}
function dailyLimit(settings) {
  const n = parseInt(settings.daily_limit ?? 2, 10);
  return Number.isFinite(n) ? n : 2;
}

// returns [exceeds, note]
async function limitCheck(env, emp, dateIso, settings, excludeId) {
  const at = absenceTypes(settings);
  const r = await call(env, "GET",
    `new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date&$filter=new_requests_status eq ${ST_APPROVED}`);
  const rows = (r.status === 200 && isObj(r.body)) ? (r.body.value || []) : [];
  const approved = rows.filter((x) => at.includes(x.new_requests_type) &&
    d10(x.new_requests_date) === dateIso && x.new_requestsid !== excludeId);
  const sameEmp = approved.filter((x) => x.new_requests_employeenumber === String(emp));
  const others = approved.filter((x) => x.new_requests_employeenumber !== String(emp));
  const note = approved.map((x) => `${x.new_requests_employeenumber} (${x.new_requests_type})`).join("; ");
  return [
    sameEmp.length + 1 > dailyLimit(settings),
    `Absences on ${dateIso}: ${note || "none"} (limit ${dailyLimit(settings)})`,
  ];
}

// ---------- API handlers (1:1 port of api_core.handle_api) ----------
async function handleApi(env, method, path, q, body, m) {
  const p = path.replace(/\/+$/, "");
  const g = (k, dflt) => (q[k] ? q[k][0] : dflt);

  if (p === "/api/whoami") return m;

  if (p === "/api/roster") {
    const r = await call(env, "GET",
      "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_site_default,new_employees_isapprover&$orderby=new_fullname");
    if (r.status !== 200) return { error: "roster", code: r.status };
    // admin-only staff: keep full roster access + admin, hidden from all team views.
    // Managed via ADMIN_ONLY_NUMBERS env var (comma-separated employee numbers).
    const adminOnly = new Set(String(env.ADMIN_ONLY_NUMBERS || "").split(",").map(s => s.trim()).filter(Boolean));
    return (r.body.value || []).map((x) => ({
      employee: x.new_employeenumber, name: x.new_fullname, email: x.new_primaryemail,
      site: x.new_site_default, is_approver: x.new_employees_isapprover === APPR_YES,
      admin_only: adminOnly.has(String(x.new_employeenumber)),
    }));
  }

  if (p === "/api/settings") return getSettings(env);
  if (p === "/api/sites") return getSites(env);

  if (p === "/api/signins") {
    const days = parseInt(g("days", "7"), 10) || 7;
    const r = await call(env, "GET",
      "new_signins?$select=new_signinid,new_signin_name,new_signin_employeenumber,new_signin_datetime,new_signin_direction,new_signin_allowed,new_signin_site,new_signin_accstr,new_signin_note&$orderby=new_signin_datetime desc&$top=500");
    const out = [];
    if (r.status === 200 && isObj(r.body)) {
      for (const x of r.body.value || []) {
        out.push({
          id: x.new_signinid,
          employee: x.new_signin_employeenumber, at: x.new_signin_datetime,
          direction: x.new_signin_direction === DIR_IN ? "in" : "out",
          allowed: x.new_signin_allowed === ALLOWED_YES, site: x.new_signin_site,
          accuracy: fnum(x.new_signin_accstr), note: x.new_signin_note || "",
        });
      }
    }
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return out.filter((o) => (o.at || "") >= cutoff);
  }

  if (p === "/api/oncall") {
    const f = g("from", "2000-01-01"), t = g("to", "2999-12-31");
    const r = await call(env, "GET",
      `new_oncalls?$select=new_oncall_name,new_oncall_employeenumber,new_oncall_date,new_oncall_source,new_oncall_assignedby&$filter=(new_oncall_date ge ${f}T00:00:00Z) and (new_oncall_date le ${t}T23:59:59Z)&$top=10000`);
    if (r.status !== 200) return [];
    return (r.body.value || []).map((x) => ({
      employee: x.new_oncall_employeenumber, date: d10(x.new_oncall_date),
      source: x.new_oncall_source, assignedby: x.new_oncall_assignedby,
    }));
  }

  if (p === "/api/training") {
    const f = g("from", "2000-01-01"), t = g("to", "2999-12-31");
    const r = await call(env, "GET",
      `new_trainings?$select=new_training_employeenumber,new_training_course,new_training_startdate,new_training_enddate,new_training_subject&$filter=(new_training_startdate ge ${f}T00:00:00Z) and (new_training_enddate le ${t}T23:59:59Z)&$top=10000`);
    if (r.status !== 200) return [];
    return (r.body.value || []).map((x) => ({
      employee: x.new_training_employeenumber, course: x.new_training_course,
      start: d10(x.new_training_startdate), end: d10(x.new_training_enddate),
      subject: x.new_training_subject,
    }));
  }

  if (p === "/api/requests" && method === "GET") {
    const f = g("from", "2000-01-01"), t = g("to", "2999-12-31");
    let filt = "true";
    if (q.mine && q.mine[0] === "1") filt = `(new_requests_employeenumber eq '${m.employee_number}')`;
    if (q.status) {
      const map = { requested: ST_REQUESTED, approved: ST_APPROVED, rejected: ST_REJECTED, cancelled: ST_CANCELLED };
      filt = `(${filt}) and (new_requests_status eq ${map[q.status[0]]})`;
    }
    const r = await call(env, "GET",
      `new_requestses?$select=new_requestsid,new_requests_name,new_requests_employeenumber,new_requests_type,new_requests_date,new_requests_date2,new_requests_otheremp,new_requests_status,new_requests_reason,new_requests_approver,new_requests_requestedat,new_requests_decidedat,new_requests_proofurl,new_requests_exceeds,new_requests_absentnote&$filter=(${filt}) and (new_requests_date le ${t}T23:59:59Z) and (new_requests_date2 eq null or new_requests_date2 le ${t}T23:59:59Z)&$top=10000`);
    let rows = (r.status === 200 && isObj(r.body)) ? (r.body.value || []).map(reqRow) : [];
    rows = rows.filter((x) => x.date >= f);
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  }

  if (p === "/api/signin" && method === "POST") {
    const b = body || {};
    const direction = b.direction === "in" ? DIR_IN : DIR_OUT;
    const lat = b.latitude, lon = b.longitude;
    const settings = await getSettings(env);
    // Time-window hard block (shift_start–shift_end, AST). Reads the CONFIGURED
    // shift times so a Ramadan shift (or any change) only needs a settings update,
    // never a code change. Applied to sign-in AND sign-out.
    const nowAst = new Date(Date.now() + AST_OFFSET_MIN * 60000);
    const nowMin = nowAst.getUTCHours() * 60 + nowAst.getUTCMinutes();
    const winStart = hhmmToMin(settings.shift_start);
    const winEnd = hhmmToMin(settings.shift_end);
    if (winStart != null && winEnd != null && (nowMin < winStart || nowMin > winEnd)) {
      return [{ error: `outside work hours (${settings.shift_start}–${settings.shift_end} AST)`, allowed: false }, 400];
    }
    const enforceOut = String(settings.enforce_signout_location ?? "1") === "1";
    const noLoc = lat === null || lat === undefined || lon === null || lon === undefined;
    if (direction === DIR_IN && noLoc) return [{ error: "location required — cannot sign in without GPS" }, 400];
    if (direction !== DIR_IN && noLoc && enforceOut) return [{ error: "location required — cannot sign out without GPS (enforced)" }, 400];
    let allowed, site, dist;
    if (noLoc) { allowed = true; site = "No check (enforced off)"; dist = null; }
    else {
      [allowed, site, dist] = await geoCheck(env, parseFloat(lat), parseFloat(lon));
      if (!allowed) return [
        { error: `blocked: outside allowed locations (nearest: ${site}, ${dist ? Math.floor(dist) : "?"} m)`,
          allowed: false, site, distance_m: dist }, 400];
    }
    const now = new Date();
    const name = `${m.employee_number} • ${nameStamp()} • ${direction === DIR_IN ? "IN" : "OUT"}`.slice(0, 120);
    const pay = {
      new_signin_name: name,
      new_signin_employeenumber: m.employee_number,
      new_signin_datetime: nowZ(),
      new_signin_direction: direction,
      new_signin_allowed: allowed ? ALLOWED_YES : 100000002,
      new_signin_site: site,
    };
    if (lat !== null && lat !== undefined) {
      pay.new_signin_latstr = String(parseFloat(lat));
      pay.new_signin_lonstr = String(parseFloat(lon));
      pay.new_signin_accstr = String(parseFloat(b.accuracy || 0));
    }
    const r = await call(env, "POST", "new_signins", pay);
    if ([200, 201, 204].includes(r.status)) return [{ ok: true, at: now.toISOString(), site, distance_m: dist }];
    return [{ error: "write failed", code: r.status, body: String(r.body).slice(0, 300) }, 400];
  }

  if (p === "/api/requests" && method === "POST") {
    const b = body || {};
    const rtype = (b.type || "").trim();
    const date = (b.date || "").slice(0, 10);
    if (!rtype || !date) return [{ error: "type and date required" }, 400];
    const settings = await getSettings(env);
    const allowedTypes = String(settings.request_types || "").split(",").map((t) => t.trim()).filter(Boolean);
    if (allowedTypes.length && !allowedTypes.includes(rtype)) return [{ error: `unknown type: ${rtype}` }, 400];
    const pay = {
      new_requests_name: `${m.employee_number} • ${rtype} • ${date}`.slice(0, 150),
      new_requests_employeenumber: m.employee_number,
      new_requests_type: rtype,
      new_requests_date: date + "T00:00:00Z",
      new_requests_reason: (b.reason || "").slice(0, 300),
      new_requests_requestedat: nowZ(),
      new_requests_status: ST_REQUESTED,
    };
    if (b.date2) pay.new_requests_date2 = String(b.date2).slice(0, 10) + "T00:00:00Z";
    if (b.otheremp) pay.new_requests_otheremp = String(b.otheremp).slice(0, 20);
    if (b.proofurl) pay.new_requests_proofurl = String(b.proofurl).slice(0, 500);
    if (rtype === "Training") { // no approval (constraint 8)
      pay.new_requests_status = ST_APPROVED;
      pay.new_requests_decidedat = nowZ();
      pay.new_requests_approver = "auto (training)";
    }
    let exc = false, note = null;
    if (absenceTypes(settings).includes(rtype)) {
      [exc, note] = await limitCheck(env, m.employee_number, date, settings);
      pay.new_requests_exceeds = exc ? EXC_YES : 100000001;
      if (exc) pay.new_requests_absentnote = note.slice(0, 500);
    }
    const r = await callH(env, "POST", "new_requestses", pay);
    if ([200, 201, 204].includes(r.status)) {
      let rid = isObj(r.body) ? (r.body.new_requestsid || "") : "";
      if (!rid) {
        const loc = r.headers.location || "";
        const seg = loc.replace(/\/+$/, "").split("/").pop() || "";
        rid = seg.includes("(") ? seg.split("(")[1].replace(/\)$/, "") : seg;
      }
      return { ok: true, id: rid, exceeds: exc };
    }
    return [{ error: "write failed", code: r.status, body: String(r.body).slice(0, 300) }, 400];
  }

  if (p.startsWith("/api/requests/") && (method === "PATCH" || method === "DELETE")) {
    const rid = p.split("/").pop();
    const r = await call(env, "GET",
      `new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date,new_requests_otheremp,new_requests_name&$filter=new_requestsid eq '${rid}'`);
    if (r.status !== 200 || !(isObj(r.body) && (r.body.value || []).length)) return [{ error: "not found" }, 404];
    const row = r.body.value[0];
    const isOwner = row.new_requests_employeenumber === m.employee_number;
    const action = method === "PATCH" ? ((body || {}).action || null) : "cancel";
    if (action === "cancel") {
      if (!isOwner && !m.is_approver) return [{ error: "forbidden" }, 403];
      const r2 = await call(env, "PATCH", `new_requestses(${rid})`, {
        new_requests_status: ST_CANCELLED,
        new_requests_decidedat: nowZ(),
        new_requests_approver: m.email,
      });
      const wasApproved = row.new_requests_status === ST_APPROVED;
      return r2.status === 200
        ? { ok: true, notify_supervisors: wasApproved }
        : [{ error: "write failed", code: r2.status }, 400];
    }
    if (action === "approve" || action === "reject") {
      if (!m.is_approver) return [{ error: "forbidden: admin only" }, 403];
      const r2 = await call(env, "PATCH", `new_requestses(${rid})`, {
        new_requests_status: action === "approve" ? ST_APPROVED : ST_REJECTED,
        new_requests_approver: m.email,
        new_requests_decidedat: nowZ(),
      });
      if (r2.status !== 200) return [{ error: "write failed", code: r2.status }, 400];
      if (action === "approve" && row.new_requests_type === "On-Call") {
        const d = d10(row.new_requests_date);
        const emp = row.new_requests_employeenumber;
        if (row.new_requests_otheremp) {
          const r3 = await call(env, "GET",
            `new_oncalls?$select=new_oncallid&$filter=(new_oncall_employeenumber eq '${row.new_requests_otheremp}') and (new_oncall_date eq ${d}T00:00:00Z)`);
          if (r3.status === 200 && isObj(r3.body)) {
            for (const o of r3.body.value || []) await call(env, "DELETE", `new_oncalls(${o.new_oncallid})`);
          }
        }
        const r4 = await call(env, "POST", "new_oncalls", {
          new_oncall_name: `OC • ${emp} • ${d}`.slice(0, 120),
          new_oncall_employeenumber: emp,
          new_oncall_date: d + "T00:00:00Z",
          new_oncall_source: SRC_REQUEST,
          new_oncall_assignedby: m.email,
        });
        if (![200, 201, 204].includes(r4.status)) return { ok: true, oncall_write_failed: r4.status };
      }
      return { ok: true };
    }
    return [{ error: "unknown action" }, 400];
  }

  // ---------- admin ----------
  if (p.startsWith("/api/admin/")) {
    if (!m.is_approver) return [{ error: "forbidden: admin only" }, 403];
    const ap = p.slice("/api/admin/".length);

    if (ap === "oncall" && method === "POST") {
      const b = body || {};
      const emp = String(b.employeenumber || "").trim();
      const dates = b.dates || [];
      if (!emp || !dates.length) return [{ error: "employeenumber + dates required" }, 400];
      let written = 0;
      for (let d of dates) {
        d = String(d).slice(0, 10);
        const r = await call(env, "GET",
          `new_oncalls?$select=new_oncallid,new_oncall_name&$filter=(new_oncall_employeenumber eq '${emp}') and (new_oncall_date eq ${d}T00:00:00Z)`);
        if (r.status === 200 && isObj(r.body)) {
          for (const o of r.body.value || []) await call(env, "DELETE", `new_oncalls(${o.new_oncallid})`);
        }
        const r2 = await call(env, "POST", "new_oncalls", {
          new_oncall_name: `OC • ${emp} • ${d}`.slice(0, 120),
          new_oncall_employeenumber: emp,
          new_oncall_date: d + "T00:00:00Z",
          new_oncall_source: SRC_ROTATION,
          new_oncall_assignedby: m.email,
        });
        if ([200, 201, 204].includes(r2.status)) written += 1;
      }
      return { ok: true, written };
    }

    if (ap === "oncall" && method === "DELETE") {
      const emp = g("emp", ""), d = g("date", "").slice(0, 10);
      const r = await call(env, "GET",
        `new_oncalls?$select=new_oncallid&$filter=(new_oncall_employeenumber eq '${emp}') and (new_oncall_date eq ${d}T00:00:00Z)`);
      let n = 0;
      if (r.status === 200 && isObj(r.body)) {
        for (const o of r.body.value || []) {
          const r2 = await call(env, "DELETE", `new_oncalls(${o.new_oncallid})`);
          if ([200, 204].includes(r2.status)) n += 1;
        }
      }
      return { ok: true, deleted: n };
    }

    if (ap === "sites" && method === "POST") {
      const b = body || {};
      const r = await callH(env, "POST", "new_sites", {
        new_site_name: (b.name || "Site").slice(0, 100),
        new_site_latstr: String(parseFloat(b.latitude || 0)),
        new_site_lonstr: String(parseFloat(b.longitude || 0)),
        new_site_radiusstr: String(parseFloat(b.radius || 200)),
        new_site_enabled: SITE_ON,
        new_site_note: (b.note || "").slice(0, 300),
      });
      let sid = isObj(r.body) ? (r.body.new_siteid || "") : "";
      if (!sid) {
        const loc = (r.headers.location || "").replace(/\/+$/, "");
        const seg = loc.split("/").pop() || "";
        sid = seg.includes("(") ? seg.split("(")[1].replace(/\)$/, "") : seg;
      }
      if ([200, 201, 204].includes(r.status)) return { ok: true, id: sid };
      return [{ error: "write failed", code: r.status, body: String(r.body).slice(0, 300) }, 400];
    }

    if (ap.startsWith("sites/") && method === "PATCH") {
      const sid = ap.split("/").pop();
      const b = body || {};
      const pay = {};
      if ("name" in b) pay.new_site_name = String(b.name).slice(0, 100);
      if ("enabled" in b) pay.new_site_enabled = b.enabled ? SITE_ON : SITE_OFF;
      if ("radius" in b) pay.new_site_radiusstr = String(parseFloat(b.radius));
      if ("latitude" in b) pay.new_site_latstr = String(parseFloat(b.latitude));
      if ("longitude" in b) pay.new_site_lonstr = String(parseFloat(b.longitude));
      const r = await call(env, "PATCH", `new_sites(${sid})`, pay);
      return r.status === 200 ? { ok: true } : [{ error: "write failed", code: r.status }, 400];
    }

    if (ap.startsWith("sites/") && method === "DELETE") {
      const sid = ap.split("/").pop();
      const r = await call(env, "DELETE", `new_sites(${sid})`);
      return [200, 204].includes(r.status)
        ? { ok: true }
        : [{ error: "delete failed", code: r.status, body: String(r.body).slice(0, 200) }, 400];
    }

    if (ap.startsWith("employees/") && method === "PATCH") {
      const num = ap.split("/").pop();
      const b = body || {};
      const pay = {};
      if ("teams_email" in b) pay.new_teams_email = b.teams_email;
      if ("is_approver" in b) pay.new_employees_isapprover = b.is_approver ? APPR_YES : APPR_NO;
      const r = await call(env, "GET", `new_employeeses?$select=new_employeesid&$filter=new_employeenumber eq '${num}'`);
      if (!(r.status === 200 && isObj(r.body) && (r.body.value || []).length)) return [{ error: "employee not found" }, 404];
      const r2 = await call(env, "PATCH", `new_employeeses(${r.body.value[0].new_employeesid})`, pay);
      return r2.status === 200
        ? { ok: true }
        : [{ error: "write failed", code: r2.status, body: String(r2.body).slice(0, 200) }, 400];
    }

    if (ap === "settings" && method === "POST") {
      const b = body || {};
      const name = b.name;
      if (!name) return [{ error: "name required" }, 400];
      const r = await call(env, "GET", `new_settingses?$filter=new_name eq '${name}'`);
      const pay = {
        new_value_str: String(b.value_str ?? "").slice(0, 200),
        new_desc: (b.desc || "").slice(0, 300),
      };
      if (b.value !== null && b.value !== undefined) pay.new_value = String(parseInt(b.value, 10));
      if (r.status === 200 && isObj(r.body) && (r.body.value || []).length) {
        const r2 = await call(env, "PATCH", `new_settingses(${r.body.value[0].new_settingsid})`, pay);
        return r2.status === 200 ? { ok: true } : [{ error: "write failed", code: r2.status }, 400];
      }
      pay.new_name = name;
      const r2 = await call(env, "POST", "new_settingses", pay);
      return [200, 201, 204].includes(r2.status)
        ? { ok: true }
        : [{ error: "write failed", code: r2.status, body: String(r2.body).slice(0, 200) }, 400];
    }

    if (ap === "signins/delete" && method === "POST") {
      const b = body || {};
      const id = String(b.id || "").trim();
      if (!id) return [{ error: "id required" }, 400];
      const r = await call(env, "DELETE", `new_signins(${id})`);
      return [200, 204].includes(r.status)
        ? { ok: true }
        : [{ error: "delete failed", code: r.status, body: String(r.body).slice(0, 200) }, 400];
    }

    if (ap === "signins/update" && method === "POST") {
      const b = body || {};
      const id = String(b.id || "").trim();
      if (!id) return [{ error: "id required" }, 400];
      const pay = {};
      if ("direction" in b) pay.new_signin_direction = b.direction === "in" ? DIR_IN : DIR_OUT;
      if ("allowed" in b) pay.new_signin_allowed = b.allowed ? ALLOWED_YES : 100000002;
      if ("site" in b) pay.new_signin_site = String(b.site).slice(0, 100);
      if ("note" in b) pay.new_signin_note = String(b.note).slice(0, 300);
      if ("datetime" in b && b.datetime) pay.new_signin_datetime = String(b.datetime);
      if (!Object.keys(pay).length) return [{ error: "no fields to update" }, 400];
      const r = await call(env, "PATCH", `new_signins(${id})`, pay);
      return r.status === 200
        ? { ok: true }
        : [{ error: "update failed", code: r.status, body: String(r.body).slice(0, 200) }, 400];
    }

    return [{ error: "unknown admin endpoint" }, 404];
  }

  return [{ error: "not found: " + path }, 404];
}

// ---------- request plumbing ----------
function corsHeaders(env, req) {
  const origin = req.headers.get("origin") || "";
  const allow = [env.ALLOWED_ORIGIN || "https://the0caesar.github.io"];
  const ok = allow.some((a) => origin === a || origin.startsWith(a + ":")) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (origin || allow[0]) : allow[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dev-Email",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, code, extra) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: Object.assign({ "Content-Type": "application/json" }, extra || {}),
  });
}

async function identityFor(req, env) {
  if (env.DEV_EMPLOYEE_NUMBER) {
    const email = req.headers.get("x-dev-email") || env.DEV_DEV_EMAIL || null;
    return { ident: await identityByNumber(env, String(env.DEV_EMPLOYEE_NUMBER), email, true), hadToken: false };
  }
  const email = jwtEmail(req);
  if (!email) return { ident: null, hadToken: false };
  // Primary: the sign-in UPN embeds the employee number (70180@SEC.se.com.sa -> 70180).
  // Every team member's sign-in ID starts with their number, so number-match is the
  // canonical resolution; exact email match is kept as a silent last resort.
  const local = String(email).split("@")[0].trim();
  if (/^\d+$/.test(local)) {
    const byNum = await identityByNumber(env, local, email, false);
    if (byNum.name) return { ident: byNum, hadToken: true, email };
  }
  return { ident: await identityByEmail(env, email), hadToken: true, email };
}

// ---------- PKCE token relay (server-side code redemption) ----------
// Browsers are now refused by AAD for redeeming PKCE codes against Web-registered
// apps (AADSTS9002326 "cross-origin token redemption ... SPA client-type"). A
// server-side redemption (no Origin header) is the classic allowed path, so we
// relay the one-time code + PKCE verifier here and return the AAD-issued id_token.
// Security: open endpoint by design — a caller needs a FRESH single-use AAD code
// (10 min TTL) AND its matching PKCE verifier, which only the browser that
// completed a real Microsoft sign-in holds. The id_token is AAD-issued for the
// user who authenticated (v1: decode-only identity, same as the rest of the API).
async function oauthToken(req, env, cors) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
  let body; try { body = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400, cors); }
  const code = body.code, verifier = body.verifier;
  if (!code || !verifier) return json({ error: "code and verifier required" }, 400, cors);
  const clientId = env.AUTH_CLIENT_ID;
  if (!clientId) return json({ error: "AUTH_CLIENT_ID not configured" }, 500, cors);
  const redirectUri = body.redirect_uri || env.AUTH_REDIRECT_URI || "https://the0caesar.github.io/makkah-attendance/";
  const d = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  try {
    const r = await fetch(`https://login.microsoftonline.com/${env.DV_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const j = await r.json();
    if (j.id_token) return json({ id_token: j.id_token, token_type: j.token_type, expires_in: j.expires_in }, 200, cors);
    return json({ error: j.error || "token exchange failed", description: j.error_description || "" }, 400, cors);
  } catch (e) {
    return json({ error: "token exchange error: " + (e && e.message || String(e)) }, 500, cors);
  }
}

// ---------- reminders (cron -> channel webhook @mention; SPEC §5.7 v1) ----------
// 1:1 Flow-bot delivery = v2 (needs a flow/bot the tenant must allow).
// Times are AST (UTC+3). Cron runs every 5 min (UTC); due-check uses minute math.
// Settings: shift_start, shift_end (HH:MM AST), reminder_lead_minutes (30),
//           reminder_interval_minutes (10), reminder_stop_after_minutes (60).
const AST_OFFSET_MIN = 180; // UTC+3

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Pure plan function (unit-testable, no I/O).
 * nowUTC: Date. settings: {shift_start, shift_end, reminder_lead_minutes, ...}.
 * roster: [{employee, name, email, is_approver}].
 * signinsToday: [{employee, direction}] — direction 'in'|'out', latest per emp = current state.
 * absentEmps: Set of employee numbers with an approved absence-type request today.
 * Returns [{employee, name, email, kind: 'in'|'out'}].
 */
export function reminderPlan(nowUTC, settings, roster, signinsToday, absentEmps) {
  const startMin = hhmmToMin(settings.shift_start);
  const endMin = hhmmToMin(settings.shift_end);
  const lead = parseInt(settings.reminder_lead_minutes ?? 30, 10);
  const interval = parseInt(settings.reminder_interval_minutes ?? 10, 10);
  const stopAfter = parseInt(settings.reminder_stop_after_minutes ?? 60, 10);
  if (startMin == null || endMin == null) return [];

  const ast = new Date(nowUTC.getTime() + AST_OFFSET_MIN * 60000);
  const nowMin = ast.getUTCHours() * 60 + ast.getUTCMinutes();

  const state = {}; // emp -> 'in' | 'out'
  // signinsToday is newest-first; iterate oldest->newest so the LATEST wins
  for (let i = signinsToday.length - 1; i >= 0; i--) state[signinsToday[i].employee] = signinsToday[i].direction;
  const abs = absentEmps || new Set();

  const due = (phaseMin) =>
    nowMin >= phaseMin && nowMin <= phaseMin + stopAfter &&
    (nowMin - phaseMin) % interval === 0;

  const out = [];
  for (const p of roster) {
    if (abs.has(p.employee)) continue;
    const winIn = startMin - lead;   // first sign-in reminder
    const winOut = endMin - lead;    // first sign-out reminder
    if (state[p.employee] !== "out" && due(winIn) && state[p.employee] !== "in") {
      out.push({ employee: p.employee, name: p.name, email: p.email, kind: "in" });
    }
    if (state[p.employee] === "in" && due(winOut)) {
      out.push({ employee: p.employee, name: p.name, email: p.email, kind: "out" });
    }
  }
  return out;
}

async function scheduled(event, env) {
  if (!env.REMINDER_WEBHOOK_URL) { console.log("reminders: no webhook configured, skip"); return; }
  const dv = { DV_ORG_URL: env.DV_ORG_URL, DV_TENANT_ID: env.DV_TENANT_ID, DV_CLIENT_ID: env.DV_CLIENT_ID, DV_CLIENT_SECRET: env.DV_CLIENT_SECRET };
  const [sr, rr, qr, ar] = await Promise.all([
    call(dv, "GET", "new_settingses"),
    call(dv, "GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail"),
    call(dv, "GET", "new_signins?$select=new_signin_employeenumber,new_signin_datetime,new_signin_direction&$orderby=new_signin_datetime desc&$top=500"),
    call(dv, "GET", "new_requestses?$select=new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date"),
  ]);
  const settings = {};
  for (const row of (sr.status === 200 && isObj(sr.body)) ? (sr.body.value || []) : []) {
    settings[row.new_name] = row.new_value_str || row.new_value;
  }
  const roster = ((rr.status === 200 && isObj(rr.body)) ? (rr.body.value || []) : [])
    .map((x) => ({ employee: x.new_employeenumber, name: x.new_fullname, email: x.new_primaryemail }));
  const todayAST = new Date(Date.now() + AST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
  const signinsToday = ((qr.status === 200 && isObj(qr.body)) ? (qr.body.value || []) : [])
    .filter((x) => (x.new_signin_datetime || "").slice(0, 10) === todayAST)
    .map((x) => ({ employee: x.new_signin_employeenumber, direction: x.new_signin_direction === DIR_IN ? "in" : "out" }));
  const absentTypes = absenceTypes(settings);
  const reqRows = ((ar.status === 200 && isObj(ar.body)) ? (ar.body.value || []) : []);
  const absentEmps = new Set(reqRows.filter((x) =>
    x.new_requests_status === ST_APPROVED &&
    absentTypes.includes(x.new_requests_type) &&
    d10(x.new_requests_date) <= todayAST &&
    (d10(x.new_requests_date2) || d10(x.new_requests_date)) >= todayAST
  ).map((x) => String(x.new_requests_employeenumber)));

  const plan = reminderPlan(new Date(), settings, roster, signinsToday, absentEmps);
  if (!plan.length) { console.log("reminders: nothing due"); return; }
  await Promise.all(plan.map(async (p) => {
    const msg = p.kind === "in"
      ? `@${p.email} sign-in reminder: you have not signed in yet (shift start ${settings.shift_start || "?"}, AST).`
      : `@${p.email} sign-out reminder: you are still signed in (shift end ${settings.shift_end || "?"}, AST).`;
    const r = await fetch(env.REMINDER_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg }),
    });
    console.log(`reminder ${p.kind} -> ${p.employee}: ${r.status}`);
  }));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, at: nowZ() }, 200, cors);
    // /app/* — serves the web app from GitHub Pages with FRESHNESS headers, so the
    // Teams tab always gets the latest build WITHOUT a new app install. HTML: no-cache
    // (always revalidate); assets: short cache (the index.html cache-bust ?v= on
    // app.js handles the rest). Content origin = the live Pages site.
    if (url.pathname === "/app") {
      // contentUrl has no trailing slash — redirect so relative asset refs
      // (style.css, app.js, …) resolve under /app/ instead of /.
      return new Response(null, { status: 301, headers: { Location: "/app/", ...cors } });
    }
    if (url.pathname.startsWith("/app/")) {
      const name = url.pathname.slice(5);
      const ALLOWED = { "": true, "index.html": true, "app.js": true, "style.css": true, "teams.js": true, "msal-browser.min.js": true, "geo.html": true };
      if (!ALLOWED[name]) return json({ error: "not found" }, 404, cors);
      const f = await fetch(`https://the0caesar.github.io/makkah-attendance/${name}`, { cf: { cacheTtl: 0 } });
      const h = new Headers(f.headers);
      h.set("Cache-Control", name === "" || name === "index.html" || name === "geo.html"
        ? "no-cache, must-revalidate"
        : "public, max-age=600");
      return new Response(f.body, { status: f.status, headers: h });
    }
    if (url.pathname === "/api/reminders/plan" && env.DEV_EMPLOYEE_NUMBER) {
      // dev dry-run: compute the plan with `?now=2026-10-08T04:05:00Z` (UTC), never sends
      const [sr, rr, qr, ar] = await Promise.all([
        call(env, "GET", "new_settingses"),
        call(env, "GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail"),
        call(env, "GET", "new_signins?$select=new_signin_employeenumber,new_signin_datetime,new_signin_direction&$orderby=new_signin_datetime desc&$top=500"),
        call(env, "GET", "new_requestses?$select=new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date"),
      ]);
      const settings = {};
      for (const row of (sr.status === 200 && isObj(sr.body)) ? (sr.body.value || []) : []) settings[row.new_name] = row.new_value_str || row.new_value;
      const roster = ((rr.status === 200 && isObj(rr.body)) ? (rr.body.value || []) : []).map((x) => ({ employee: x.new_employeenumber, name: x.new_fullname, email: x.new_primaryemail }));
      const todayAST = new Date(Date.now() + AST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
      const signinsToday = ((qr.status === 200 && isObj(qr.body)) ? (qr.body.value || []) : []).filter((x) => (x.new_signin_datetime || "").slice(0, 10) === todayAST).map((x) => ({ employee: x.new_signin_employeenumber, direction: x.new_signin_direction === DIR_IN ? "in" : "out" }));
      const absentEmps = new Set(((ar.status === 200 && isObj(ar.body)) ? (ar.body.value || []) : []).filter((x) => x.new_requests_status === ST_APPROVED && absenceTypes(settings).includes(x.new_requests_type) && d10(x.new_requests_date) <= todayAST && (d10(x.new_requests_date2) || d10(x.new_requests_date)) >= todayAST).map((x) => String(x.new_requests_employeenumber)));
      const now = url.searchParams.get("now") ? new Date(url.searchParams.get("now")) : new Date();
      return json({ now: now.toISOString(), due: reminderPlan(now, settings, roster, signinsToday, absentEmps) }, 200, cors);
    }
    // PKCE relay: runs BEFORE identity resolution (it IS the sign-in step).
    if (url.pathname === "/api/oauth/token") return oauthToken(req, env, cors);
    if (!url.pathname.startsWith("/api/")) return json({ error: "not found: " + url.pathname }, 404, cors);

    const q = {};
    url.searchParams.forEach((v, k) => { (q[k] = q[k] || []).push(v); });

    let body = null;
    if (req.method === "POST" || req.method === "PATCH") {
      const t = await req.text();
      if (t) { try { body = JSON.parse(t); } catch { body = {}; } }
    }

    const { ident: m, hadToken, email } = await identityFor(req, env);
    if (!m) {
      // signed in but email not on the roster -> 403 with the email (app shows link screen);
      // no token at all -> 401 (app shows login screen)
      if (hadToken) return json({ error: "email not linked to roster", email }, 403, cors);
      return json({ error: "unauthorized: sign in with your work account" }, 401, cors);
    }

    const res = await handleApi(env, req.method, url.pathname, q, body, m);
    // (payload, code) tuple convention: exactly 2 elements, element 1 a number.
    // Legit payload arrays (roster/signins/oncall/training/requests) hold objects only.
    const isTuple = Array.isArray(res) && res.length === 2 && typeof res[1] === "number";
    if (isTuple) return json(res[0], res[1], cors);
    return json(res, 200, cors);
  },
};
