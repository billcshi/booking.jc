#!/bin/sh

set -eu
. "$(dirname -- "$0")/deploy-common.sh"

require_command docker
ensure_environment

# Match the bind-mounted SQLite directory to the invoking host user.
mkdir -p data
BOOKING_UID=$(id -u)
BOOKING_GID=$(id -g)
export BOOKING_UID BOOKING_GID

docker compose version >/dev/null
docker compose build
docker compose run --rm booking-jc npm run db:init
docker compose up -d

container_id=$(docker compose ps -q booking-jc)
if [ -z "$container_id" ]; then
  echo "booking-jc container was not created." >&2
  exit 1
fi

attempt=0
while [ "$attempt" -lt 45 ]; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  if [ "$health" = "healthy" ]; then
    docker compose ps
    echo "booking.jc is ready on host port ${HOST_PORT:-$(sed -n 's/^HOST_PORT=//p' .env)}."
    exit 0
  fi
  if [ "$health" = "unhealthy" ] || [ "$health" = "exited" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose ps >&2
docker compose logs --tail=80 booking-jc >&2
echo "booking.jc did not become healthy." >&2
exit 1
