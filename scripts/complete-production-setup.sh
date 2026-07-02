#!/usr/bin/env bash
# Finish Boswell production setup: validate .env.local, push to Vercel, print Render steps.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "Copy .env.example → .env.local first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

echo "=== Boswell production env check ==="
missing=()
for key in DATABASE_URL AUTH_SECRET AUTH_URL WORKER_SECRET; do
  if [[ -z "${!key:-}" ]]; then missing+=("$key"); fi
done
for key in AUTH_GITHUB_ID AUTH_GITHUB_SECRET OPENROUTER_API_KEY; do
  if [[ -z "${!key:-}" ]]; then
    echo "  ✗ $key (required for live sign-in / audits / brain)"
    missing+=("$key")
  else
    echo "  ✓ $key"
  fi
done

if ((${#missing[@]} > 0)); then
  echo ""
  echo "Still missing: ${missing[*]}"
  echo ""
  echo "GitHub OAuth app (one-time):"
  echo "  https://github.com/settings/applications/new"
  echo "  Name:        Boswell SaaS"
  echo "  Homepage:    https://boswell-saas.vercel.app"
  echo "  Callback:    https://boswell-saas.vercel.app/api/auth/callback/github"
  echo "  Then add AUTH_GITHUB_ID and AUTH_GITHUB_SECRET to .env.local"
  echo ""
  echo "OpenRouter key: https://openrouter.ai/keys → OPENROUTER_API_KEY in .env.local"
  exit 1
fi

echo ""
echo "Pushing env to Vercel..."
./scripts/push-vercel-env.sh

echo ""
echo "=== Render worker (audits) ==="
echo "1. https://dashboard.render.com → New → Blueprint"
echo "2. Connect github.com/Eddiebm/boswell-saas"
echo "3. Set on boswell-audit-worker:"
echo "     DATABASE_URL      (same as Vercel)"
echo "     WORKER_SECRET     (same as Vercel)"
echo "     OPENROUTER_API_KEY"
echo ""
echo "Verify: https://boswell-saas.vercel.app/dashboard/admin"
