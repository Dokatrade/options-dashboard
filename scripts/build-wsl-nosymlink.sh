#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/LetsProgram/python-vscode/TEST_PROJECTS/options-dashboard
# кэш в Linux-доме, чтобы не писать на D:
npm config set cache "$HOME/.npm" >/dev/null
# мягкая установка (без удаления node_modules)
npm install --include=optional --no-audit --no-fund
npm rebuild esbuild --force || true
npm i -D @rollup/rollup-linux-x64-gnu@latest || true
npm run build
