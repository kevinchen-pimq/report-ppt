#!/usr/bin/env bash
# Deploys the relay (Cloudflare Pages project bs-remote, R2 bucket bs-remote) with the agent script
# as a public download, and uploads the mod source zip for the agent's mod_build command.
# Needs: wrangler logged in; BSR_TOKEN or BSR_TOKEN_FILE for the blob upload.
set -euo pipefail
cd "$(dirname "$0")"
OUT="$(mktemp -d)"
cp -r relay/public/. "$OUT"/
cp agent/bsr_agent.py "$OUT"/
( cd relay && npx wrangler pages deploy "$OUT" --project-name bs-remote --branch main --commit-dirty=true )
ZIP="$(mktemp -d)/bsremote-src.zip"
( cd mod && zip -q -r "$ZIP" BSRemote.csproj manifest.json ./*.cs )
python3 bsr.py blob bsremote-src.zip "$ZIP"
rm -rf "$OUT"
