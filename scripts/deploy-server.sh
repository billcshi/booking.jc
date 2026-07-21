#!/bin/sh

set -eu
. "$(dirname -- "$0")/deploy-common.sh"

require_command node
require_command npm
ensure_environment

npm ci
npm run db:init
npm run build

echo "booking.jc is starting in the foreground on port ${PORT:-3000}."
echo "Use systemd, Supervisor, or your hosting platform to keep this command running."
exec node --env-file-if-exists=.env scripts/start.mjs
