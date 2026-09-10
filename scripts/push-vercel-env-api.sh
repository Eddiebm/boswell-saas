#!/usr/bin/env bash
# Push env vars to Vercel via REST API (when vercel link/token is flaky).
set -euo pipefail

cd "$(dirname "$0")/.."

AUTH_FILE="${HOME}/Library/Application Support/com.vercel.cli/auth.json"
PROJECT_ID="prj_SOwP5saiF2YFESAd0CjLWzqgfJ0Z"
TEAM_ID="team_xEdbPPlzZmOVGOxap6gPbbW2"

target="${1:-}"
if [[ ! "$target" =~ ^(production|preview|development)$ ]]; then
  echo "Usage: $0 production|preview|development [env-file]"
  exit 1
fi

env_file="${2:-.env.${target}.local}"
if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file — each deployment target requires separate credentials"
  exit 1
fi

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "Run: vercel login"
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['token'])")

set -a
# shellcheck disable=SC1091
source "$env_file"
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

for key in DATABASE_URL AUTH_SECRET AUTH_URL AUTH_GITHUB_ID AUTH_GITHUB_SECRET WORKER_SECRET OPENROUTER_API_KEY OPENROUTER_MODEL BOSWELL_ENGINE_GIT_URL GITHUB_WORKFLOW_TOKEN ADMIN_ALERT_EMAIL RESEND_API_KEY ALERT_FROM_EMAIL; do
  upsert_env "$key" "${!key:-}" "$target"
done

echo "Redeploying..."
if [[ "$target" == "production" ]]; then
  cd "$(dirname "$0")/.." && vercel --prod --yes 2>/dev/null || echo "Redeploy manually: vercel --prod"
fi

echo "Done."
