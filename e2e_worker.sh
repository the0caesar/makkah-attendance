#!/bin/bash
# E2E test for the CLOUDFLARE WORKER (run after: npx wrangler dev --port 8788 in worker/)
# Static checks run against the LIVE GitHub Pages site (the Worker is API-only).
B=http://localhost:8788
STATIC=https://the0caesar.github.io/makkah-attendance/
pass=0; fail=0
ck() { # ck <label> <expected-substring> <actual>  (normalizes JSON to Python-style spacing)
  local norm
  norm=$(echo "$3" | python -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=1))" 2>/dev/null)
  [ -z "$norm" ] && norm=$3
  if echo "$norm" | grep -q "$2"; then echo "PASS: $1"; pass=$((pass+1));
  else echo "FAIL: $1  [got: $(echo "$norm" | head -c 200)]"; fail=$((fail+1)); fi
}
j() { python -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }

echo "== 0. health =="
ck "health" '"ok": true' "$(curl -s -m 30 $B/health)"

echo "== 1. whoami (dev hatch) =="
W=$(curl -s -m 90 $B/api/whoami)
ck "whoami name" "Essam Al-Ahmadi" "$W"
ck "whoami approver" '"is_approver": true' "$W"

echo "== 2. create site =="
S=$(curl -s -m 60 -X POST $B/api/admin/sites -H 'Content-Type: application/json' -d '{"name":"E2E Test Site","latitude":21.500320,"longitude":39.780203,"radius":200}')
ck "site created" '"ok": true' "$S"

echo "== 3. sign-in inside site =="
SI=$(curl -s -m 60 -X POST $B/api/signin -H 'Content-Type: application/json' -d '{"direction":"in","latitude":21.500320,"longitude":39.780203,"accuracy":5}')
ck "signin allowed" '"ok": true' "$SI"
ck "signin site name" "E2E Test Site" "$SI"

echo "== 4. sign-in outside site (must block) =="
SO=$(curl -s -m 60 -X POST $B/api/signin -H 'Content-Type: application/json' -d '{"direction":"in","latitude":21.75,"longitude":39.95,"accuracy":5}')
ck "outside blocked" "outside allowed locations" "$SO"

echo "== 5. submit vacation request =="
R=$(curl -s -m 60 -X POST $B/api/requests -H 'Content-Type: application/json' -d '{"type":"Vacation","date":"2026-10-08","reason":"E2E test"}')
ck "request created" '"ok": true' "$R"
RID=$(echo "$R" | j id)
echo "   rid=$RID"

echo "== 6. approve vacation =="
AP=$(curl -s -m 60 -X PATCH $B/api/requests/$RID -H 'Content-Type: application/json' -d '{"action":"approve"}')
ck "approved" '"ok": true' "$AP"
GV=$(curl -s -m 60 "$B/api/requests?mine=1")
ck "status approved" '"status": 100000002' "$GV"

echo "== 7. on-call swap request + approve =="
R2=$(curl -s -m 60 -X POST $B/api/requests -H 'Content-Type: application/json' -d '{"type":"On-Call","date":"2026-10-11","otheremp":"104674","reason":"E2E swap"}')
RID2=$(echo "$R2" | j id)
ck "swap request created" '"ok": true' "$R2"
AP2=$(curl -s -m 60 -X PATCH $B/api/requests/$RID2 -H 'Content-Type: application/json' -d '{"action":"approve"}')
ck "swap approved" '"ok": true' "$AP2"
OC=$(curl -s -m 60 "$B/api/oncall?from=2026-10-11&to=2026-10-11")
ck "oncall row exists (70180)" '"employee": "70180"' "$OC"

echo "== 8. submit + cancel reset request =="
R3=$(curl -s -m 60 -X POST $B/api/requests -H 'Content-Type: application/json' -d '{"type":"Reset","date":"2026-10-09","reason":"E2E"}')
RID3=$(echo "$R3" | j id)
C=$(curl -s -m 60 -X PATCH $B/api/requests/$RID3 -H 'Content-Type: application/json' -d '{"action":"cancel"}')
ck "cancelled" '"ok": true' "$C"

echo "== 9. admin on-call assign =="
OA=$(curl -s -m 60 -X POST $B/api/admin/oncall -H 'Content-Type: application/json' -d '{"employeenumber":"104674","dates":["2026-10-11"]}')
ck "oncall assigned" '"written": 1' "$OA"

echo "== 10. sign-ins list =="
SG=$(curl -s -m 60 $B/api/signins)
ck "signin recorded" '"direction": "in"' "$SG"

echo "== 11. settings + roster + static (live Pages) =="
ck "settings daily_limit" '"daily_limit": 2' "$(curl -s -m 30 $B/api/settings)"
ck "roster 22" '"employee": "70180"' "$(curl -s -m 30 $B/api/roster)"
ck "static html" "Team Pulse" "$(curl -s -m 30 $STATIC/)"
ck "static js" "Team Pulse" "$(curl -s -m 30 $STATIC/app.js)"

echo
echo "RESULT: $pass passed, $fail failed"
exit $fail
