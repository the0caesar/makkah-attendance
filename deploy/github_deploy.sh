#!/usr/bin/env bash
# One-shot GitHub Pages deploy for the Makkah attendance app.
# INPUT (one-time, by Essam): classic PAT with `repo` scope saved to
#   C:\Users\Essam Omar\AppData\Local\hermes\github_pat.txt
# The script creates the repo if missing, pushes deploy/web, enables Pages,
# polls until built, verifies, and deletes the PAT file. Safe to re-run.
set -e
cd "$(dirname "$0")"

PAT_FILE="C:/Users/Essam Omar/AppData/Local/hermes/github_pat.txt"
[ -f "$PAT_FILE" ] || { echo "MISSING $PAT_FILE (see DEPLOY-HANDOFF.md)"; exit 1; }
PAT=$(tr -d '\r\n' < "$PAT_FILE")
[ -n "$PAT" ] || { echo "PAT file is empty"; exit 1; }

REPO_OWNER=the0caesar
REPO=makkah-attendance
API=https://api.github.com
H1="Authorization: Bearer $PAT"
H2="Accept: application/vnd.github+json"

echo "== 1/4 repo =="
code=$(curl -s -o /dev/null -w "%{http_code}" -H "$H1" $API/repos/$REPO_OWNER/$REPO)
if [ "$code" = "404" ]; then
  curl -s -H "$H1" -H "$H2" -X POST $API/user/repos \
    -d '{"name":"'"$REPO"'","private":true,"description":"Makkah protection team attendance app (static web, GitHub Pages)"}' | head -c 300
  echo
fi

echo "== 2/4 push =="
cd web
git add -A
git -c user.name=the0caesar -c user.email=the0caesar@users.noreply.github.com commit -q --allow-empty -m "Makkah attendance web app (GitHub Pages)"
git remote add origin "https://x-oauth-basic:$PAT@github.com/$REPO_OWNER/$REPO.git" 2>/dev/null || git remote set-url origin "https://x-oauth-basic:$PAT@github.com/$REPO_OWNER/$REPO.git"
git push -f origin main
cd ..

echo "== 3/4 pages =="
curl -s -H "$H1" -H "$H2" -X POST $API/repos/$REPO_OWNER/$REPO/pages -d '{"source":{"branch":"main","path":"/"}}' | head -c 400
echo

echo "== 4/4 wait for build =="
for i in $(seq 1 30); do
  sleep 10
  line=$(curl -s -H "$H1" -H "$H2" $API/repos/$REPO_OWNER/$REPO/pages | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'),'|',d.get('html_url',''),'|',d.get('built_at',''))" 2>/dev/null || echo "err")
  echo "  [$i] $line"
  case "$line" in *built*) break;; esac
done

URL="https://$REPO_OWNER.github.io/$REPO/"
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
echo "live check $URL -> HTTP $code"
[ "$code" = "200" ] && echo "PAGES LIVE: $URL" || echo "NOT LIVE YET (Pages can take a few minutes; re-check later)"

rm -f "$PAT_FILE"
echo "PAT file removed."
