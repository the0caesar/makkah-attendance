// Identity-path test for the Worker (run: node worker/test_identity.mjs)
// Crafted UNSIGNED JWTs (alg:none) are fine here: the v1 worker decodes the
// payload without signature verification (SPEC §8.20 — hardening = step 8b).
// Verifies: linked email -> 200 identity; unknown email -> 403+email; no token -> 401.
// Requires scratch files wtest_env.json + wtest_secret.txt (built from dataverse.json).
import { readFileSync, copyFileSync } from "node:fs";

const SCR = "C:/Users/Essam Omar/AppData/Local/hermes/cache/scratch";
const env = JSON.parse(readFileSync(SCR + "/wtest_env.json", "utf8"));
const secret = readFileSync(SCR + "/wtest_secret.txt", "utf8").trim();
const E = {
  DV_ORG_URL: env.org_url,
  DV_TENANT_ID: env.tenant_id,
  DV_CLIENT_ID: env.client_id,
  DV_CLIENT_SECRET: secret,
  ALLOWED_ORIGIN: "https://the0caesar.github.io",
  // no DEV_EMPLOYEE_NUMBER -> production identity path
};

const b64u = (s) => Buffer.from(s).toString("base64url");
const fakeJwt = (email) =>
  b64u(JSON.stringify({ alg: "none", typ: "JWT" })) + "." +
  b64u(JSON.stringify({ email, preferred_username: email, exp: 9999999999 })) + "." +
  b64u("sig");

// import the worker as ESM via a .mjs copy (worker/ package.json has no type:module)
const src = process.argv[1].replace(/test_identity\.mjs$/, "index.js");
copyFileSync(src, SCR + "/widx.mjs");
const mod = await import("file:///" + (SCR + "/widx.mjs").replace(/\\/g, "/"));
const H = { "Content-Type": "application/json" };

let r = await mod.default.fetch(new Request("http://x/api/whoami", { headers: { ...H, authorization: "Bearer " + fakeJwt("EOAhmadi@ngrid.sa") } }), E);
console.log("LINKED :", r.status, await r.text());

r = await mod.default.fetch(new Request("http://x/api/whoami", { headers: { ...H, authorization: "Bearer " + fakeJwt("eoahmadi@ngrid.sa") } }), E);
console.log("LOWER  :", r.status, (await r.text()).slice(0, 80));

r = await mod.default.fetch(new Request("http://x/api/whoami", { headers: { ...H, authorization: "Bearer " + fakeJwt("nobody@nowhere.com") } }), E);
console.log("UNLINK :", r.status, await r.text());

r = await mod.default.fetch(new Request("http://x/api/whoami"), E);
console.log("NOTOK  :", r.status, await r.text());

r = await mod.default.fetch(new Request("http://x/api/whoami", { headers: { ...H, authorization: "Bearer not.a.jwt" } }), E);
console.log("GARBAGE:", r.status, await r.text());
