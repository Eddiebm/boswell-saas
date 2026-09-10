#!/usr/bin/env bash
# Push one Boswell environment to Vercel.
set -euo pipefail

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

set -a
# shellcheck disable=SC1091
source "$env_file"
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

for key in DATABASE_URL AUTH_SECRET AUTH_URL AUTH_GITHUB_ID AUTH_GITHUB_SECRET WORKER_SECRET OPENROUTER_API_KEY BOSWELL_ENGINE_GIT_URL GITHUB_WORKFLOW_TOKEN; do
  val="${!key:-}"
  [[ -z "$val" ]] && continue
  printf '%s' "$val" | vercel env add "$key" "$target" --force
  echo "Set $key ($target)"
done

if [[ "$target" == "production" ]]; then
  echo "Redeploying production..."
  vercel --prod --yes
fi

echo "Done. Visit https://boswell-saas.vercel.app/dashboard/admin"
