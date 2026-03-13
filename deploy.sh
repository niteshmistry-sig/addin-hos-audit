#!/usr/bin/env bash
# deploy.sh — Build, push, and deploy HOS Log Edit Audit add-in
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Building ==="
python3 build_hla.py

echo ""
echo "=== Git push ==="
git add -A
git commit -m "Build: update docs/ output" || echo "Nothing to commit"
git push origin main

echo ""
echo "=== Waiting for GitHub Pages (20s) ==="
sleep 20

echo ""
echo "=== Deploying to MyGeotab ==="
npx -y @geotab/cli-mygeotab addin deploy --config docs/config.json

echo ""
echo "=== Done ==="
