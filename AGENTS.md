# Repository guidance

These instructions apply to the entire repository.

## Privacy boundary

- Treat `data/` as the only repository-local location for private deployment context,
  real names, email addresses, private hostnames or IPs, exact locations, guest data,
  database files, and notes about other private services.
- Treat `.env` as the only repository-local location for live credentials and secrets.
- `data/` and `.env*` are ignored by Git; `.env.example` is the only exception and
  must contain obvious placeholders only.
- Never force-add private files. Never copy private values into source code, tracked
  configuration, documentation, tests, fixtures, commit messages, issues, or pull
  requests.
- `booking.jc` is the approved public project name. Public UI copy should use the
  configurable Host display name rather than hard-coding a person's nickname.
- Before every commit, inspect `git diff --cached`, list ignored/private paths, and
  scan staged content for secrets, personal data, absolute paths, private network
  addresses, and unintended database artifacts.

## Project overview

booking.jc is a self-hosted private-group accommodation calendar. It uses the
Next.js App Router, TypeScript, React, Server Actions, and SQLite through
`better-sqlite3`. Runtime data is local and must never enter version control.

Important areas:

- `src/app/`: routes, Server Actions, UI components, and styles
- `src/app/admin/home-manager.tsx`: permanent-home and resource editing UI
- `src/lib/db.ts`: shared database connection, queries, and allocation data
- `src/lib/auth.ts`: signed admin and group sessions
- `src/lib/security.ts`: secret validation, rate limiting, and date validation
- `scripts/config.mjs`: shared runtime credential validation rules
- `scripts/database.mjs`: shared SQLite schema, migrations, and seed logic
- `scripts/init-db.mjs`: explicit idempotent database initialization
- `scripts/start.mjs`: production environment validation and server startup
- `docs/OPERATIONS.md`: deployment, verification, backup, and recovery

## Development workflow

1. Read the relevant bundled Next.js guide before changing framework code.
2. Keep secrets server-only and validate untrusted input at Server Action boundaries.
3. Preserve hotel-style date semantics: arrival is inclusive and departure is
   exclusive.
4. Keep capacity, blackout, exclusive-stay, and allocation checks transactional.
5. Do not expose pending guest names, notes, credentials, private addresses, or
   management tokens through public pages or query results.
6. Prefer focused changes that match the existing structure and visual language.

Required checks for code changes:

```bash
npm run lint
npm run build
```

There is currently no automated test suite. For behavior changes, also exercise the
affected public and admin workflows manually with disposable data.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
