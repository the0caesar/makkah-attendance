// Unit tests for reminderPlan (pure function — no I/O, no time travel needed).
// Run: node worker/test_reminders.mjs
import { readFileSync, copyFileSync } from "node:fs";

const SCR = "C:/Users/Essam Omar/AppData/Local/hermes/cache/scratch";
copyFileSync(process.argv[1].replace(/test_reminders\.mjs$/, "index.js"), SCR + "/widx2.mjs");
const { reminderPlan } = await import("file:///" + (SCR + "/widx2.mjs").replace(/\\/g, "/"));

const S = { shift_start: "07:30", shift_end: "15:30", reminder_lead_minutes: 30, reminder_interval_minutes: 10, reminder_stop_after_minutes: 60 };
// windows (AST): sign-in 07:00-08:00 (UTC 04:00-05:00); sign-out 15:00-16:00 (UTC 12:00-13:00)
const R = [
  { employee: "A1", name: "Alice", email: "a@x.sa" },
  { employee: "B1", name: "Bob", email: "b@x.sa" },
  { employee: "C1", name: "Cate", email: "c@x.sa" },
  { employee: "D1", name: "Dave", email: "d@x.sa" }, // on approved vacation today
];
const U = (h, m) => new Date(Date.UTC(2026, 9, 8, h, m, 0)); // Oct 8 2026 (a Sunday)
let pass = 0, fail = 0;
const t = (label, now, signins, expected) => {
  const got = reminderPlan(U(now[0], now[1]), S, R, signins, new Set(["D1"])).map((x) => x.employee + ":" + x.kind).sort();
  const want = [...expected].sort();
  if (JSON.stringify(got) === JSON.stringify(want)) { console.log("PASS:", label); pass++; }
  else { console.log("FAIL:", label, "got", JSON.stringify(got), "want", JSON.stringify(want)); fail++; }
};

t("07:00 AST first due, only unsigned A (B in, C out, D vacation)", [4, 0],
  [{ employee: "B1", direction: "in" }, { employee: "C1", direction: "out" }],
  ["A1:in"]);
t("07:35 AST not on 10-min boundary -> none", [4, 35],
  [{ employee: "B1", direction: "in" }], []);
t("07:40 AST boundary -> A in only", [4, 40],
  [{ employee: "B1", direction: "in" }, { employee: "C1", direction: "out" }], ["A1:in"]);
t("07:05 AST (5 min after window start, not on boundary) -> none", [4, 5], [], []);
t("05:01 UTC=08:01 AST past stop-after -> none", [5, 1],
  [{ employee: "B1", direction: "in" }], []);
t("15:00 AST sign-out window start -> B (in) gets out reminder", [12, 0],
  [{ employee: "B1", direction: "in" }], ["B1:out"]);
t("15:05 AST not on boundary -> none", [12, 5],
  [{ employee: "B1", direction: "in" }], []);
t("16:01 AST past stop-after -> none", [13, 1],
  [{ employee: "B1", direction: "in" }], []);
t("B signed in then out (latest wins) -> no out reminder", [12, 0],
  [{ employee: "B1", direction: "out" }, { employee: "B1", direction: "in" }], []);
t("vacation D excluded; unsigned A/B/C all reminded", [4, 0], [], ["A1:in", "B1:in", "C1:in"]);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
