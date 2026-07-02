#!/usr/bin/env bash
# Push env vars to Vercel via REST API (when vercel link/token is flaky).
set -euo pipefail

cd "$(dirname "$0")/.."

AUTH_FILE="${HOME}/Library/Application Support/com.vercel.cli/auth.json"
PROJECT_ID="prj_SOwP5saiF2YFESAd0CjLWzqgfJ0Z"
TEAM_ID="team_xEdbPPlzZmOVGOxap6gPbbW2"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local"
  exit 1
fi

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Run: vercel login"
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['token'])")

set -a
# shellcheck disable=SC1091
source .env.local
set +a

upsert_env() {
  local key="$1"
  local value="$2"
  local target="$3"
  [[ -z "$value" ]] && return 0

  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'key':sys.argv[1],'value':sys.argv[2],'type':'encrypted','target':[sys.argv[3]]}))" "$key" "$value" "$target")

  curl -sf -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true" \
    -d "$payload" >/dev/null

  echo "Set $key ($target)"
}

for target in production preview development; do
  for key in DATABASE_URL AUTH_SECRET AUTH_URL AUTH_GITHUB_ID AUTH_GITHUB_SECRET WORKER_SECRET OPENROUTER_API_KEY OPENROUTER_MODEL BOSWELL_ENGINE_GIT_URL; do
    upsert_env "$key" "${!key:-}" "$target"
  done
done

echo "Redeploying..."
cd "$(dirname "$0")/.." && vercel --prod --yes 2>/dev/null || echo "Redeploy manually: vercel --prod"

echo "Done."
