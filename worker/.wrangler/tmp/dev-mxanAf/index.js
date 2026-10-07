var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var SAFE = /^[A-Za-z0-9_.\-~\/\?\&=\$\(\),']$/;
function qpath(s) {
  let out = "";
  for (const c of s) out += SAFE.test(c) ? c : encodeURIComponent(c);
  return out;
}
__name(qpath, "qpath");
var SAFE2 = /^[A-Za-z0-9_.\-~']$/;
function qstrict(s) {
  let out = "";
  for (const c of s) out += SAFE2.test(c) ? c : encodeURIComponent(c);
  return out;
}
__name(qstrict, "qstrict");
var TOK = null;
var TOK_AT = 0;
async function dvToken(env) {
  const d = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.DV_CLIENT_ID,
    client_secret: env.DV_CLIENT_SECRET,
    scope: env.DV_ORG_URL + "/.default"
  });
  const r = await fetch(
    `https://login.microsoftonline.com/${env.DV_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body: d, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const j = await r.json();
  if (!j.access_token) throw new Error("token endpoint failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
__name(dvToken, "dvToken");
function isObj(x) {
  return x !== null && typeof x === "object";
}
__name(isObj, "isObj");
async function callH(env, method, path, body, extra) {
  if (Date.now() / 1e3 - TOK_AT > 5e3) {
    TOK = await dvToken(env);
    TOK_AT = Date.now() / 1e3;
  }
  const url = env.DV_ORG_URL + "/api/data/v9.2/" + qpath(path);
  const h = {
    Authorization: "Bearer " + TOK,
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0"
  };
  const init = { method, headers: h };
  if (body !== null && body !== void 0) {
    h["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  if (extra) Object.assign(h, extra);
  const resp = await fetch(url, init);
  const t = await resp.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = null;
  }
  const hdrs = {};
  resp.headers.forEach((v, k) => {
    hdrs[k] = v;
  });
  const status = resp.ok ? 200 : resp.status;
  return { status, body: j !== null ? j : t || void 0, headers: hdrs };
}
__name(callH, "callH");
function call(env, method, path, body) {
  return callH(env, method, path, body);
}
__name(call, "call");
var DIR_IN = 100000001;
var DIR_OUT = 100000002;
var ALLOWED_YES = 100000001;
var ST_REQUESTED = 100000001;
var ST_APPROVED = 100000002;
var ST_REJECTED = 100000003;
var ST_CANCELLED = 100000004;
var EXC_YES = 100000002;
var APPR_YES = 100000002;
var APPR_NO = 100000001;
var SRC_REQUEST = 100000002;
var SRC_ROTATION = 100000001;
var SITE_ON = 100000001;
var SITE_OFF = 100000002;
var nowZ = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"), "nowZ");
var nameStamp = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " "), "nameStamp");
var d10 = /* @__PURE__ */ __name((v) => (v || "").slice(0, 10), "d10");
async function identityByEmail(env, email) {
  email = (email || "").trim().toLowerCase();
  if (!email) return null;
  const r = await call(env, "GET", "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover");
  if (r.status !== 200 || !isObj(r.body)) return null;
  for (const row of r.body.value || []) {
    if (String(row.new_primaryemail || "").toLowerCase() === email) {
      return {
        employee_number: String(row.new_employeenumber),
        email,
        name: row.new_fullname,
        is_approver: row.new_employees_isapprover === APPR_YES,
        linked: true,
        dev: false
      };
    }
  }
  return null;
}
__name(identityByEmail, "identityByEmail");
async function identityByNumber(env, num, email, dev) {
  const r = await call(
    env,
    "GET",
    `new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_employees_isapprover&$filter=new_employeenumber eq '${num}'`
  );
  const row = r.status === 200 && isObj(r.body) && (r.body.value || [])[0] || null;
  return {
    employee_number: num,
    email: email || row && row.new_primaryemail || null,
    name: row ? row.new_fullname : null,
    is_approver: !!(row && row.new_employees_isapprover === APPR_YES),
    linked: true,
    dev: !!dev
  };
}
__name(identityByNumber, "identityByNumber");
function jwtEmail(req) {
  const a = req.headers.get("authorization") || "";
  const m = a.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || payload.preferred_username || null;
  } catch {
    return null;
  }
}
__name(jwtEmail, "jwtEmail");
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
__name(haversine, "haversine");
function fnum(v) {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
}
__name(fnum, "fnum");
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
__name(getSettings, "getSettings");
async function getSites(env) {
  const r = await call(
    env,
    "GET",
    "new_sites?$select=new_siteid,new_site_name,new_site_latstr,new_site_lonstr,new_site_radiusstr,new_site_enabled,new_site_note"
  );
  const sites = [];
  if (r.status === 200 && isObj(r.body)) {
    for (const row of r.body.value || []) {
      sites.push({
        id: row.new_siteid,
        name: row.new_site_name,
        lat: fnum(row.new_site_latstr),
        lon: fnum(row.new_site_lonstr),
        radius: fnum(row.new_site_radiusstr),
        enabled: row.new_site_enabled === SITE_ON,
        note: row.new_site_note
      });
    }
  }
  return sites;
}
__name(getSites, "getSites");
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
__name(geoCheck, "geoCheck");
function reqRow(row) {
  return {
    id: row.new_requestsid,
    name: row.new_requests_name,
    employee: row.new_requests_employeenumber,
    type: row.new_requests_type,
    date: d10(row.new_requests_date),
    date2: d10(row.new_requests_date2),
    otheremp: row.new_requests_otheremp,
    status: row.new_requests_status,
    reason: row.new_requests_reason,
    approver: row.new_requests_approver,
    requestedat: row.new_requests_requestedat,
    decidedat: row.new_requests_decidedat,
    proofurl: row.new_requests_proofurl,
    exceeds: row.new_requests_exceeds,
    absentnote: row.new_requests_absentnote
  };
}
__name(reqRow, "reqRow");
function absenceTypes(settings) {
  return String(settings.absence_types || "").split(",").map((t) => t.trim()).filter(Boolean);
}
__name(absenceTypes, "absenceTypes");
function dailyLimit(settings) {
  const n = parseInt(settings.daily_limit ?? 2, 10);
  return Number.isFinite(n) ? n : 2;
}
__name(dailyLimit, "dailyLimit");
async function limitCheck(env, emp, dateIso, settings, excludeId) {
  const at = absenceTypes(settings);
  const r = await call(
    env,
    "GET",
    `new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date&$filter=new_requests_status eq ${ST_APPROVED}`
  );
  const rows = r.status === 200 && isObj(r.body) ? r.body.value || [] : [];
  const approved = rows.filter((x) => at.includes(x.new_requests_type) && d10(x.new_requests_date) === dateIso && x.new_requestsid !== excludeId);
  const sameEmp = approved.filter((x) => x.new_requests_employeenumber === String(emp));
  const others = approved.filter((x) => x.new_requests_employeenumber !== String(emp));
  const note = approved.map((x) => `${x.new_requests_employeenumber} (${x.new_requests_type})`).join("; ");
  return [
    sameEmp.length + 1 > dailyLimit(settings),
    `Absences on ${dateIso}: ${note || "none"} (limit ${dailyLimit(settings)})`
  ];
}
__name(limitCheck, "limitCheck");
async function handleApi(env, method, path, q, body, m) {
  const p = path.replace(/\/+$/, "");
  const g = /* @__PURE__ */ __name((k, dflt) => q[k] ? q[k][0] : dflt, "g");
  if (p === "/api/whoami") return m;
  if (p === "/api/roster") {
    const r = await call(
      env,
      "GET",
      "new_employeeses?$select=new_employeenumber,new_fullname,new_primaryemail,new_site_default,new_employees_isapprover&$orderby=new_fullname"
    );
    if (r.status !== 200) return { error: "roster", code: r.status };
    return (r.body.value || []).map((x) => ({
      employee: x.new_employeenumber,
      name: x.new_fullname,
      email: x.new_primaryemail,
      site: x.new_site_default,
      is_approver: x.new_employees_isapprover === APPR_YES
    }));
  }
  if (p === "/api/settings") return getSettings(env);
  if (p === "/api/sites") return getSites(env);
  if (p === "/api/signins") {
    const days = parseInt(g("days", "7"), 10) || 7;
    const r = await call(
      env,
      "GET",
      "new_signins?$select=new_signin_name,new_signin_employeenumber,new_signin_datetime,new_signin_direction,new_signin_allowed,new_signin_site,new_signin_accstr&$orderby=new_signin_datetime desc&$top=500"
    );
    const out = [];
    if (r.status === 200 && isObj(r.body)) {
      for (const x of r.body.value || []) {
        out.push({
          employee: x.new_signin_employeenumber,
          at: x.new_signin_datetime,
          direction: x.new_signin_direction === DIR_IN ? "in" : "out",
          allowed: x.new_signin_allowed === ALLOWED_YES,
          site: x.new_signin_site,
          accuracy: fnum(x.new_signin_accstr)
        });
      }
    }
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    return out.filter((o) => (o.at || "") >= cutoff);
  }
  if (p === "/api/oncall") {
    const f = g("from", "2000-01-01"), t = g("to", "2999-12-31");
    const r = await call(
      env,
      "GET",
      `new_oncalls?$select=new_oncall_name,new_oncall_employeenumber,new_oncall_date,new_oncall_source,new_oncall_assignedby&$filter=(new_oncall_date ge ${f}T00:00:00Z) and (new_oncall_date le ${t}T23:59:59Z)`
    );
    if (r.status !== 200) return [];
    return (r.body.value || []).map((x) => ({
      employee: x.new_oncall_employeenumber,
      date: d10(x.new_oncall_date),
      source: x.new_oncall_source,
      assignedby: x.new_oncall_assignedby
    }));
  }
  if (p === "/api/training") {
    const f = g("from", "2000-01-01"), t = g("to", "2999-12-31");
    const r = await call(
      env,
      "GET",
      `new_trainings?$select=new_training_employeenumber,new_training_course,new_training_startdate,new_training_enddate,new_training_subject&$filter=(new_training_startdate ge ${f}T00:00:00Z) and (new_training_enddate le ${t}T23:59:59Z)`
    );
    if (r.status !== 200) return [];
    return (r.body.value || []).map((x) => ({
      employee: x.new_training_employeenumber,
      course: x.new_training_course,
      start: d10(x.new_training_startdate),
      end: d10(x.new_training_enddate),
      subject: x.new_training_subject
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
    const r = await call(
      env,
      "GET",
      `new_requestses?$select=new_requestsid,new_requests_name,new_requests_employeenumber,new_requests_type,new_requests_date,new_requests_date2,new_requests_otheremp,new_requests_status,new_requests_reason,new_requests_approver,new_requests_requestedat,new_requests_decidedat,new_requests_proofurl,new_requests_exceeds,new_requests_absentnote&$filter=(${filt}) and (new_requests_date le ${t}T23:59:59Z) and (new_requests_date2 eq null or new_requests_date2 le ${t}T23:59:59Z)`
    );
    let rows = r.status === 200 && isObj(r.body) ? (r.body.value || []).map(reqRow) : [];
    rows = rows.filter((x) => x.date >= f);
    rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    return rows;
  }
  if (p === "/api/signin" && method === "POST") {
    const b = body || {};
    const direction = b.direction === "in" ? DIR_IN : DIR_OUT;
    const lat = b.latitude, lon = b.longitude;
    const settings = await getSettings(env);
    const enforceOut = String(settings.enforce_signout_location ?? "1") === "1";
    const noLoc = lat === null || lat === void 0 || lon === null || lon === void 0;
    if (direction === DIR_IN && noLoc) return [{ error: "location required \u2014 cannot sign in without GPS" }, 400];
    if (direction !== DIR_IN && noLoc && enforceOut) return [{ error: "location required \u2014 cannot sign out without GPS (enforced)" }, 400];
    let allowed, site, dist;
    if (noLoc) {
      allowed = true;
      site = "No check (enforced off)";
      dist = null;
    } else {
      [allowed, site, dist] = await geoCheck(env, parseFloat(lat), parseFloat(lon));
      if (!allowed) return [
        {
          error: `blocked: outside allowed locations (nearest: ${site}, ${dist ? Math.floor(dist) : "?"} m)`,
          allowed: false,
          site,
          distance_m: dist
        },
        400
      ];
    }
    const now = /* @__PURE__ */ new Date();
    const name = `${m.employee_number} \u2022 ${nameStamp()} \u2022 ${direction === DIR_IN ? "IN" : "OUT"}`.slice(0, 120);
    const pay = {
      new_signin_name: name,
      new_signin_employeenumber: m.employee_number,
      new_signin_datetime: nowZ(),
      new_signin_direction: direction,
      new_signin_allowed: allowed ? ALLOWED_YES : 100000002,
      new_signin_site: site
    };
    if (lat !== null && lat !== void 0) {
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
      new_requests_name: `${m.employee_number} \u2022 ${rtype} \u2022 ${date}`.slice(0, 150),
      new_requests_employeenumber: m.employee_number,
      new_requests_type: rtype,
      new_requests_date: date + "T00:00:00Z",
      new_requests_reason: (b.reason || "").slice(0, 300),
      new_requests_requestedat: nowZ(),
      new_requests_status: ST_REQUESTED
    };
    if (b.date2) pay.new_requests_date2 = String(b.date2).slice(0, 10) + "T00:00:00Z";
    if (b.otheremp) pay.new_requests_otheremp = String(b.otheremp).slice(0, 20);
    if (b.proofurl) pay.new_requests_proofurl = String(b.proofurl).slice(0, 500);
    if (rtype === "Training") {
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
      let rid = isObj(r.body) ? r.body.new_requestsid || "" : "";
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
    const r = await call(
      env,
      "GET",
      `new_requestses?$select=new_requestsid,new_requests_employeenumber,new_requests_type,new_requests_status,new_requests_date,new_requests_otheremp,new_requests_name&$filter=new_requestsid eq '${rid}'`
    );
    if (r.status !== 200 || !(isObj(r.body) && (r.body.value || []).length)) return [{ error: "not found" }, 404];
    const row = r.body.value[0];
    const isOwner = row.new_requests_employeenumber === m.employee_number;
    const action = method === "PATCH" ? (body || {}).action || null : "cancel";
    if (action === "cancel") {
      if (!isOwner && !m.is_approver) return [{ error: "forbidden" }, 403];
      const r2 = await call(env, "PATCH", `new_requestses(${rid})`, {
        new_requests_status: ST_CANCELLED,
        new_requests_decidedat: nowZ(),
        new_requests_approver: m.email
      });
      const wasApproved = row.new_requests_status === ST_APPROVED;
      return r2.status === 200 ? { ok: true, notify_supervisors: wasApproved } : [{ error: "write failed", code: r2.status }, 400];
    }
    if (action === "approve" || action === "reject") {
      if (!m.is_approver) return [{ error: "forbidden: approver only" }, 403];
      const r2 = await call(env, "PATCH", `new_requestses(${rid})`, {
        new_requests_status: action === "approve" ? ST_APPROVED : ST_REJECTED,
        new_requests_approver: m.email,
        new_requests_decidedat: nowZ()
      });
      if (r2.status !== 200) return [{ error: "write failed", code: r2.status }, 400];
      if (action === "approve" && row.new_requests_type === "On-Call") {
        const d = d10(row.new_requests_date);
        const emp = row.new_requests_employeenumber;
        if (row.new_requests_otheremp) {
          const r3 = await call(env, "GET", "new_oncalls?$select=new_oncall_name&$filter=" + qstrict(
            `(new_oncall_employeenumber eq '${row.new_requests_otheremp}') and (new_oncall_date eq datetime'${d}T00:00:00Z')`
          ));
          if (r3.status === 200 && isObj(r3.body)) {
            for (const o of r3.body.value || []) await call(env, "DELETE", `new_oncalls('${o.new_oncall_name}')`);
          }
        }
        const r4 = await call(env, "POST", "new_oncalls", {
          new_oncall_name: `OC \u2022 ${emp} \u2022 ${d}`.slice(0, 120),
          new_oncall_employeenumber: emp,
          new_oncall_date: d + "T00:00:00Z",
          new_oncall_source: SRC_REQUEST,
          new_oncall_assignedby: m.email
        });
        if (![200, 201, 204].includes(r4.status)) return { ok: true, oncall_write_failed: r4.status };
      }
      return { ok: true };
    }
    return [{ error: "unknown action" }, 400];
  }
  if (p.startsWith("/api/admin/")) {
    if (!m.is_approver) return [{ error: "forbidden: approver only" }, 403];
    const ap = p.slice("/api/admin/".length);
    if (ap === "oncall" && method === "POST") {
      const b = body || {};
      const emp = String(b.employeenumber || "").trim();
      const dates = b.dates || [];
      if (!emp || !dates.length) return [{ error: "employeenumber + dates required" }, 400];
      let written = 0;
      for (let d of dates) {
        d = String(d).slice(0, 10);
        const r = await call(
          env,
          "GET",
          `new_oncalls?$select=new_oncall_name&$filter=(new_oncall_employeenumber eq '${emp}') and (new_oncall_date eq datetime'${d}T00:00:00Z')`
        );
        if (r.status === 200 && isObj(r.body)) {
          for (const o of r.body.value || []) await call(env, "DELETE", `new_oncalls('${o.new_oncall_name}')`);
        }
        const r2 = await call(env, "POST", "new_oncalls", {
          new_oncall_name: `OC \u2022 ${emp} \u2022 ${d}`.slice(0, 120),
          new_oncall_employeenumber: emp,
          new_oncall_date: d + "T00:00:00Z",
          new_oncall_source: SRC_ROTATION,
          new_oncall_assignedby: m.email
        });
        if ([200, 201, 204].includes(r2.status)) written += 1;
      }
      return { ok: true, written };
    }
    if (ap === "oncall" && method === "DELETE") {
      const emp = g("emp", ""), d = g("date", "").slice(0, 10);
      const r = await call(
        env,
        "GET",
        `new_oncalls?$select=new_oncall_name&$filter=(new_oncall_employeenumber eq '${emp}') and (new_oncall_date eq datetime'${d}T00:00:00Z')`
      );
      let n = 0;
      if (r.status === 200 && isObj(r.body)) {
        for (const o of r.body.value || []) {
          const r2 = await call(env, "DELETE", `new_oncalls('${o.new_oncall_name}')`);
          if (r2.status === 200) n += 1;
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
        new_site_note: (b.note || "").slice(0, 300)
      });
      let sid = isObj(r.body) ? r.body.new_siteid || "" : "";
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
      if ("enabled" in b) pay.new_site_enabled = b.enabled ? SITE_ON : SITE_OFF;
      if ("radius" in b) pay.new_site_radiusstr = String(parseFloat(b.radius));
      if ("latitude" in b) pay.new_site_latstr = String(parseFloat(b.latitude));
      if ("longitude" in b) pay.new_site_lonstr = String(parseFloat(b.longitude));
      const r = await call(env, "PATCH", `new_sites(${sid})`, pay);
      return r.status === 200 ? { ok: true } : [{ error: "write failed", code: r.status }, 400];
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
      return r2.status === 200 ? { ok: true } : [{ error: "write failed", code: r2.status, body: String(r2.body).slice(0, 200) }, 400];
    }
    if (ap === "settings" && method === "POST") {
      const b = body || {};
      const name = b.name;
      if (!name) return [{ error: "name required" }, 400];
      const r = await call(env, "GET", `new_settingses?$filter=new_name eq '${name}'`);
      const pay = {
        new_value_str: String(b.value_str ?? "").slice(0, 200),
        new_desc: (b.desc || "").slice(0, 300)
      };
      if (b.value !== null && b.value !== void 0) pay.new_value = String(parseInt(b.value, 10));
      if (r.status === 200 && isObj(r.body) && (r.body.value || []).length) {
        const r22 = await call(env, "PATCH", `new_settingses(${r.body.value[0].new_settingsid})`, pay);
        return r22.status === 200 ? { ok: true } : [{ error: "write failed", code: r22.status }, 400];
      }
      pay.new_name = name;
      const r2 = await call(env, "POST", "new_settingses", pay);
      return [200, 201, 204].includes(r2.status) ? { ok: true } : [{ error: "write failed", code: r2.status, body: String(r2.body).slice(0, 200) }, 400];
    }
    return [{ error: "unknown admin endpoint" }, 404];
  }
  return [{ error: "not found: " + path }, 404];
}
__name(handleApi, "handleApi");
function corsHeaders(env, req) {
  const origin = req.headers.get("origin") || "";
  const allow = [env.ALLOWED_ORIGIN || "https://the0caesar.github.io"];
  const ok = allow.some((a) => origin === a || origin.startsWith(a + ":")) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || allow[0] : allow[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dev-Email",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function json(obj, code, extra) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: Object.assign({ "Content-Type": "application/json" }, extra || {})
  });
}
__name(json, "json");
async function identityFor(req, env) {
  if (env.DEV_EMPLOYEE_NUMBER) {
    const email2 = req.headers.get("x-dev-email") || env.DEV_DEV_EMAIL || null;
    return identityByNumber(env, String(env.DEV_EMPLOYEE_NUMBER), email2, true);
  }
  const email = jwtEmail(req);
  if (!email) return null;
  return identityByEmail(env, email);
}
__name(identityFor, "identityFor");
var index_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, at: nowZ() }, 200, cors);
    if (!url.pathname.startsWith("/api/")) return json({ error: "not found: " + url.pathname }, 404, cors);
    const q = {};
    url.searchParams.forEach((v, k) => {
      (q[k] = q[k] || []).push(v);
    });
    let body = null;
    if (req.method === "POST" || req.method === "PATCH") {
      const t = await req.text();
      if (t) {
        try {
          body = JSON.parse(t);
        } catch {
          body = {};
        }
      }
    }
    const m = await identityFor(req, env);
    if (!m) return json({ error: "unauthorized: sign in with your work account" }, 401, cors);
    const res = await handleApi(env, req.method, url.pathname, q, body, m);
    const isTuple = Array.isArray(res) && res.length === 2 && typeof res[1] === "number";
    if (isTuple) return json(res[0], res[1], cors);
    return json(res, 200, cors);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-eo0c7P/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-eo0c7P/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
