/* Team Pulse — Makkah Protection Team attendance app
   All API calls go to /api/* (proxy). See SPEC.md for the data model. */
"use strict";

// ---------- helpers ----------
// prod: live Cloudflare Worker (LIVE 2026-10-07, verified from CF edge).
// empty string = same-origin (local dev proxy or local `wrangler dev` with dev hatch).
const API_BASE = "https://makkah-attendance-api.makkah-attendance-api.workers.dev";
const AUTH = {
  // User-facing Entra app registration "makkah-attendance" (public client, PKCE).
  // Web redirect https://the0caesar.github.io/makkah-attendance/ registered 2026-10-07;
  // PKCE authorize probe: AAD returns the sign-in page (client + redirect + public flows OK).
  // Teams SSO: manifest webApplicationInfo.id = this client_id,
  //           resource = "api://<tenant>/<client>".
  client_id: "0cf32ba0-241d-4518-aa93-039664318a28",
  tenant: "22e3bb8f-9a96-48bd-99f8-f652d83d904c",
  scopes: ["openid", "profile", "email"],
  redirect_uri: (() => { const u = new URL(location.href); u.hash = ""; u.search = u.search; return u.href; })(),
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Asia/Riyadh"; // AST

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + kind;
  t.style.display = "block";
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.display = "none"), 4000);
}
let ID_TOKEN = null; // JWT (SSO id_token or PKCE id_token) sent to the API as Bearer
function jwtEmail(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p)).email || JSON.parse(atob(p)).preferred_username || null;
  } catch (e) { return null; }
}
async function api(path, opts = {}) {
  const h = {};
  if (opts.body) h["Content-Type"] = "application/json";
  if (ID_TOKEN) h["Authorization"] = "Bearer " + ID_TOKEN;
  const r = await fetch(API_BASE + path, {
    method: opts.method || "GET",
    headers: Object.keys(h).length ? h : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch (e) { }
  if (!r.ok || j.error) {
    const e = new Error(j.error || ("HTTP " + r.status));
    e.code = r.status; e.detail = j;
    throw e;
  }
  return j;
}
function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtClock(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}
function isoDate(d) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { // Sunday
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 7) % 7));
  return x;
}
function todayISO() { return isoDate(new Date()); }
function weekDays(ws) { return [...Array(7)].map((_, i) => isoDate(addDays(ws, i))); }
const DAYN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Geolocation not supported here"));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => rej(new Error({ 1: "Location permission denied", 2: "Position unavailable (GPS off?)", 3: "Timed out" }[e.code] || "Location error")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

// ---------- identity (Teams SSO → PKCE fallback; see SPEC.md §3) ----------
function getMsal() {
  if (window.__msal) return window.__msal;
  if (!window.msal) return null;
  window.__msal = new window.msal.PublicClientApplication({
    auth: {
      clientId: AUTH.client_id,
      authority: "https://login.microsoftonline.com/" + AUTH.tenant,
      redirectUri: AUTH.redirect_uri,
    },
    cache: { cacheLocation: "localStorage" },
  });
  return window.__msal;
}
async function pkceToken() {
  const m = getMsal();
  if (!m) return null;
  await m.handleRedirectPromise();
  const accounts = m.getAllAccounts();
  if (!accounts.length) return null;
  try {
    const r = await m.acquireTokenSilent({ account: accounts[0], scopes: AUTH.scopes });
    return r.idToken || null;
  } catch (e) { console.warn("acquireTokenSilent:", e); return null; }
}
function pkceLogin() {
  const m = getMsal();
  if (!m) return toast("Login library not loaded (CDN blocked?)", "err");
  m.loginRedirect({ scopes: AUTH.scopes });
}
async function ensureAuth() {
  if (!API_BASE) return null; // dev: API dev identity, no login needed
  if (AUTH.client_id.startsWith("REPLACE_")) return ID_TOKEN; // registration not created yet
  // 1) cached PKCE account (fast path; also completes a login-redirect round trip)
  try { const t = await pkceToken(); if (t) { ID_TOKEN = t; return t; } } catch (e) { console.warn("pkce:", e); }
  // 2) Teams SSO (seamless inside a Teams tab; needs manifest webApplicationInfo)
  try {
    if (window.microsoftTeams && microsoftTeams.app && microsoftTeams.app.getContext) {
      await microsoftTeams.initialize();
      const ctx = await microsoftTeams.app.getContext();
      if (ctx && ctx.ssoInTeams) {
        const r = await microsoftTeams.authentication.getAuthToken({
          expirationInMilliseconds: 5 * 60 * 1000, idToken: true,
        });
        if (r && r.token) { ID_TOKEN = r.token; return r.token; }
      }
    }
  } catch (e) { console.warn("SSO unavailable:", e); }
  return ID_TOKEN;
}
function showAuthScreen(mode, email) {
  const el = $("#auth-screen");
  if (!el) return;
  el.style.display = "block";
  $("#auth-mode-login").style.display = mode === "login" ? "" : "none";
  $("#auth-mode-unlinked").style.display = mode === "unlinked" ? "" : "none";
  if (email) $("#unlinked-email").textContent = email;
  document.querySelector("main").style.display = "none";
  const b = document.querySelector("header nav"); if (b) b.style.display = "none";
}

// ---------- state ----------
const S = {
  me: null, roster: [], settings: {}, sites: [],
  weekStart: startOfWeek(new Date()),
  oncall: [], requests: [], signins: [], training: [],
  screen: "today", adminTab: "sites",
};
const TYPE_CLASS = {
  "On-Call": "b-oncall", "Vacation": "b-vacation", "Reset": "b-reset",
  "Training": "b-training", "Overtime": "b-overtime", "Call-Out": "b-callout",
};
function typeClass(t) { return TYPE_CLASS[t] || "b-other"; }
function visibleEmployees() {
  if (String(S.settings.rls_enabled) !== "1") return S.roster;
  return S.roster.filter(p => p.employee === S.me.employee_number || p.is_approver);
}
function person(emp) { return S.roster.find(p => p.employee === emp); }
function myLatestSignin() {
  const mine = S.signins.filter(x => x.employee === S.me.employee_number);
  return mine[0]; // newest first
}
function latestSigninToday(emp) {
  return S.signins.find(x => x.employee === emp && (x.at || "").slice(0, 10) === todayISO());
}
function requestsFor(emp, date) {
  return S.requests.filter(r =>
    r.employee === emp &&
    r.date <= date &&
    (r.date2 || r.date) >= date &&
    r.status !== 100000004); // not cancelled
}
const ST = { requested: 100000001, approved: 100000002, rejected: 100000003, cancelled: 100000004 };
const stName = v => (["", "requested", "approved", "rejected", "cancelled"][v / 100000000 - 99999999] || String(v));
const stLabel = { 100000001: "Requested", 100000002: "Approved", 100000003: "Rejected", 100000004: "Cancelled" };

// ---------- data ----------
async function loadBase() {
  const [me, roster, settings, sites] = await Promise.all([
    api("/api/whoami"), api("/api/roster"), api("/api/settings"), api("/api/sites"),
  ]);
  Object.assign(S, { me, roster, settings, sites });
  $("#who").innerHTML = `<b>${esc(me.name || me.employee_number)}</b><br>${esc(me.email || "")}${me.is_approver ? " • approver" : ""}`;
  $("#nav-approvals").style.display = me.is_approver ? "" : "none";
  $("#nav-admin").style.display = me.is_approver ? "" : "none";
  const b = $("#banner");
  if (me.dev) { b.style.display = "block"; b.textContent = `DEV MODE — identity simulated: ${me.employee_number} (${me.email})`; }
  else if (!me.linked) { b.style.display = "block"; b.textContent = "Your email is not linked to a roster person yet — an admin must link it in Admin → People."; }
  else b.style.display = "none";
}
async function refresh() {
  const from = isoDate(addDays(S.weekStart, -1));
  const to = isoDate(addDays(S.weekStart, 8));
  const [oc, reqs, sig, tr] = await Promise.all([
    api(`/api/oncall?from=${from}&to=${to}`),
    api(`/api/requests?from=${from}&to=${to}`),
    api(`/api/signins?days=2`),
    api(`/api/training?from=${from}&to=${to}`),
  ]);
  Object.assign(S, { oncall: oc, requests: reqs, signins: sig, training: tr });
  renderCurrent();
}
async function refreshAll() { await loadBase(); await refresh(); }

// ---------- screens ----------
function showScreen(name) {
  S.screen = name;
  $$("#nav button").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  $$(".screen").forEach(s => (s.style.display = "none"));
  $(`#screen-${name}`).style.display = "block";
  renderCurrent();
}
function renderCurrent() {
  if (S.screen === "today") renderToday();
  else if (S.screen === "requests") renderRequests();
  else if (S.screen === "approvals") renderApprovals();
  else if (S.screen === "admin") renderAdmin();
}

// ---------- today / grid ----------
function renderToday() {
  // sign-in card
  const last = myLatestSignin();
  const siS = $("#si-status"), siD = $("#si-detail");
  if (last && last.direction === "in" && (last.at || "").slice(0, 10) === todayISO()) {
    siS.textContent = "● Signed in"; siS.className = "si-status in";
    siD.textContent = `${fmtClock(last.at)} • ${last.site}${last.accuracy ? ` • ±${Math.round(last.accuracy)}m` : ""}`;
  } else if (last && last.direction === "out") {
    siS.textContent = "○ Signed out"; siS.className = "si-status out";
    siD.textContent = `${fmtClock(last.at)} • ${last.site}`;
  } else {
    siS.textContent = "○ Not signed in"; siS.className = "si-status out";
    siD.textContent = `Shift ${S.settings.shift_start || "07:30"}–${S.settings.shift_end || "15:30"} (AST)`;
  }
  // week label
  const a = S.weekStart, b = addDays(S.weekStart, 6);
  $("#wk-label").textContent =
    `${a.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })} – ${b.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })}`;
  // grid
  const days = weekDays(S.weekStart);
  const td = todayISO();
  let html = "<thead><tr><th>Person</th>";
  days.forEach((d, i) => {
    const cls = d === td ? "today-col" : "";
    html += `<th class="${cls}">${DAYN[i]}<br>${d.slice(5)}</th>`;
  });
  html += "</tr></thead><tbody>";
  for (const p of visibleEmployees()) {
    const me = p.employee === S.me.employee_number;
    html += `<tr class="${me ? "me" : ""}">`;
    html += `<td class="person">${esc(p.name)}${me ? " (me)" : ""}<span class="m">${esc(p.employee)}${p.is_approver ? " • approver" : ""}</span></td>`;
    days.forEach(d => {
      const isToday = d === td;
      const cell = cellHTML(p.employee, d);
      html += `<td class="${isToday ? "today-col" : ""}" data-emp="${esc(p.employee)}" data-date="${d}">${cell}</td>`;
    });
    html += "</tr>";
  }
  html += "</tbody>";
  $("#grid").innerHTML = html;
  $$("#grid td[data-emp]").forEach(tdEl => tdEl.addEventListener("click", () => openDetail(tdEl.dataset.emp, tdEl.dataset.date)));
}
function cellHTML(emp, date) {
  const out = [];
  const oc = S.oncall.find(o => o.employee === emp && o.date === date);
  if (oc) out.push(`<span class="badge solid b-oncall">ON-CALL</span>`);
  for (const r of requestsFor(emp, date)) {
    const solid = r.status === ST.approved;
    out.push(`<span class="badge ${solid ? "solid " : "outline "}${typeClass(r.type)}" style="${solid ? "" : `border-color: currentColor`}" title="${esc(r.type)} — ${stLabel[r.status] || r.status}">${esc(r.type)}</span>`);
  }
  if (date === todayISO()) {
    const ev = latestSigninToday(emp);
    if (ev && ev.direction === "in") out.push(`<span class="badge ${ev.allowed ? "b-in" : "b-in-out-loc"}">${ev.allowed ? "IN ✓ loc" : "IN ⚠ out"}</span>`);
    else if (ev && ev.direction === "out") out.push(`<span class="badge b-notin">out</span>`);
    else out.push(`<span class="badge b-notin">—</span>`);
  }
  return out.join("") || "&nbsp;";
}
function openDetail(emp, date) {
  const p = person(emp);
  const d = $("#cell-detail");
  const evs = [];
  const oc = S.oncall.find(o => o.employee === emp && o.date === date);
  if (oc) evs.push(`<div class="ev"><b>On-call</b><div class="t">${oc.assignedby ? "assigned by " + esc(String(oc.assignedby).split("@")[0]) : ""}</div></div>`);
  for (const r of requestsFor(emp, date)) {
    evs.push(`<div class="ev"><b>${esc(r.type)}</b> <span class="st ${stLabel[r.status] ? r.status / 100000000 - 99999999 : "requested"}">${stLabel[r.status] || r.status}</span>
      ${r.exceeds === 100000002 ? ' <span class="flag">exceeds limit</span>' : ""}
      ${r.reason ? `<div class="t">${esc(r.reason)}</div>` : ""}
      ${r.absentnote ? `<div class="t">${esc(r.absentnote)}</div>` : ""}
      ${r.proofurl ? `<a href="${esc(r.proofurl)}" target="_blank">proof</a>` : ""}</div>`);
  }
  for (const s of S.signins.filter(x => x.employee === emp && (x.at || "").slice(0, 10) === date)) {
    evs.push(`<div class="ev"><b>${s.direction === "in" ? "Signed in" : "Signed out"}</b> ${fmtClock(s.at)} • ${esc(s.site)} ${s.allowed ? "✓" : "⚠ outside"}<div class="t">${fmtTime(s.at)} UTC</div></div>`);
  }
  for (const t of S.training.filter(x => x.employee === emp && x.start <= date && (x.end || x.start) >= date)) {
    evs.push(`<div class="ev"><b>Training</b> — ${esc(t.course)}<div class="t">${esc(t.start)} → ${esc(t.end || t.start)}</div></div>`);
  }
  d.innerHTML = `<h3>${esc(p ? p.name : emp)}</h3><div class="m">${esc(emp)} • ${date}${p && p.is_approver ? " • approver" : ""}</div>
    ${evs.join("") || '<div class="m">No activity on this day.</div>'}
    <button class="btn" style="margin-top:14px" onclick="document.getElementById('cell-detail').style.display='none'">Close</button>`;
  d.style.display = "block";
}

// ---------- requests ----------
function renderRequests() {
  const types = String(S.settings.request_types || "Vacation,Reset,Training,On-Call").split(",").map(t => t.trim()).filter(Boolean);
  const sel = $("#rf-type");
  sel.innerHTML = types.map(t => `<option>${esc(t)}</option>`).join("");
  $("#rf-date").value = todayISO();
  const absence = String(S.settings.absence_types || "").split(",").map(t => t.trim()).filter(Boolean);
  $("#rf-hint").textContent = `Daily limit: ${S.settings.daily_limit ?? 2}. Absence types: ${absence.join(", ") || "—"}. On-Call: use “Other emp” for swaps. Training: auto-approved.`;
  const mine = S.requests.filter(r => r.employee === S.me.employee_number);
  $("#my-requests").innerHTML = mine.length ? mine.map(r => reqRowHTML(r, true)).join("") : '<div class="hint">No requests yet.</div>';
  wireReqRows();
}
function reqRowHTML(r, isMine) {
  const p = person(r.employee);
  const dates = r.date + (r.date2 && r.date2 !== r.date ? ` → ${r.date2}` : "");
  return `<div class="req-row" data-id="${esc(r.id)}">
    <div class="info">
      <b>${esc(r.type)}</b> <span class="st ${stName(r.status)}">${stLabel[r.status] || r.status}</span>
      ${r.exceeds === 100000002 ? ' <span class="flag">exceeds daily limit</span>' : ""}
      <div class="m">${dates}${r.otheremp ? ` • with ${esc(r.otheremp)}` : ""}${!isMine ? ` • ${esc(p ? p.name : r.employee)}` : ""}${r.approver ? ` • decided by ${esc(String(r.approver).split("@")[0])} ${fmtTime(r.decidedat)}` : ""}</div>
      ${r.reason ? `<div class="m">${esc(r.reason)}</div>` : ""}
      ${r.absentnote ? `<div class="m" style="color:var(--red)">${esc(r.absentnote)}</div>` : ""}
      ${r.proofurl ? `<a href="${esc(r.proofurl)}" target="_blank">proof</a>` : ""}
    </div>
    <div class="actions">
      ${isMine && (r.status === ST.requested || r.status === ST.approved)
        ? `<button class="btn danger" data-act="cancel">Cancel</button>` : ""}
      ${S.me.is_approver && r.status === ST.requested
        ? `<button class="btn ok" data-act="approve">Approve</button><button class="btn danger" data-act="reject">Reject</button>` : ""}
    </div>
  </div>`;
}
function wireReqRows() {
  $$(".req-row").forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      try {
        const r = await api(`/api/requests/${id}`, { method: "PATCH", body: { action: act } });
        toast(act === "cancel" ? (r.notify_supervisors ? "Cancelled — supervisors will be notified." : "Request cancelled.") : `Request ${act}d.`);
        if (act === "cancel" && r.notify_supervisors) {
          // prod: bot/flow delivers the notification
        }
        await refresh();
      } catch (e) { toast(e.message, "err"); }
    }));
  });
}

// ---------- approvals ----------
function renderApprovals() {
  const pending = S.requests.filter(r => r.status === ST.requested);
  $("#pending-list").innerHTML = pending.length
    ? pending.map(r => reqRowHTML(r, false)).join("")
    : '<div class="hint">Nothing pending 🎉</div>';
  const cutoff = isoDate(addDays(new Date(), -7));
  const decided = S.requests.filter(r => (r.status === ST.approved || r.status === ST.rejected) && (r.decidedat || "") >= cutoff);
  $("#decided-list").innerHTML = decided.length
    ? decided.map(r => reqRowHTML(r, false)).join("")
    : '<div class="hint">Nothing decided this week.</div>';
  wireReqRows();
}

// ---------- admin ----------
function renderAdmin() {
  $$("#admin-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.adminTab));
  $$(".admin-tab").forEach(t => (t.style.display = "none"));
  $(`#tab-${S.adminTab}`).style.display = "block";
  if (S.adminTab === "sites") renderAdminSites();
  else if (S.adminTab === "oncall") renderAdminOnCall();
  else if (S.adminTab === "people") renderAdminPeople();
  else renderAdminSettings();
}
function renderAdminSites() {
  const el = $("#tab-sites");
  el.innerHTML = `
  <form class="inline-form" id="site-form">
    <label>Name <input id="sf-name" required maxlength="100" placeholder="Main office"></label>
    <label>Latitude <input id="sf-lat" type="number" step="any" required></label>
    <label>Longitude <input id="sf-lon" type="number" step="any" required></label>
    <label>Radius (m) <input id="sf-radius" type="number" value="200" required></label>
    <button class="btn ghost" type="button" id="sf-geo">📍 My location</button>
    <button class="btn primary" type="submit">Add site</button>
  </form>
  <table><tr><th>Site</th><th>Lat</th><th>Lon</th><th>Radius</th><th>Enabled</th><th></th></tr>
  ${S.sites.map(s => `<tr>
    <td><b>${esc(s.name)}</b>${s.note ? `<div class="m" style="color:var(--muted);font-size:11px">${esc(s.note)}</div>` : ""}</td>
    <td>${s.lat}</td><td>${s.lon}</td>
    <td><input class="si-radius" data-id="${s.id}" value="${s.radius}" type="number" style="width:80px"></td>
    <td><span class="switch ${s.enabled ? "on" : ""}" data-id="${s.id}" data-on="${s.enabled}"></span></td>
    <td><a href="https://maps.google.com/?q=${s.lat},${s.lon}" target="_blank">map</a></td>
  </tr>`).join("") || '<tr><td colspan="6">No sites yet — add one above (📍 fills your current location).</td></tr>'}
  </table>`;
  $("#sf-geo").addEventListener("click", async () => {
    try {
      const g = await getLocation();
      $("#sf-lat").value = g.lat.toFixed(6); $("#sf-lon").value = g.lon.toFixed(6);
      toast(`Location captured: ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)} (±${Math.round(g.acc)}m)`);
    } catch (e) { toast(e.message, "err"); }
  });
  $("#site-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/admin/sites", { method: "POST", body: {
        name: $("#sf-name").value, latitude: $("#sf-lat").value, longitude: $("#sf-lon").value,
        radius: $("#sf-radius").value,
      } });
      toast("Site added"); await loadBase(); renderAdmin();
    } catch (err) { toast(err.message, "err"); }
  });
  el.querySelectorAll(".switch[data-id]").forEach(sw => sw.addEventListener("click", async () => {
    try {
      await api(`/api/admin/sites/${sw.dataset.id}`, { method: "PATCH", body: { enabled: sw.dataset.on !== "true" } });
      toast("Site toggled"); await loadBase(); renderAdmin();
    } catch (err) { toast(err.message, "err"); }
  }));
  el.querySelectorAll(".si-radius").forEach(inp => inp.addEventListener("change", async () => {
    try {
      await api(`/api/admin/sites/${inp.dataset.id}`, { method: "PATCH", body: { radius: inp.value } });
      toast("Radius updated"); await loadBase(); renderAdmin();
    } catch (err) { toast(err.message, "err"); }
  }));
}
function renderAdminOnCall() {
  const el = $("#tab-oncall");
  const days = weekDays(S.weekStart);
  const opts = S.roster.map(p => `<option value="${esc(p.employee)}">${esc(p.name)} (${esc(p.employee)})</option>`).join("");
  el.innerHTML = `
  <div class="inline-form">
    <label>Person <select id="oc-emp">${opts}</select></label>
    <div style="display:flex;gap:8px;align-items:end">
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="oc-days">
        ${days.map((d, i) => `<label style="flex-direction:row;gap:4px;align-items:center;background:var(--panel2);padding:6px 8px;border-radius:6px">
          <input type="checkbox" class="oc-day" value="${d}" data-i="${i}"><span>${DAYN[i]} ${d.slice(5)}</span></label>`).join("")}
      </div>
    </div>
    <button class="btn primary" id="oc-assign">Assign</button>
    <button class="btn danger" id="oc-remove">Remove</button>
  </div>
  <div class="hint">Assigning overwrites any existing entries for those days (source = Published Rotation).</div>`;
  const empSel = $("#oc-emp");
  const syncChecks = () => {
    const emp = empSel.value;
    $$(".oc-day").forEach(c => {
      c.checked = S.oncall.some(o => o.employee === emp && o.date === c.value);
    });
  };
  syncChecks();
  empSel.addEventListener("change", syncChecks);
  const checked = () => $$(".oc-day").filter(c => c.checked).map(c => c.value);
  $("#oc-assign").addEventListener("click", async () => {
    const dates = checked();
    if (!dates.length) return toast("Select at least one day", "err");
    try {
      const r = await api("/api/admin/oncall", { method: "POST", body: { employeenumber: empSel.value, dates } });
      toast(`Assigned ${r.written} day(s)`); await refresh();
    } catch (e) { toast(e.message, "err"); }
  });
  $("#oc-remove").addEventListener("click", async () => {
    const dates = checked();
    if (!dates.length) return toast("Select at least one day", "err");
    for (const d of dates) {
      try {
        await api(`/api/admin/oncall?emp=${empSel.value}&date=${d}`, { method: "DELETE" });
      } catch (e) { toast(e.message, "err"); return; }
    }
    toast("Removed"); await refresh();
  });
}
function renderAdminPeople() {
  const el = $("#tab-people");
  el.innerHTML = `
  <div class="hint" style="margin-bottom:10px">Identity linking: set the person's <b>Teams (Entra) email</b> — the app matches it to the signed-in user. Toggle who can approve.</div>
  <table><tr><th>Name</th><th>Number</th><th>Primary email</th><th>Teams email (link)</th><th>Approver</th></tr>
  ${S.roster.map(p => `<tr>
    <td><b>${esc(p.name)}</b></td><td>${esc(p.employee)}</td><td style="color:var(--muted);font-size:12px">${esc(p.email || "—")}</td>
    <td><input class="pe-mail" data-emp="${esc(p.employee)}" placeholder="email@company.sa" style="width:200px"></td>
    <td><span class="switch ${p.is_approver ? "on" : ""}" data-emp="${esc(p.employee)}" data-on="${p.is_approver}"></span></td>
  </tr>`).join("")}
  </table>`;
  el.querySelectorAll(".pe-mail").forEach(inp => inp.addEventListener("change", async () => {
    try {
      await api(`/api/admin/employees/${inp.dataset.emp}`, { method: "PATCH", body: { teams_email: inp.value } });
      toast("Teams email saved"); await loadBase();
    } catch (e) { toast(e.message, "err"); }
  }));
  el.querySelectorAll(".switch[data-emp]").forEach(sw => sw.addEventListener("click", async () => {
    try {
      await api(`/api/admin/employees/${sw.dataset.emp}`, { method: "PATCH", body: { is_approver: sw.dataset.on !== "true" } });
      toast("Approver updated"); await loadBase();
    } catch (e) { toast(e.message, "err"); }
  }));
}
function renderAdminSettings() {
  const el = $("#tab-settings");
  const rows = Object.entries(S.settings).map(([k, v]) => `<tr>
    <td><b>${esc(k)}</b></td>
    <td><input class="st-val" data-name="${esc(k)}" value="${esc(v)}" style="width:220px"></td>
    <td><button class="btn" data-save="${esc(k)}">Save</button></td>
  </tr>`).join("");
  el.innerHTML = `
  <div class="hint" style="margin-bottom:10px">Data-driven rules. <b>request_types</b> = allowed request types (add new ones here — no code change). <b>absence_types</b> = types counted against the daily limit. Times are HH:MM AST.</div>
  <table><tr><th>Key</th><th>Value</th><th></th></tr>${rows}</table>`;
  el.querySelectorAll("[data-save]").forEach(btn => btn.addEventListener("click", async () => {
    const name = btn.dataset.save;
    const val = el.querySelector(`.st-val[data-name="${name}"]`).value;
    try {
      await api("/api/admin/settings", { method: "POST", body: { name, value_str: val } });
      toast(`Saved ${name}`); await loadBase();
    } catch (e) { toast(e.message, "err"); }
  }));
}

// ---------- sign in / out ----------
async function doSign(direction) {
  const btn = direction === "in" ? $("#btn-signin") : $("#btn-signout");
  btn.disabled = true;
  try {
    const g = await getLocation();
    toast("Checking location…");
    const r = await api("/api/signin", { method: "POST", body: {
      direction, latitude: g.lat, longitude: g.lon, accuracy: g.acc,
    } });
    toast(direction === "in" ? `Signed in ✓ ${r.site}` : `Signed out ✓ ${r.site}`);
    await refresh();
  } catch (e) {
    toast(`${direction === "in" ? "Sign-in" : "Sign-out"} blocked: ${e.message}`, "err");
  } finally { btn.disabled = false; }
}

// ---------- wire up ----------
document.addEventListener("DOMContentLoaded", async () => {
  $$("#nav button").forEach(b => b.addEventListener("click", () => showScreen(b.dataset.screen)));
  $("#btn-signin").addEventListener("click", () => doSign("in"));
  $("#btn-signout").addEventListener("click", () => doSign("out"));
  $("#wk-prev").addEventListener("click", async () => { S.weekStart = addDays(S.weekStart, -7); await refresh(); });
  $("#wk-next").addEventListener("click", async () => { S.weekStart = addDays(S.weekStart, 7); await refresh(); });
  $("#wk-today").addEventListener("click", async () => { S.weekStart = startOfWeek(new Date()); await refresh(); });
  $("#wk-refresh").addEventListener("click", async () => { await refresh(); toast("Refreshed"); });
  $("#req-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = {
      type: $("#rf-type").value, date: $("#rf-date").value,
      date2: $("#rf-date2").value || null, otheremp: $("#rf-other").value.trim() || null,
      reason: $("#rf-reason").value.trim(),
    };
    if (body.date2 && body.date2 < body.date) return toast("End date before start date", "err");
    try {
      const r = await api("/api/requests", { method: "POST", body });
      toast(r.exceeds ? "Submitted — flagged: would exceed daily limit (approver decides)" : "Request submitted ✓");
      $("#rf-reason").value = ""; $("#rf-other").value = ""; $("#rf-date2").value = "";
      await refresh();
    } catch (err) { toast(err.message, "err"); }
  });
  $$("#admin-tabs button").forEach(b => b.addEventListener("click", () => { S.adminTab = b.dataset.tab; renderAdmin(); }));
  const al = $("#btn-auth-login"); if (al) al.addEventListener("click", () => pkceLogin());
  const ac = $("#btn-auth-copy"); if (ac) ac.addEventListener("click", () => {
    navigator.clipboard.writeText($("#unlinked-email").textContent).then(() => toast("Email copied — send it to your supervisor"));
  });
  setInterval(() => { if (!document.hidden && (S.screen === "today" || S.screen === "approvals")) refresh().catch(() => { }); }, 60000);
  // identity first (prod only), then data
  if (API_BASE) {
    const tok = await ensureAuth();
    if (!tok) { showAuthScreen("login"); return; }
  }
  try {
    await refreshAll();
  } catch (e) {
    if (e.code === 403 && e.detail && e.detail.email) { showAuthScreen("unlinked", e.detail.email); return; }
    if (e.code === 401 && API_BASE) { showAuthScreen("login"); return; }
    toast("Failed to load: " + e.message, "err");
  }
});
