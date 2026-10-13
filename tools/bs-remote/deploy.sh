#!/usr/bin/env bash
# Deploys the relay (Cloudflare Pages project bs-remote, R2 bucket bs-remote) with the agent script
# as a public download, and uploads it as a blob for the agent's agent_update command.
# Needs: wrangler logged in; BSR_TOKEN or BSR_TOKEN_FILE for the blob upload.
set -euo pipefail
cd "$(dirname "$0")"
OUT="$(mktemp -d)"
cp -r relay/public/. "$OUT"/
cp agent/bsr_agent.py "$OUT"/
( cd relay && npx wrangler pages deploy "$OUT" --project-name bs-remote --branch main --commit-dirty=true )
python3 bsr.py blob bsr_agent.py agent/bsr_agent.py
rm -rf "$OUT"
