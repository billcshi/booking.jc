#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

ensure_environment() {
  if [ -f .env ]; then
    return
  fi

  require_command openssl
  umask 077
  admin_password=$(openssl rand -base64 24 | tr -d '\n' | tr '/+' '_-')
  session_secret=$(openssl rand -hex 32)
  published_port=${HOST_PORT:-3000}

  case "$published_port" in
    *[!0-9]*|'')
      echo "HOST_PORT must be a number." >&2
      exit 1
      ;;
  esac

  {
    echo "DATABASE_PATH=./data/booking.db"
    echo "ADMIN_USERNAME=host"
    echo "ADMIN_PASSWORD=$admin_password"
    echo "SESSION_SECRET=$session_secret"
    echo "APP_TIME_ZONE=UTC"
    echo "HOST_PORT=$published_port"
    echo "INITIAL_HOME_NAME=Home"
    echo "INITIAL_HOME_LOCATION=Seattle"
    echo 'INITIAL_HOME_RESOURCES="Guest bed | 2 | normal; Sofa | 1 | sofa; Air mattress | 1 | hidden"'
  } > .env
  chmod 600 .env

  echo "Created private .env (mode 600). Save these credentials now:"
  echo "  Admin username: host"
  echo "  Admin password: $admin_password"
}
