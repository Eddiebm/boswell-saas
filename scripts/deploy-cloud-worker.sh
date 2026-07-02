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

echo "Setting GitHub Actions secrets on $REPO ..."
gh api "repos/${REPO}/actions/secrets/public-key" > /tmp/gh-pk.json
node scripts/set-gh-secrets.mjs /tmp/gh-pk.json
echo "Done. Audits run in GitHub Actions every 2 minutes."
