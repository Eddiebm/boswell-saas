#!/usr/bin/env bash
# Zero-touch production finish: bootstrap GitHub token, push env, sign in owner.
set -euo pipefail

cd "$(dirname "$0")/.."

AUTH_FILE="${HOME}/Library/Application Support/com.vercel.cli/auth.json"
PROJECT_ID="prj_SOwP5saiF2YFESAd0CjLWzqgfJ0Z"
TEAM_ID="team_xEdbPPlzZmOVGOxap6gPbbW2"
PROD_URL="${AUTH_URL:-https://boswell-saas.vercel.app}"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local"
  exit 1
fi

echo "=== 1. Bootstrap GitHub token from gh CLI ==="
GH_TOKEN=$(gh auth token)
python3 <<PY
import re
from pathlib import Path
p = Path(".env.local")
text = p.read_text()
token = """$GH_TOKEN"""
if re.search(r'^GITHUB_BOOTSTRAP_TOKEN=', text, re.M):
    text = re.sub(r'^GITHUB_BOOTSTRAP_TOKEN=.*$', f'GITHUB_BOOTSTRAP_TOKEN={token}', text, flags=re.M)
else:
    text += f'\nGITHUB_BOOTSTRAP_TOKEN={token}\n'
p.write_text(text)
print("GITHUB_BOOTSTRAP_TOKEN written to .env.local")
PY

set -a
# shellcheck disable=SC1091
source .env.local
set +a

echo "=== 2. Push env to Vercel ==="
if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Vercel not logged in. Run: vercel login"
  exit 1
fi

VERCEL_TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['token'])")

upsert_env() {
  local key="$1" value="$2" target="$3"
  [[ -z "$value" ]] && return 0
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'key':sys.argv[1],'value':sys.argv[2],'type':'encrypted','target':[sys.argv[3]]}))" "$key" "$value" "$target")
  curl -sf -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true" \
    -d "$payload"
  echo "  ✓ $key ($target)"
}

for target in production preview development; do
  for key in DATABASE_URL AUTH_SECRET AUTH_URL WORKER_SECRET OPENROUTER_API_KEY OPENROUTER_MODEL BOSWELL_ENGINE_GIT_URL GITHUB_BOOTSTRAP_TOKEN AUTH_GITHUB_ID AUTH_GITHUB_SECRET; do
    upsert_env "$key" "${!key:-}" "$target" || true
  done
done

echo "=== 3. Redeploy ==="
git add -A && git diff --cached --quiet || git commit -m "Production bootstrap: owner auth and worker fix" || true
git push origin main 2>/dev/null || true
vercel --prod --yes --scope eddiebms-projects 2>/dev/null || echo "(redeploy via git push if vercel CLI unavailable)"

echo "=== 4. Owner sign-in ==="
sleep 15
curl -sf -L -o /dev/null -w "%{http_code}" \
  -H "x-worker-secret: $WORKER_SECRET" \
  "${PROD_URL}/api/setup/owner" || echo "Bootstrap will work after deploy completes"

echo ""
echo "=== 5. Deploy cloud worker (GitHub Actions) ==="
chmod +x scripts/deploy-cloud-worker.sh
./scripts/deploy-cloud-worker.sh

echo ""
echo "=== 6. Stop local worker if running ==="
pkill -f "tsx scripts/worker.ts" 2>/dev/null && echo "Stopped local worker" || echo "No local worker running"

echo ""
echo "Done. Sign in at ${PROD_URL}/login → Continue as owner"
