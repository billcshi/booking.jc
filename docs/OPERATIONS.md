# booking.jc operations

This runbook covers a single-host Docker Compose deployment. Substitute values that
match your environment, but keep real hostnames, addresses, credentials, guest data,
and infrastructure notes out of tracked documentation.

## Initial deployment

From the repository root:

```bash
./scripts/deploy-docker.sh
```

This one-command path creates `.env` with mode `600` when absent, generates and prints
the initial credentials, builds the image, initializes the database, starts Compose,
and waits for a healthy container. Existing configuration and data are preserved.
Set `HOST_PORT` before the first run to choose a different published port.

The equivalent manual flow is:

```bash
cp .env.example .env
# Replace every placeholder and optionally set HOST_PORT and APP_TIME_ZONE.
docker compose build
docker compose run --rm booking-jc npm run db:init -- --interactive
docker compose up -d
docker compose ps
```

The service listens on port `3000` inside the container. Compose publishes the value
of `HOST_PORT`, which defaults to `3000`, and bind-mounts `./data` at `/app/data`.

For a bare Node.js deployment, run `./scripts/deploy-server.sh` under a process manager.
It installs locked dependencies, initializes the database, builds, and then runs the
server in the foreground. Configure a reverse proxy for HTTPS.

## Configuration

Set these values in `.env`:

- `DATABASE_PATH`: database location; the Compose file sets the container path
- `ADMIN_USERNAME`: host-console login name
- `ADMIN_PASSWORD`: strong password of at least 16 characters
- `SESSION_SECRET`: random signing secret of at least 32 characters
- `APP_TIME_ZONE`: IANA time-zone name used by the admin date view
- `HOST_PORT`: port published on the Docker host

Startup rejects missing, weak, or known placeholder credentials. Initialization
generates a random shared group key for a fresh database and prints it once; save it
securely. The active key is stored in SQLite and can be rotated from the host console.
Rotation invalidates existing group-access sessions but not host sessions.

`npm run db:init` is idempotent: it creates the SQLite file and parent directory,
applies the current schema and migrations, and seeds defaults only when no permanent
home exists.
Normal application startup runs the same shared initializer as a fallback.

Pass `--interactive` on a fresh database to choose the permanent-home name, location
label, and resources. Each resource uses `name | capacity | flags`; separate resources
with semicolons. Flags are `normal`, `sofa`, and `hidden`. The same initial values may
be supplied through `INITIAL_HOME_NAME`, `INITIAL_HOME_LOCATION`, and
`INITIAL_HOME_RESOURCES` in `.env` only when they are non-sensitive defaults. Enter
exact locations and private room details interactively so they are written only to the
ignored SQLite database. Once a permanent home exists, change it from the Admin
console; rerunning initialization never overwrites it.

Keep `.env`, `data/`, `backups/`, database copies, and any private deployment notes
outside Git. Do not place secrets in Compose YAML, Docker build arguments, tracked
shell scripts, screenshots, issues, or logs.

## Routine verification

```bash
npm run lint
npm run build
docker compose ps
curl -fsS "http://127.0.0.1:${HOST_PORT:-3000}/" >/dev/null
```

The Compose status should become `healthy`. An unauthenticated request to `/admin`
should redirect to `/admin/login`. Also verify that a group key unlocks the calendar,
that a disposable request can be approved, and that its private management link works.

## Consistent backup

SQLite is the source of truth. Use the SQLite backup API while the service is running:

```bash
mkdir -p backups
docker compose exec -T booking-jc node -e "const D=require('better-sqlite3');const s=new D('/app/data/booking.db');s.backup('/app/data/booking.backup.db').then(()=>s.close())"
cp data/booking.backup.db "backups/booking-$(date -u +%Y%m%dT%H%M%SZ).db"
```

Store backups encrypted and separately from the application host. After verifying the
copied backup, remove the temporary `data/booking.backup.db` manually if desired.

## Restore

Restoration replaces active data. Stop the service first and preserve the current
database:

```bash
docker compose down
mkdir -p backups
cp data/booking.db "backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).db"
cp backups/CHOSEN-BACKUP.db data/booking.db
docker compose up -d
docker compose ps
```

Do not restore while the container is writing to SQLite. After startup, repeat the
routine verification and confirm recent records in the host console.

## Upgrade

1. Create and verify a database backup.
2. Fetch or check out the intended code revision.
3. Run `npm ci`, `npm run lint`, and `npm run build`.
4. Build the new image with `docker compose build`.
5. Apply migrations with `docker compose run --rm booking-jc npm run db:init`.
6. Run `docker compose up -d`.
7. Wait for `healthy`, then smoke-test `/`, `/admin`, and one disposable request.
8. Retain the pre-upgrade backup until the new version has been exercised.

Database changes currently use additive startup migrations. Review future migrations
before deployment and never assume a code rollback can reverse a data migration.

## Rollback

1. Stop the service.
2. Check out the last known-good code revision.
3. Restore the matching pre-upgrade database if the failed revision changed data or
   schema in a backward-incompatible way.
4. Rebuild and start Compose.
5. Repeat the routine verification.

## Incident response

If a credential or private management link is exposed:

1. Remove public access to the affected material.
2. Rotate the exposed admin password, group or invitation key, and session secret as
   applicable.
3. Restart the service after changing environment secrets; changing `SESSION_SECRET`
   invalidates all signed sessions.
4. Review logs and database records for unexpected access or changes.
5. If the value entered Git history, rewrite the history before publication and treat
   the original value as compromised even after deletion.
