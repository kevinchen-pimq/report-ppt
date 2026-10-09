#!/usr/bin/env bash
# Deploys the XR Arcade overview page (arcade/) to Cloudflare Pages (project: xr-arcade).
set -euo pipefail
cd "$(dirname "$0")/../arcade"   # run from arcade/ so the game's functions/ isn't picked up
npx wrangler pages deploy . \
  --project-name="${PAGES_PROJECT:-xr-arcade}" \
  --branch=main \
  --commit-hash="$(git rev-parse HEAD)" \
  --commit-message="$(git log -1 --pretty=%s)" \
  --commit-dirty=true
