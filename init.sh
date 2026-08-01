#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_root"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22 and npm are required." >&2
  exit 1
fi

mode=${1:-}
if [ -n "$mode" ] && [ "$mode" != "--non-interactive" ]; then
  echo "Usage: ./init.sh [--non-interactive]" >&2
  exit 1
fi

node scripts/init-environment.mjs
npm ci

if [ "$mode" = "--non-interactive" ] || [ ! -t 0 ]; then
  npm run db:init
else
  npm run db:init -- --interactive
fi

echo "booking.jc initialization complete. Run 'npm run dev' or './scripts/deploy-docker.sh'."
