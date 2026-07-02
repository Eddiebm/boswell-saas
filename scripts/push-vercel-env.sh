#!/usr/bin/env bash
# Push Boswell env vars to Vercel (run from repo root after .env.local exists)
set -euo pipefail

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy from .env.example and fill values"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

required=(DATABASE_URL AUTH_SECRET AUTH_URL WORKER_SECRET)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing $key in .env.local"
    exit 1
  fi
done

if [[ -z "${AUTH_GITHUB_ID:-}" || -z "${AUTH_GITHUB_SECRET:-}" ]]; then
  echo "Warning: AUTH_GITHUB_ID/SECRET empty — GitHub sign-in will not work until set."
fi

for env in production preview development; do
  for key in DATABASE_URL AUTH_SECRET AUTH_URL AUTH_GITHUB_ID AUTH_GITHUB_SECRET WORKER_SECRET OPENROUTER_API_KEY BOSWELL_ENGINE_GIT_URL; do
    val="${!key:-}"
    [[ -z "$val" ]] && continue
    printf '%s' "$val" | vercel env add "$key" "$env" --force
    echo "Set $key ($env)"
  done
done

echo "Redeploying production..."
vercel --prod --yes

echo "Done. Visit https://boswell-saas.vercel.app/dashboard/admin"
