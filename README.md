# booking.jc

English | [简体中文](README-ZH.md)

## TL;DR

Docker (requires Git, Docker Compose, and OpenSSL):

```bash
git clone https://github.com/billcshi/booking.jc.git booking.jc && cd booking.jc && ./scripts/deploy-docker.sh
```

Bare Node.js server (requires Git, Node.js 22, npm, and OpenSSL):

```bash
git clone https://github.com/billcshi/booking.jc.git booking.jc && cd booking.jc && ./scripts/deploy-server.sh
```

On the first run, either command creates a private `.env`, prints the generated Admin
password, initializes SQLite, and prints the random group key. Save both values when
they appear. Docker runs in the background; the bare-server command remains in the
foreground so a service manager can supervise it. Existing `.env` and database files
are preserved.

booking.jc is a self-hosted accommodation calendar for a private group. Friends can
check availability and request a stay without creating an account, while the host
retains control over approvals, sleeping-space allocation, blackout dates, and trip
accommodation.

The public host name defaults to `Host` and can be customized from the permanent-home
panel. The repository contains no real identity, guest records, production credentials,
private network details, or exact home location.

## Features

- Mobile-first monthly availability and occupancy calendar
- Chinese and English UI with a persistent language switcher across guest and Admin pages
- Shared group key and optional guest-specific invitation keys
- Request approval, rejection, cancellation, editing, and historical backfill
- Private self-service links for guests to view or cancel requests
- Host audit log, conflict previews, and a Trash workflow with capacity-safe restore and confirmed permanent deletion
- Revocable private calendar feed, sanitized CSV/JSON exports, and an Admin-only health endpoint
- Capacity-aware sleeping-space allocation across an entire date range
- Admin controls to preserve, manually adjust, or automatically recalculate allocations
- Optional sofa and hidden overflow capacity for the permanent home stay
- Exclusive stays that prevent overlapping bookings at the same place
- Temporary trip stays with editable dates, locations, rooms, and beds
- Host blackout periods and optional automatic home blackouts during trips
- Interactive first-run home and sleeping-resource configuration
- Admin editing for the host name, home location, capacities, visibility, and allocation order
- Private, versioned Agent API for pending review, approval, rejection, and atomic adjustment-and-approval
- 30-day, privacy-minimized idempotency and audit records identifying Agent actions
- Defense-in-depth Agent API rate limits, with mandatory trusted-network restriction for public deployments
- SQLite persistence with Docker Compose deployment support

Pending guest names, internal notes, credentials, exact addresses, and management
tokens are not shown on the public calendar.

## Technology

- Next.js 16 App Router and React 19
- TypeScript
- SQLite via `better-sqlite3`
- Route-level stylesheets
- Docker and Docker Compose

## Quick start

Requirements: Node.js 22 or a compatible current Node.js release, npm, and build
tools supported by `better-sqlite3`.

On macOS or Linux:

```bash
./init.sh
npm run dev
```

On Windows Command Prompt:

```bat
init.bat
npm run dev
```

The initializer creates the ignored `.env` with random Admin, session, and Agent
credentials, installs locked dependencies with `npm ci`, creates or migrates SQLite,
and interactively configures a new permanent home. Secret values are stored in `.env`;
the Agent Token is never printed. Existing `.env`, keys, settings, and bookings are
preserved. Use `./init.sh --non-interactive` or `init.bat --non-interactive` in
automation.

The equivalent manual flow is:

```bash
cp .env.example .env
# Replace every placeholder in .env.
npm ci
npm run db:init -- --interactive
npm run dev
```

The optional interactive initializer asks for the permanent home name, location label,
and sleeping resources. Resource entries use `name | capacity | flags`, separated by
semicolons. Supported flags are `normal`, `sofa` (requires guest consent), and `hidden`
(excluded from public capacity and used only with guest opt-in plus host approval).
Private answers are written only to the ignored SQLite database.

`db:init` creates the configured SQLite file, applies all schema migrations, generates
a random shared group key for a fresh database, and seeds the home only when it does
not exist. Save the generated key printed by the initializer. Repeated runs do not
replace the key, settings, or bookings. On an existing database, edit the host name and
home resources from the Admin console. The application also initializes the database
on first use as a fallback.

Development is available at `http://localhost:3000` by default; the host console is
at `http://localhost:3000/admin`.

## Configuration

| Variable | Purpose | Requirement |
| --- | --- | --- |
| `DATABASE_PATH` | SQLite database path | Keep it in an ignored, persistent directory |
| `ADMIN_USERNAME` | Host-console login name | At least 2 characters; do not use `admin` |
| `ADMIN_PASSWORD` | Host-console password | At least 16 characters |
| `AGENT_TOKEN` | Independent Agent Token for the trusted AI Agent Admin API | At least 32 random characters; server-only |
| `SESSION_SECRET` | HMAC key for signed sessions | At least 32 random characters |
| `APP_TIME_ZONE` | Time zone used for the admin calendar's current date | IANA zone such as `UTC` |
| `HOST_PORT` | Host port published by Docker Compose | Defaults to `3000` |
| `TRUST_PROXY` | Trust proxy-provided client IP headers for rate limiting | Set to `1` only behind a proxy that removes and rewrites incoming forwarding headers |
| `INITIAL_HOME_NAME` | Initial permanent-stay display name | Non-sensitive labels only |
| `INITIAL_HOME_LOCATION` | Initial location label | Non-sensitive labels only; defaults to `Seattle` |
| `INITIAL_HOME_RESOURCES` | Semicolon-separated initial resource specification | Non-sensitive defaults using `name \| capacity \| flags` |

Generate a session secret with a local cryptographic tool, for example:

```bash
openssl rand -hex 32
```

Generate `AGENT_TOKEN` the same way, but keep it independent from every login,
session, group, invitation, and booking-management credential. See
[docs/ADMIN_API.md](docs/ADMIN_API.md) for the private Agent API contract, token
rotation, curl examples, response fields, and error codes. Give
[docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) to the AI Agent as its operational API
instructions.

Never commit `.env`, databases, backups, guest exports, or private deployment notes.
The repository intentionally ignores `data/` and `backups/` for this reason.
Keep real or private home names, exact locations, and private room details out of
`.env`; enter them through the interactive initializer so they are stored only in the
ignored SQLite database.

## Commands

```bash
npm run dev      # start the development server
./init.sh         # initialize .env, dependencies, and SQLite on macOS/Linux
init.bat          # initialize .env, dependencies, and SQLite on Windows
npm run db:init  # create or migrate the configured SQLite database
npm run db:init -- --interactive  # configure a fresh home interactively
npm run deploy:docker  # build, initialize, and start with Docker Compose
npm run deploy:server  # install, initialize, build, and start a bare Node server
npm run lint     # run ESLint
npm test         # run database and booking transaction tests
npm run build    # create a production build
npm start        # validate production variables and start Next.js
```

The automated suite covers schema upgrades and critical booking-change transaction
behavior, including Agent API authentication, idempotency, validation, conflicts, and
secret non-disclosure. Run tests, lint, and build checks before every change, then manually verify
affected public and host workflows using disposable data.

## Docker deployment

The one-command path creates secure local credentials when `.env` is absent, builds
the image, initializes the database, starts Compose, and waits for a healthy container:

```bash
./scripts/deploy-docker.sh
```

Choose another published port on the first run with, for example,
`HOST_PORT=8080 ./scripts/deploy-docker.sh`. For manual deployment or preconfigured
credentials, use:

```bash
cp .env.example .env
# Edit .env and replace every placeholder.
docker compose build
docker compose run --rm booking-jc npm run db:init -- --interactive
docker compose up -d
docker compose ps
```

Compose stores SQLite under `./data`, runs with the invoking user's UID/GID when using
the deployment script, and publishes `${HOST_PORT:-3000}` on the host.
See [docs/OPERATIONS.md](docs/OPERATIONS.md) for health checks, backup, restore,
upgrade, and rollback procedures.

## Bare-server deployment

Run the production server without Docker:

```bash
./scripts/deploy-server.sh
```

The script creates `.env` if needed, runs `npm ci`, initializes SQLite, builds the
application, and starts it in the foreground on `${PORT:-3000}`. Put this command
behind systemd, Supervisor, or your hosting platform's process manager, and terminate
TLS at a reverse proxy. To customize private home details, stop after initialization,
run `npm run db:init -- --interactive` on a fresh database, or edit them later in Admin.

## Booking model

Dates follow hotel semantics: the arrival date is occupied and the departure date is
not. A request from July 10 to July 12 therefore occupies the nights of July 10 and
July 11.

Approved bookings are assigned to sleeping resources in priority order across their
full date range. Sofa or hidden overflow capacity is considered only when explicitly
allowed. An exclusive booking locks the whole stay even when the party uses less than
its physical capacity.

Public requests are limited to 90 nights. The host console accepts historical records
up to ten years per entry. Past dates are hidden from the default public view and can
be revealed from the calendar.

## Main workflows

1. A group member opens the calendar and enters a shared or personal invitation key.
2. They choose arrival and departure dates, then submit a nickname, party size, and
   sleeping-space preferences.
3. The host reviews the pending request in `/admin` and approves, rejects, or edits it.
4. Approval reruns capacity, blackout, exclusive-stay, and allocation checks in a
   transaction.
5. The guest keeps the private management link to check status or cancel later.

Deleting a stay record from the host console first moves it to Trash and immediately
releases its sleeping-space allocation. Restoring an approved record reruns blackout,
exclusive-stay, and capacity checks. A trashed record can also be permanently deleted
after an explicit confirmation; permanent deletion cannot be undone and cascades to
its allocations and change requests.

For a trip, the host creates a temporary stay and enters one resource per line as
`name | capacity`. Line order controls allocation priority. The host may also mark the
permanent home unavailable for the trip dates.

When editing an approved request, the host can preserve its current sleeping-space
assignment, distribute the party manually, or ask the allocator to recalculate it.
Manual assignments must add up to the party size and still pass consent, capacity,
date-overlap, and exclusive-stay checks.

## Architecture

```text
src/app/                 App Router pages, Server Actions, components, and styles
src/lib/db.ts            Application queries and the shared database connection
src/lib/auth.ts          Signed admin and group-access cookies
src/lib/security.ts      Environment validation, rate limiting, and date checks
scripts/admin-booking-service.mjs  Shared booking approval/edit domain service
scripts/admin-api-handler.mjs      Agent authentication and JSON HTTP adapter
scripts/init-environment.mjs       Cross-platform private environment initializer
scripts/database.mjs     Shared SQLite schema, migrations, and seed logic
scripts/init-db.mjs      Explicit, idempotent database initializer
scripts/start.mjs        Production environment guard and server launcher
init.sh / init.bat       Local initialization entry points
docs/OPERATIONS.md       Deployment and data-recovery runbook
docs/ADMIN_API.md        Private AI Agent API contract and examples
docs/AGENT_GUIDE.md      Operational instructions supplied to the AI Agent
```

Schema upgrades are additive and run through both `db:init` and normal application
startup. A fresh database receives one generic permanent stay and its default sleeping
resources; customize those records in the host console.

The Admin console's permanent-home editor also controls the public host display name.
It preserves resource identities while reordering or renaming them. Resources with
allocation history cannot be removed, and their capacity cannot be reduced below peak
allocated seats.

## Privacy and security

- The public schedule exposes approved nicknames only after group-key access.
- Request-management URLs contain bearer tokens and should be handled as secrets.
- Admin and group sessions are signed, HTTP-only, same-site cookies.
- Login and group-key attempts are rate-limited in process memory.
- Agent API requests have separate authenticated and unauthenticated in-process limits;
  public deployments must also restrict `/api/admin/v1/` at the proxy or firewall.
- The request-detail route disables caching, referrers, and indexing.
- Audit entries exclude guest names, messages, keys, passwords, and management tokens.
- Calendar feeds are private bearer URLs that the host can rotate to revoke.
- This is a small self-hosted application, not a hardened multi-tenant platform.
  Deploy it behind HTTPS, restrict administrative access, keep dependencies updated,
  and back up SQLite securely.

Please report security issues privately to the repository owner rather than opening a
public issue containing credentials, guest details, or deployment information.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Keep private identity and deployment
context out of tracked files, read the bundled Next.js documentation before framework
changes, and run `npm run lint` plus `npm run build` before submitting a pull request.

## License

Distributed under the MIT License. See [LICENSE](LICENSE).
