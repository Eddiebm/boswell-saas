#!/usr/bin/env bash
# Push worker secrets to GitHub Actions (cloud audit processor).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

REPO="Eddiebm/boswell-saas"

set_secret() {
  local key="$1"
  local val="$2"
  if [[ -z "$val" ]]; then
    echo "Skip $key (empty)"
    return 0
  fi
  printf '%s' "$val" | gh secret set "$key" --repo "$REPO"
  echo "✓ $key"
}

echo "Setting GitHub Actions secrets on $REPO ..."
set_secret DATABASE_URL "${DATABASE_URL:-}"
set_secret OPENROUTER_API_KEY "${OPENROUTER_API_KEY:-}"
set_secret OPENROUTER_MODEL "${OPENROUTER_MODEL:-openrouter/auto}"
set_secret BOSWELL_ENGINE_GIT_URL "${BOSWELL_ENGINE_GIT_URL:-git+https://github.com/Eddiebm/boswell.git}"

echo ""
echo "Triggering worker workflow..."
gh workflow run audit-worker.yml --repo "$REPO"
echo "Done. Audits run in GitHub Actions every 2 minutes."
