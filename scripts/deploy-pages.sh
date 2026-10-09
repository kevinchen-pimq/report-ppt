#!/usr/bin/env bash
# Deploys the site to Cloudflare Pages (project: webxr-saber).
# First time on a machine: npx wrangler login   (add --device in containers / SSH)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)"
cp -r index.html css js vendor _headers "$OUT"/
npx wrangler pages deploy "$OUT" \
  --project-name="${PAGES_PROJECT:-webxr-saber}" \
  --branch="${PAGES_BRANCH:-main}" \
  --commit-hash="$(git rev-parse HEAD)" \
  --commit-message="$(git log -1 --pretty=%s)" \
  --commit-dirty=true
rm -rf "$OUT"
