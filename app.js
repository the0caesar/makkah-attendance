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
  redirect_uri: (() => { const u = new URL(location.href); u.hash = ""; u.search = ""; return u.href; })(),
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getLocation(ms = 15000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Geolocation not supported here"));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => rej(new Error({ 1: "Location permission denied", 2: "Position unavailable (GPS off?)", 3: "Timed out" }[e.code] || "Location error")),
      { enableHighAccuracy: true, timeout: ms, maximumAge: 0 });
  });
}

// ---------- map picker (in-app Leaflet overlay; no separate page, no second sign-in) ----------
let mpMap = null, mpMarker = null, mpCircle = null, mpPos = null;
function openMapPicker() {
  if (!window.L) { toast("Map couldn't load inside the app — use 🌐 Open in browser instead.", "err"); return; }
  $("#map-picker").style.display = "block";
  $("#mp-coord").textContent = "";
  const st = $("#mp-status"); st.textContent = "Click the map — or drag the pin — to the exact spot."; st.className = "hint";
  if (!mpMap) {
    mpMap = L.map("mp-map").setView([24.4686, 39.6142], 14); // Makkah
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
    L.control.layers({ "Satellite": sat, "Streets": streets }, null, { position: "topright" }).addTo(mpMap);
    sat.addTo(mpMap);
    mpMap.on("click", e => mpPlace(e.latlng.lat, e.latlng.lng, null));
  }
  mpMap.invalidateSize();
  // try GPS briefly (mobile works; Teams desktop hangs -> stays on Makkah, user clicks)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => mpPlace(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      () => {}, { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 });
  }
}
function mpPlace(lat, lon, acc) {
  mpPos = { lat, lon };
  if (!mpMarker) {
    mpMarker = L.marker([lat, lon], { draggable: true }).addTo(mpMap);
    mpMarker.on("dragend", () => { const p = mpMarker.getLatLng(); mpPos = { lat: p.lat, lon: p.lng }; mpUpdate(); });
  } else mpMarker.setLatLng([lat, lon]);
  mpMap.panTo([lat, lon], { zoom: Math.max(mpMap.getZoom(), 16), animate: true });
  mpUpdate();
  if (acc != null) { const st = $("#mp-status"); st.textContent = "Accuracy ±" + Math.round(acc) + " m — drag the pin to fine-tune."; st.className = "hint"; }
}
function mpUpdate() {
  if (!mpPos) return;
  $("#mp-coord").textContent = mpPos.lat.toFixed(6) + ", " + mpPos.lon.toFixed(6);
  const r = parseInt($("#mp-radius").value, 10) || 200;
  if (mpCircle) mpCircle.setLatLng([mpPos.lat, mpPos.lon]).setRadius(r);
  else mpCircle = L.circle([mpPos.lat, mpPos.lon], { radius: r, color: "#4cc2ff", weight: 2, fillOpacity: 0.12 }).addTo(mpMap);
}
function useMapLocation() {
  if (!mpPos) { toast("Pick a spot on the map first", "err"); return; }
  $("#sf-lat").value = mpPos.lat.toFixed(6);
  $("#sf-lon").value = mpPos.lon.toFixed(6);
  const nm = $("#mp-name").value, rd = $("#mp-radius").value;
  if (nm) $("#sf-name").value = nm;
  if (rd) $("#sf-radius").value = rd;
  $("#map-picker").style.display = "none";
  toast("Location set — press Add site");
}
function cancelMapPicker() { $("#map-picker").style.display = "none"; }

// ---------- identity (Teams SSO → PKCE fallback; see SPEC.md §3) ----------
let AUTH_ERR = null; // last sign-in failure reason, shown on the auth screen
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
  // MSAL v5: initialize() bootstraps storage only (does NOT process the hash).
  try { await m.initialize(); } catch (e) { /* non-fatal */ }
  // AAD returns with #code=...&state=... in the hash. We do NOT use MSAL's
  // browser-side handleRedirectPromise: AAD refuses browser redemption of PKCE
  // codes for Web-registered apps (AADSTS9002326, SPA-only). Instead we relay
  // the one-time code + PKCE verifier to our Worker, which redeems it
  // server-side (the classic allowed path) and returns the AAD id_token.
  const hash = location.hash;
  const codeM = hash.match(/code=([^&]+)/);
  const stateM = hash.match(/state=([^&]+)/);
  if (!codeM) return null; // fresh load — nothing to exchange
  const b64u = (s) => { let x = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "="; return atob(x); };
  let verifier = null, expectedState = null;
  try {
    const vRaw = sessionStorage.getItem("msal." + AUTH.client_id + ".code.verifier");
    if (vRaw) verifier = b64u(vRaw);
    const pRaw = sessionStorage.getItem("msal." + AUTH.client_id + ".request.params");
    if (pRaw) { const p = JSON.parse(b64u(pRaw)); if (p.state) expectedState = JSON.parse(b64u(p.state)).id || null; }
  } catch (e) { console.warn("read msal temp state:", e); }
  // CSRF guard: returned state must equal the state MSAL sent (when both parse)
  if (stateM && expectedState) {
    let actual = null;
    try { actual = JSON.parse(b64u(decodeURIComponent(stateM[1]))).id; } catch (e) { }
    if (actual && actual !== expectedState) { AUTH_ERR = "state mismatch (csrf)"; return null; }
  }
  if (!verifier) { AUTH_ERR = "pkce verifier missing"; return null; }
  try {
    const res = await fetch(API_BASE + "/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: decodeURIComponent(codeM[1]), verifier, redirect_uri: AUTH.redirect_uri }),
    });
    const j = await res.json();
    if (j.id_token) {
      // consume the code+state so a refresh can't re-attempt the (single-use) code
      history.replaceState(null, "", location.pathname + location.search);
      return j.id_token;
    }
    AUTH_ERR = (j.error || "token exchange failed") + (j.description ? ": " + j.description : "");
    return null;
  } catch (e) { AUTH_ERR = e.message || String(e); return null; }
}
async function pkceLogin() {
  const inTeams = await teamsContextProbe();
  if (inTeams) {
    // Inside Teams (desktop or mobile): SSO dialog, else Teams-injected identity.
    AUTH_ERR = "";
    const btn = document.getElementById("btn-auth-login"); if (btn) btn.disabled = true;
    teamsSsoToken()
    .then(t => t || teamsContextToken()) // SSO token, else Teams-injected identity
    .then(t => {
      if (t) {
        ID_TOKEN = t;
        return refreshAll().catch(e => {
          if (e.code === 403 && e.detail && e.detail.email) { showAuthScreen("unlinked", e.detail.email); return; }
          AUTH_ERR = (e.message || String(e)) + " (after sign-in)"; showAuthScreen("login");
        });
      }
      AUTH_ERR = "No Teams identity available (SSO and context both failed)"; showAuthScreen("login");
    })
    .catch(async e => {
      // SSO threw — still try the Teams-injected identity before giving up
      try {
        const ct = await teamsContextToken();
        if (ct) {
          ID_TOKEN = ct;
          return refreshAll().catch(re => {
            if (re.code === 403 && re.detail && re.detail.email) { showAuthScreen("unlinked", re.detail.email); return; }
            AUTH_ERR = (re.message || String(re)) + " (after sign-in)"; showAuthScreen("login");
          });
        }
      } catch (e2) { }
      AUTH_ERR = "Teams sign-in: " + (e && (e.errorDescription || e.errorMessage || e.errorCode || e.message)) || String(e);
      console.warn("Teams sign-in failed:", e);
      showAuthScreen("login");
    })
    .finally(() => { if (btn) btn.disabled = false; });
    return;
  }
  const m = getMsal();
  if (!m) return toast("Login library not loaded (CDN blocked?)", "err");
  // Clear stale interaction state from a previous round trip that never completed
  // (e.g. an exchange that failed). MSAL v5 silently refuses a new loginRedirect
  // while `msal.interaction.status` lingers — that reads as "click does nothing".
  try {
    sessionStorage.removeItem("msal.interaction.status");
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith("msal.") && (k.includes(".code.verifier") || k.includes(".request.origin") || k.includes(".request.params") || k.includes(".interaction.status"))) sessionStorage.removeItem(k);
    }
  } catch (e) { /* storage unavailable — proceed anyway */ }
  try {
    m.loginRedirect({ scopes: AUTH.scopes }).catch(e => {
      AUTH_ERR = (e && (e.errorCode ? e.errorCode + ": " + (e.errorMessage || "") : e.message)) || String(e);
      showAuthScreen("login");
    });
  } catch (e) {
    AUTH_ERR = e.message || String(e);
    showAuthScreen("login");
  }
}
function looksLikeTeamsUA() {
  try { return /teams/i.test(navigator.userAgent || ""); } catch (e) { return false; }
}
async function teamsContextProbe() {
  // Works in BOTH desktop (iframe) and mobile (top-level webview) Teams.
  // Guard: UA must say Teams AND the SDK context must actually resolve —
  // in a plain browser getContext() never resolves, so the 5s timeout bails out.
  if (!looksLikeTeamsUA()) return null;
  try {
    if (!(window.microsoftTeams && microsoftTeams.app && microsoftTeams.app.getContext)) return null;
    const r = await Promise.race([
      (async () => { await microsoftTeams.initialize(); return microsoftTeams.app.getContext(); })(),
      new Promise(res => setTimeout(() => res(null), 5000)),
    ]);
    return (r && (r.ssoInTeams || r.team || r.chat || r.user)) ? r : null;
  } catch (e) { return null; }
}
async function teamsSsoToken() {
  // Teams tab: broker the token via Teams SSO (no browser redirect possible in-iframe)
  const r = await microsoftTeams.authentication.getAuthToken({
    scopes: ["openid", "profile", "email"],
    expirationInMilliseconds: 5 * 60 * 1000, idToken: true,
  });
  return (r && r.token) || null;
}
async function teamsContextToken() {
  // Fallback when SSO is unavailable: the Teams webview itself injects the signed-in
  // user's identity into the app context (userPrincipalName / UPN). No token
  // exchange, no portal config — but it's an unsigned JWT (Worker v1 is decode-only;
  // the security upgrade to signature verification is the documented 8b step).
  const ctx = await microsoftTeams.app.getContext();
  const u = (ctx && ctx.user) || {};
  const upn = u.userPrincipalName
    || (u.id && String(u.id).indexOf("@") >= 0 ? String(u.id) : null)
    || u.email || null;
  if (!upn) return null;
  const b64u = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64u({ alg: "none", typ: "JWT" }) + "." +
    b64u({ email: upn, preferred_username: upn, name: u.displayName || "", auth: "teams-context" }) + ".";
}
async function ensureAuth() {
  if (!API_BASE) return null; // dev: API dev identity, no login needed
  if (AUTH.client_id.startsWith("REPLACE_")) return ID_TOKEN; // registration not created yet
  const inTeams = await teamsContextProbe();
  if (inTeams) {
    // Inside a real Teams webview (desktop iframe or mobile top-level): SSO first,
    // then the Teams-injected identity. No browser redirect possible here.
    try {
      const tok = await teamsSsoToken();
      if (tok) { ID_TOKEN = tok; return tok; }
      AUTH_ERR = "Teams SSO returned no token";
    } catch (e) {
      AUTH_ERR = "Teams SSO: " + (e && (e.errorDescription || e.errorMessage || e.errorCode || e.message)) || String(e);
      console.warn("Teams SSO failed:", e);
    }
    // Fallback: identity injected by the Teams webview itself (no token exchange)
    try {
      const ctok = await teamsContextToken();
      if (ctok) { ID_TOKEN = ctok; AUTH_ERR = ""; console.warn("using Teams context identity (SSO unavailable)"); return ctok; }
    } catch (e) { console.warn("Teams context identity failed:", e); }
    return ID_TOKEN; // null -> auth screen shows AUTH_ERR
  }
  // Plain browser: PKCE relay round trip (code + verifier exchanged via our Worker)
  try { const t = await pkceToken(); if (t) { ID_TOKEN = t; return t; } } catch (e) { console.warn("pkce:", e); }
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
  const ae = $("#auth-err");
  if (ae) { ae.textContent = AUTH_ERR ? "Sign-in error — " + AUTH_ERR : ""; ae.style.display = AUTH_ERR ? "" : "none"; }
}

// ---------- state ----------
const S = {
  me: null, roster: [], settings: {}, sites: [],
  weekStart: startOfWeek(new Date()),
  shiftWeekStart: startOfWeek(new Date()),
  gridView: "week",
  gt: { search: "", sort: "name-asc", date: todayISO(), status: "all" },
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
    r.status !== 100000004 && r.status !== 100000003); // cancelled & rejected: not active, hidden from grid
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
  $("#who").innerHTML = `<b>${esc(me.name || me.employee_number)}</b><br>${esc(me.email || "")}${me.is_approver ? " • admin" : ""}`;
  $("#nav-approvals").style.display = me.is_approver ? "" : "none";
  $("#nav-admin").style.display = me.is_approver ? "" : "none";
  const b = $("#banner");
  if (me.dev) { b.style.display = "block"; b.textContent = `DEV MODE — identity simulated: ${me.employee_number} (${me.email})`; }
  else if (!me.linked) { b.style.display = "block"; b.textContent = "Your email is not linked to a roster person yet — an admin must link it in Admin → People."; }
  else b.style.display = "none";
}
async function refresh() {
  // Data window adapts to the active grid view (week / month / year)
  let from, to;
  const ws = S.weekStart;
  if (S.gridView === "year") {
    from = `${ws.getFullYear()}-01-01`; to = `${ws.getFullYear()}-12-31`;
  } else if (S.gridView === "month") {
    const f = new Date(Date.UTC(ws.getFullYear(), ws.getMonth(), 1));
    const l = new Date(Date.UTC(ws.getFullYear(), ws.getMonth() + 1, 0));
    from = isoDate(addDays(f, -1)); to = isoDate(addDays(l, 1));
  } else {
    from = isoDate(addDays(ws, -1)); to = isoDate(addDays(ws, 8));
  }
  const [oc, reqs, sig, tr] = await Promise.all([
    api(`/api/oncall?from=${from}&to=${to}`),
    api(`/api/requests?from=${from}&to=${to}`),
    api(`/api/signins?days=30`),
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
  else if (S.screen === "shifts") renderShifts();
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
  // view label
  const ws = S.weekStart;
  if (S.gridView === "year") $("#wk-label").textContent = String(ws.getFullYear());
  else if (S.gridView === "month") $("#wk-label").textContent = ws.toLocaleDateString("en-GB", { timeZone: TZ, month: "long", year: "numeric" });
  else {
    const a = ws, b = addDays(ws, 6);
    $("#wk-label").textContent =
      `${a.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })} – ${b.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })}`;
  }
  $$("#viewtoggle button").forEach(b => b.classList.toggle("active", b.dataset.view === S.gridView));
  // grid
  const td = todayISO();
  const compact = S.gridView !== "week";
  const cols = S.gridView === "year" ? yearCols(ws) : S.gridView === "month" ? monthCols(ws) : weekCols(ws);
  let html = "<thead><tr><th>Person</th>";
  cols.forEach(c => {
    const cls = [c.today ? "today-col" : "", c.wknd ? "wknd" : ""].filter(Boolean).join(" ");
    html += `<th class="${cls}">${c.label}</th>`;
  });
  html += "</tr></thead><tbody>";
  for (const p of gridRows()) {
    const me = p.employee === S.me.employee_number;
    html += `<tr class="${me ? "me" : ""}">`;
    html += `<td class="person">${esc(p.name)}${me ? " (me)" : ""}<span class="m">${esc(p.employee)}${p.is_approver ? " • admin" : ""}</span></td>`;
    cols.forEach(c => {
      if (S.gridView === "year") {
        const cell = cellYear(p.employee, ws.getFullYear(), c.m);
        html += `<td class="compact ${c.today ? "today-col" : ""}" data-ym="${c.key}">${cell}</td>`;
      } else {
        const cls = [c.today ? "today-col" : "", c.wknd ? "wknd" : ""].filter(Boolean).join(" ");
        const cell = S.gridView === "month" ? cellChips(p.employee, c.date) : cellHTML(p.employee, c.date);
        html += `<td class="${compact ? "compact " : ""}${cls}" data-emp="${esc(p.employee)}" data-date="${c.date}">${cell}</td>`;
      }
    });
    html += "</tr>";
  }
  html += "</tbody>";
  const g = $("#grid");
  g.classList.toggle("compact", compact);
  g.innerHTML = html;
  $$("#grid td[data-emp]").forEach(tdEl => tdEl.addEventListener("click", () => openDetail(tdEl.dataset.emp, tdEl.dataset.date)));
  $$("#grid td[data-ym]").forEach(tdEl => tdEl.addEventListener("click", () => {
    const [y, m] = tdEl.dataset.ym.split("-").map(Number);
    S.gridView = "month";
    S.weekStart = new Date(Date.UTC(y, m - 1, 15));
    renderToday();
  }));
}
// grid columns per view
function weekCols(ws) {
  const td = todayISO();
  return weekDays(ws).map((d, i) => ({ date: d, label: `${DAYN[i]}<br>${d.slice(5)}`, today: d === td }));
}
function monthCols(ws) {
  const y = ws.getFullYear(), m = ws.getMonth();
  const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const td = todayISO();
  return [...Array(n)].map((_, i) => {
    const date = isoDate(new Date(Date.UTC(y, m, i + 1)));
    const wd = new Date(date + "T12:00:00").getDay();
    return { date, label: `${DAYN[wd][0]} ${i + 1}`, wknd: wd === 5 || wd === 6, today: date === td };
  });
}
function yearCols(ws) {
  const y = ws.getFullYear();
  const now = new Date();
  return MONTHS.map((nm, i) => ({ key: `${y}-${String(i + 1).padStart(2, "0")}`, m: i + 1, label: nm, today: y === now.getFullYear() && i === now.getMonth() }));
}
// rows after search + status filter + sort
function gridRows() {
  let rows = visibleEmployees();
  const q = S.gt.search.trim().toLowerCase();
  if (q) rows = rows.filter(p => (p.name || "").toLowerCase().includes(q) || String(p.employee).toLowerCase().includes(q));
  if (S.gt.status !== "all") rows = rows.filter(p => statusMatch(p, S.gt.date || todayISO()));
  const s = S.gt.sort;
  return [...rows].sort((a, b) => s === "name-desc" ? b.name.localeCompare(a.name)
    : s === "emp" ? String(a.employee).localeCompare(String(b.employee), undefined, { numeric: true })
    : a.name.localeCompare(b.name));
}
// status of one person on one date (for the status filter)
function statusMatch(p, date) {
  const st = S.gt.status;
  if (st === "all" || !date) return true;
  const oc = S.oncall.some(o => o.employee === p.employee && o.date === date);
  const reqs = requestsFor(p.employee, date);
  const hasType = t => reqs.some(r => r.type === t);
  const trn = S.training.some(t => t.employee === p.employee && t.start <= date && (t.end || t.start) >= date);
  const evs = S.signins.filter(x => x.employee === p.employee && (x.at || "").slice(0, 10) === date);
  switch (st) {
    case "oncall": return oc;
    case "vacation": return hasType("Vacation");
    case "reset": return hasType("Reset");
    case "training": return hasType("Training") || trn;
    case "overtime": return hasType("Overtime");
    case "callout": return hasType("Call-Out");
    case "other": return reqs.some(r => !["Vacation", "Reset", "Training", "Overtime", "Call-Out"].includes(r.type));
    case "free": return !oc && !reqs.length && !trn;
    case "in-loc": return evs.some(x => x.direction === "in" && x.allowed);
    case "in-out": return evs.some(x => x.direction === "in" && !x.allowed);
    case "out": return evs.some(x => x.direction === "out");
    case "nosignin": return evs.length === 0;
  }
  return true;
}
// compact month-view cell: short chips + sign-in dot
const TYPE_CODE = { "Vacation": "VAC", "Reset": "RST", "Training": "TRN", "Overtime": "OVT", "Call-Out": "CO", "Work Comp": "WC", "Training Comp": "TC" };
const typeCode = t => TYPE_CODE[t] || String(t).slice(0, 3).toUpperCase();
const chipClass = t => (TYPE_CLASS[t] || "b-other").replace("b-", "c-");
function cellChips(emp, date) {
  const out = [];
  const oc = S.oncall.find(o => o.employee === emp && o.date === date);
  if (oc) out.push(`<span class="chip c-oncall" title="On-call">OC</span>`);
  for (const r of requestsFor(emp, date)) {
    out.push(`<span class="chip ${chipClass(r.type)}" title="${esc(r.type)} — ${stLabel[r.status] || r.status}">${esc(typeCode(r.type))}</span>`);
  }
  const evs = S.signins.filter(x => x.employee === emp && (x.at || "").slice(0, 10) === date);
  if (evs.length) {
    const last = evs[0]; // newest first
    const cls = last.direction === "out" ? "out" : last.allowed ? "ok" : "bad";
    const title = last.direction === "out" ? "Signed out" : last.allowed ? "Signed in (site)" : "Signed in (outside site)";
    out.push(`<span class="sdot ${cls}" title="${title}"></span>`);
  }
  return out.join("") || "&nbsp;";
}
// year-view cell: counts for that month
function cellYear(emp, y, m) {
  const mm = String(m).padStart(2, "0");
  const first = `${y}-${mm}-01`;
  const last = `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const out = [];
  const ocDays = S.oncall.filter(o => o.employee === emp && o.date >= first && o.date <= last).length;
  if (ocDays) out.push(`<span class="chip c-oncall" title="On-call days in ${MONTHS[m - 1]}">${ocDays} OC</span>`);
  const counts = {};
  for (const r of S.requests) {
    if (r.employee !== emp || r.status === ST.cancelled) continue;
    const a = r.date, b = r.date2 || r.date;
    if (a <= last && b >= first) counts[r.type] = (counts[r.type] || 0) + 1;
  }
  for (const t of Object.keys(counts)) {
    out.push(`<span class="chip ${chipClass(t)}" title="${esc(t)} requests in ${MONTHS[m - 1]}">${counts[t]} ${esc(typeCode(t))}</span>`);
  }
  return out.join("") || '<span class="m">·</span>';
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
  d.innerHTML = `<h3>${esc(p ? p.name : emp)}</h3><div class="m">${esc(emp)} • ${date}${p && p.is_approver ? " • admin" : ""}</div>
    ${evs.join("") || '<div class="m">No activity on this day.</div>'}
    <button class="btn" style="margin-top:14px" onclick="document.getElementById('cell-detail').style.display='none'">Close</button>`;
  d.style.display = "block";
}

// ---------- shifts (schedule hub: shift hours + on-call week; admins edit, all view) ----------
function renderShifts() {
  const el = $("#shifts-body");
  if (!el) return;
  const isAdmin = !!(S.me && S.me.is_approver);
  const ws = S.shiftWeekStart;
  const a = ws, b = addDays(ws, 6);
  const weekLbl = `${a.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })} – ${b.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })}`;
  const days = weekDays(ws);
  const td = todayISO();
  const opts = S.roster.map(p => `<option value="${esc(p.employee)}">${esc(p.name)} (${esc(p.employee)})</option>`).join("");
  el.innerHTML = `
  <div class="card" style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <div class="m" style="margin:0 0 4px">Shift hours (AST)</div>
        <div style="font-size:22px;font-weight:700">${esc(S.settings.shift_start || "07:30")} – ${esc(S.settings.shift_end || "15:30")}</div>
      </div>
      ${isAdmin ? '<button class="btn" id="st-edit">Edit hours</button>' : '<span class="m">Set by an admin</span>'}
    </div>
    ${isAdmin ? `<div id="st-form" style="display:none;margin-top:14px">
      <div class="inline-form">
        <label>Start <input id="st-start" type="time" value="${esc(S.settings.shift_start || "07:30")}"></label>
        <label>End <input id="st-end" type="time" value="${esc(S.settings.shift_end || "15:30")}"></label>
        <button class="btn primary" id="st-save">Save</button>
      </div>
      <div class="hint" style="margin-top:8px">Used for the sign-in/out window and reminders. Change for Ramadan (e.g. 09:30–15:30), then back.</div>
    </div>` : ""}
  </div>

  <h3 style="margin:6px 0 8px">On-call — ${weekLbl}</h3>
  <div class="weeknav" style="margin-bottom:10px">
    <button class="btn" id="sh-prev">‹</button>
    <span id="sh-label">${weekLbl}</span>
    <button class="btn" id="sh-today">Today</button>
    <button class="btn" id="sh-next">›</button>
  </div>
  ${isAdmin ? `<div class="inline-form" style="margin-bottom:10px">
    <label>Assign <select id="sh-emp">${opts}</select></label>
  </div>` : ""}
  <table>
    <tr><th>Day</th><th>Date</th><th>On-call</th>${isAdmin ? "<th></th>" : ""}</tr>
    ${days.map((d, i) => {
      const oc = S.oncall.find(o => o.date === d);
      const p = oc ? person(oc.employee) : null;
      return `<tr class="${d === td ? "today-col" : ""}">
        <td>${DAYN[i]}</td><td>${d}</td>
        <td>${oc ? `<b>${esc(p ? p.name : oc.employee)}</b> <span class="m">${esc(oc.employee)}</span>` : '<span class="m">—</span>'}</td>
        ${isAdmin ? `<td>${oc
          ? `<button class="btn danger sm" data-act="del" data-date="${d}" data-emp="${esc(oc.employee)}">Remove</button>`
          : `<button class="btn sm" data-act="add" data-date="${d}">Assign</button>`}</td>` : ""}
      </tr>`;
    }).join("")}
  </table>`;

  // week nav
  $("#sh-prev").addEventListener("click", () => { S.shiftWeekStart = addDays(S.shiftWeekStart, -7); renderShifts(); });
  $("#sh-next").addEventListener("click", () => { S.shiftWeekStart = addDays(S.shiftWeekStart, 7); renderShifts(); });
  $("#sh-today").addEventListener("click", () => { S.shiftWeekStart = startOfWeek(new Date()); renderShifts(); });

  // shift-hours edit
  if (isAdmin) {
    $("#st-edit").addEventListener("click", () => { const f = $("#st-form"); f.style.display = f.style.display === "none" ? "block" : "none"; });
    $("#st-save").addEventListener("click", async () => {
      const s = $("#st-start").value, e2 = $("#st-end").value;
      if (!s || !e2) return toast("Set both start and end", "err");
      try {
        await api("/api/admin/settings", { method: "POST", body: { name: "shift_start", value_str: s } });
        await api("/api/admin/settings", { method: "POST", body: { name: "shift_end", value_str: e2 } });
        toast(`Shift hours ${s}–${e2}`); await loadBase(); renderShifts();
      } catch (err) { toast(err.message, "err"); }
    });
  }

  // on-call assign / remove (admin)
  if (isAdmin) {
    el.querySelectorAll('button[data-act]').forEach(btn => btn.addEventListener("click", async () => {
      const d = btn.dataset.date;
      try {
        if (btn.dataset.act === "del") {
          await api(`/api/admin/oncall?emp=${encodeURIComponent(btn.dataset.emp)}&date=${d}`, { method: "DELETE" });
          toast("Removed");
        } else {
          const emp = $("#sh-emp").value;
          const r = await api("/api/admin/oncall", { method: "POST", body: { employeenumber: emp, dates: [d] } });
          toast(`Assigned ${r.written} day(s)`);
        }
        await refresh(); renderShifts();
      } catch (e) { toast(e.message, "err"); }
    }));
  }
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
  else if (S.adminTab === "logs") renderAdminLogs();
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
    <button class="btn ghost" type="button" id="sf-geo-map">🗺️ Pick on map</button>
    <button class="btn ghost" type="button" id="sf-geo">📍 My location</button>
    <a class="btn ghost" id="sf-geo-browser" href="https://makkah-attendance-api.makkah-attendance-api.workers.dev/app/geo.html" target="_blank" title="Fallback: opens the map picker in your browser">🌐 Open in browser</a>
    <button class="btn primary" type="submit">Add site</button>
  </form>
  <table><tr><th>Site</th><th>Lat</th><th>Lon</th><th>Radius (m)</th><th>Enabled</th><th></th></tr>
  ${S.sites.map(s => `<tr>
    <td><b>${esc(s.name)}</b>${s.note ? `<div class="m" style="color:var(--muted);font-size:11px">${esc(s.note)}</div>` : ""}</td>
    <td>${s.lat}</td><td>${s.lon}</td>
    <td><input class="si-radius" data-id="${s.id}" value="${s.radius}" type="number" style="width:80px"></td>
    <td><span class="switch ${s.enabled ? "on" : ""}" data-id="${s.id}" data-on="${s.enabled}"></span></td>
    <td><a href="https://maps.google.com/?q=${s.lat},${s.lon}" target="_blank">map</a></td>
  </tr>`).join("") || '<tr><td colspan="6">No sites yet — add one above (📍 fills your current location).</td></tr>'}
  </table>`;
  $("#sf-geo-map").addEventListener("click", openMapPicker);
  $("#mp-use").addEventListener("click", useMapLocation);
  $("#mp-cancel").addEventListener("click", cancelMapPicker);
  $("#mp-radius").addEventListener("input", mpUpdate);
  $("#sf-geo").addEventListener("click", async () => {
    try {
      const g = await getLocation(6000); // short timeout: Teams desktop hangs (no GPS there)
      $("#sf-lat").value = g.lat.toFixed(6); $("#sf-lon").value = g.lon.toFixed(6);
      toast(`Location captured: ${g.lat.toFixed(4)}, ${g.lon.toFixed(4)} (±${Math.round(g.acc)}m)`);
    } catch (e) {
      toast("Location not readable inside Teams — use 🌐 Get location from browser (opens a helper page in your browser).", "err");
    }
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
function renderAdminLogs() {
  const el = $("#tab-logs");
  const rows = (S.signins || []).slice(0, 100);
  el.innerHTML = `
    <div class="hint" style="margin-bottom:10px">Sign-in/out log (newest first). <b>Edit</b> to correct a record; <b>Delete</b> to remove it. Only admins can change logs.</div>
    ${rows.length ? `
    <table>
      <tr><th>When (AST)</th><th>Person</th><th>Dir</th><th>Site</th><th>Allowed</th><th>Note</th><th></th></tr>
      ${rows.map((s, i) => {
        const p = person(s.employee);
        return `
        <tr>
          <td>${fmtTime(s.at)}</td>
          <td><b>${esc(p ? p.name : s.employee)}</b> <span class="m">${esc(s.employee)}</span></td>
          <td>${s.direction === "in" ? "In" : "Out"}</td>
          <td>${esc(s.site || "—")}</td>
          <td>${s.allowed ? "✓" : "⚠"}</td>
          <td class="m">${esc(s.note || "")}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" data-log="edit" data-idx="${i}">Edit</button>
            <button class="btn danger sm" data-log="del" data-idx="${i}">Delete</button>
          </td>
        </tr>
        <tr class="log-edit" data-idx="${i}" style="display:none">
          <td colspan="7">
            <div class="inline-form">
              <label>Direction <select class="le-dir">
                <option value="in" ${s.direction === "in" ? "selected" : ""}>In</option>
                <option value="out" ${s.direction === "out" ? "selected" : ""}>Out</option>
              </select></label>
              <label>Site <input class="le-site" value="${esc(s.site || "")}" maxlength="100"></label>
              <label>Allowed <select class="le-allowed">
                <option value="1" ${s.allowed ? "selected" : ""}>Yes</option>
                <option value="0" ${!s.allowed ? "selected" : ""}>No</option>
              </select></label>
              <label>Note <input class="le-note" value="${esc(s.note || "")}" maxlength="300"></label>
              <button class="btn primary sm" data-log="save" data-idx="${i}">Save</button>
              <button class="btn sm" data-log="cancel" data-idx="${i}">Cancel</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
    </table>` : '<div class="hint">No log entries yet.</div>'}
  `;
  el.querySelectorAll("[data-log]").forEach(btn => btn.addEventListener("click", async () => {
    const i = parseInt(btn.dataset.idx, 10), act = btn.dataset.log;
    const s = rows[i];
    const editRow = el.querySelector(`.log-edit[data-idx="${i}"]`);
    if (act === "edit") { editRow.style.display = "table-row"; return; }
    if (act === "cancel") { editRow.style.display = "none"; return; }
    if (act === "save") {
      const body = {
        id: s.id,
        direction: editRow.querySelector(".le-dir").value,
        site: editRow.querySelector(".le-site").value,
        allowed: editRow.querySelector(".le-allowed").value === "1",
        note: editRow.querySelector(".le-note").value,
      };
      try { await api("/api/admin/signins/update", { method: "POST", body }); toast("Log updated"); await refresh(); renderAdminLogs(); }
      catch (e) { toast(e.message, "err"); }
      return;
    }
    if (act === "del") {
      // Two-step in-page confirm: native confirm() is suppressed inside the
      // Teams iframe (dialog never shows, handler silently no-ops).
      if (btn.dataset.arm) {
        delete btn.dataset.arm;
        const id = s.id;
        try { await api("/api/admin/signins/delete", { method: "POST", body: { id } }); toast("Deleted"); await refresh(); renderAdminLogs(); }
        catch (e) { toast(e.message, "err"); }
        return;
      }
      btn.dataset.arm = "1";
      const old = btn.textContent;
      btn.textContent = "Confirm?";
      btn.title = "Click again to delete — cannot be undone";
      setTimeout(() => { delete btn.dataset.arm; btn.textContent = old; btn.title = ""; }, 3500);
      return;
    }
  }));
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
  $("#wk-prev").addEventListener("click", async () => {
    const x = new Date(S.weekStart);
    if (S.gridView === "year") x.setFullYear(x.getFullYear() - 1);
    else if (S.gridView === "month") x.setMonth(x.getMonth() - 1);
    else x.setDate(x.getDate() - 7);
    S.weekStart = x; await refresh();
  });
  $("#wk-next").addEventListener("click", async () => {
    const x = new Date(S.weekStart);
    if (S.gridView === "year") x.setFullYear(x.getFullYear() + 1);
    else if (S.gridView === "month") x.setMonth(x.getMonth() + 1);
    else x.setDate(x.getDate() + 7);
    S.weekStart = x; await refresh();
  });
  $("#wk-today").addEventListener("click", async () => { S.weekStart = startOfWeek(new Date()); await refresh(); });
  $("#wk-refresh").addEventListener("click", async () => { await refresh(); toast("Refreshed"); });
  $$("#viewtoggle button").forEach(b => b.addEventListener("click", async () => {
    if (S.gridView === b.dataset.view) return;
    S.gridView = b.dataset.view;
    await refresh();
  }));
  $("#gt-search").addEventListener("input", () => { S.gt.search = $("#gt-search").value; renderToday(); });
  $("#gt-sort").addEventListener("change", () => { S.gt.sort = $("#gt-sort").value; renderToday(); });
  $("#gt-date").addEventListener("change", () => { S.gt.date = $("#gt-date").value || todayISO(); renderToday(); });
  $("#gt-status").addEventListener("change", () => { S.gt.status = $("#gt-status").value; renderToday(); });
  $("#gt-date").value = todayISO();
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
  // location-helper handoff: geo.html (map picker) opens the app with ?site=lat,lon&name=..&radius=..
  const sm = /[?&]site=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(location.search);
  if (sm && S.me && S.me.is_approver) {
    S.adminTab = "sites";
    showScreen("admin");
    const lat = $("#sf-lat"), lon = $("#sf-lon"), nm = $("#sf-name"), rd = $("#sf-radius");
    if (lat && lon) {
      lat.value = sm[1]; lon.value = sm[2];
      const nmM = /[?&]name=([^&]+)/.exec(location.search);
      const rdM = /[?&]radius=(\d+)/.exec(location.search);
      if (nmM && nm) nm.value = decodeURIComponent(nmM[1]);
      if (rdM && rd) rd.value = rdM[1];
      toast("Site picked from map — press Add site");
    }
  }
});
