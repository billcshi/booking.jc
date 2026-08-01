import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const defaultHomeConfiguration = {
  name: "固定住所",
  location: "Seattle",
  resources: [
    { name: "Guest king bed", capacity: 2, adminOnly: false, requiresSofaConsent: false },
    { name: "Living room sofa", capacity: 1, adminOnly: false, requiresSofaConsent: true },
    { name: "Air mattress", capacity: 1, adminOnly: true, requiresSofaConsent: false },
  ],
};

export function generateGroupKey() {
  return `group-${randomBytes(12).toString("base64url")}`;
}

export function parseHomeResources(value) {
  const lines = value
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  const resources = lines.map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3) {
      throw new Error("Home resources must use: name | capacity | normal, sofa, or hidden");
    }
    const [rawName, rawCapacity, rawFlags = "normal"] = parts;
    const capacity = Number(rawCapacity);
    const flags = (rawFlags || "normal")
      .toLowerCase()
      .split(/[,+\s]+/)
      .filter(Boolean);
    if (
      !rawName ||
      rawName.length > 100 ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 8 ||
      flags.some((flag) => !["normal", "sofa", "hidden"].includes(flag))
    ) {
      throw new Error("Home resources must use: name | capacity | normal, sofa, or hidden");
    }
    return {
      name: rawName,
      capacity,
      adminOnly: flags.includes("hidden"),
      requiresSofaConsent: flags.includes("sofa"),
    };
  });
  if (!resources.length || !resources.some((resource) => !resource.adminOnly)) {
    throw new Error("At least one public home resource is required");
  }
  return resources;
}

export function homeConfigurationFromEnvironment(environment = process.env) {
  return {
    name: (environment.INITIAL_HOME_NAME ?? defaultHomeConfiguration.name).trim(),
    location: (environment.INITIAL_HOME_LOCATION ?? defaultHomeConfiguration.location).trim(),
    resources: environment.INITIAL_HOME_RESOURCES
      ? parseHomeResources(environment.INITIAL_HOME_RESOURCES)
      : defaultHomeConfiguration.resources,
  };
}

export function databasePathFromEnvironment(value = process.env.DATABASE_PATH) {
  return value ?? path.join(process.cwd(), "data", "booking.db");
}

export function databaseHasPermanentHome(databasePath) {
  if (databasePath === ":memory:" || !fs.existsSync(databasePath)) return false;
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasStaysTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stays'")
      .get();
    return Boolean(
      hasStaysTable &&
        db.prepare("SELECT 1 FROM stays WHERE starts_on IS NULL AND ends_on IS NULL LIMIT 1").get(),
    );
  } finally {
    db.close();
  }
}

export function databaseHasGroupKey(databasePath) {
  if (databasePath === ":memory:" || !fs.existsSync(databasePath)) return false;
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasSettingsTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'")
      .get();
    return Boolean(
      hasSettingsTable && db.prepare("SELECT 1 FROM settings WHERE key='group_key'").get(),
    );
  } finally {
    db.close();
  }
}

export function initializeDatabase({
  databasePath = databasePathFromEnvironment(),
  requestKey = generateGroupKey(),
  home = homeConfigurationFromEnvironment(),
} = {}) {
  if (!home.name || home.name.length > 100 || !home.location || home.location.length > 120) {
    throw new Error("Initial home name and location are required");
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS stays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        starts_on TEXT,
        ends_on TEXT,
        is_public INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS resources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK(capacity > 0),
        priority INTEGER NOT NULL DEFAULT 10,
        admin_only INTEGER NOT NULL DEFAULT 0,
        requires_sofa_consent INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
        guest_name TEXT NOT NULL,
        contact TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        party_size INTEGER NOT NULL CHECK(party_size > 0),
        accepts_sofa INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        host_note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
        manage_token TEXT NOT NULL UNIQUE,
        submission_key TEXT UNIQUE,
        rejection_reason TEXT NOT NULL DEFAULT '',
        deleted_at TEXT,
        tracking_last_accessed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        seats INTEGER NOT NULL CHECK(seats > 0)
      );
      CREATE TABLE IF NOT EXISTS request_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        guest_name TEXT NOT NULL,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        party_size INTEGER NOT NULL CHECK(party_size > 0),
        accepts_sofa INTEGER NOT NULL DEFAULT 0,
        accepts_air_mattress INTEGER NOT NULL DEFAULT 0,
        exclusive INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request_change
        ON request_changes(request_id) WHERE status='pending';
      CREATE TABLE IF NOT EXISTS blackouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'Host unavailable',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invite_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        summary TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT 'web-admin',
        before_summary TEXT NOT NULL DEFAULT '',
        after_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS admin_api_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS admin_api_idempotency_created_at
        ON admin_api_idempotency(created_at);
    `);

    const requestColumns = db.prepare("PRAGMA table_info(requests)").all();
    if (!requestColumns.some((column) => column.name === "exclusive")) {
      db.exec("ALTER TABLE requests ADD COLUMN exclusive INTEGER NOT NULL DEFAULT 0");
    }
    if (!requestColumns.some((column) => column.name === "accepts_air_mattress")) {
      db.exec("ALTER TABLE requests ADD COLUMN accepts_air_mattress INTEGER NOT NULL DEFAULT 0");
    }
    if (!requestColumns.some((column) => column.name === "invite_key_id")) {
      db.exec("ALTER TABLE requests ADD COLUMN invite_key_id INTEGER REFERENCES invite_keys(id) ON DELETE SET NULL");
    }
    if (!requestColumns.some((column) => column.name === "host_note")) {
      db.exec("ALTER TABLE requests ADD COLUMN host_note TEXT NOT NULL DEFAULT ''");
    }
    if (!requestColumns.some((column) => column.name === "submission_key")) {
      db.exec("ALTER TABLE requests ADD COLUMN submission_key TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS unique_request_submission_key ON requests(submission_key) WHERE submission_key IS NOT NULL");
    }
    if (!requestColumns.some((column) => column.name === "deleted_at")) {
      db.exec("ALTER TABLE requests ADD COLUMN deleted_at TEXT");
    }
    if (!requestColumns.some((column) => column.name === "tracking_last_accessed_at")) {
      db.exec("ALTER TABLE requests ADD COLUMN tracking_last_accessed_at TEXT");
    }
    if (!requestColumns.some((column) => column.name === "rejection_reason")) {
      db.exec("ALTER TABLE requests ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''");
    }
    if (!requestColumns.some((column) => column.name === "updated_at")) {
      db.exec("ALTER TABLE requests ADD COLUMN updated_at TEXT");
      db.exec("UPDATE requests SET updated_at=COALESCE(created_at,CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS requests_set_updated_at
      AFTER UPDATE ON requests
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE requests SET updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
      END`);

    const auditColumns = db.prepare("PRAGMA table_info(audit_logs)").all();
    if (!auditColumns.some((column) => column.name === "actor")) {
      db.exec("ALTER TABLE audit_logs ADD COLUMN actor TEXT NOT NULL DEFAULT 'web-admin'");
    }
    if (!auditColumns.some((column) => column.name === "before_summary")) {
      db.exec("ALTER TABLE audit_logs ADD COLUMN before_summary TEXT NOT NULL DEFAULT ''");
    }
    if (!auditColumns.some((column) => column.name === "after_summary")) {
      db.exec("ALTER TABLE audit_logs ADD COLUMN after_summary TEXT NOT NULL DEFAULT ''");
    }

    db.prepare("DELETE FROM admin_api_idempotency WHERE created_at < datetime('now','-30 days')").run();
    const idempotencyRows = db.prepare(
      "SELECT idempotency_key,response_json FROM admin_api_idempotency",
    ).all();
    const updateIdempotency = db.prepare(
      "UPDATE admin_api_idempotency SET response_json=? WHERE idempotency_key=?",
    );
    const deleteIdempotency = db.prepare(
      "DELETE FROM admin_api_idempotency WHERE idempotency_key=?",
    );
    db.transaction(() => {
      for (const row of idempotencyRows) {
        try {
          const parsed = JSON.parse(row.response_json);
          const bookingId = parsed.bookingId ?? parsed.booking?.id;
          if (!Number.isInteger(bookingId) || !parsed.result || typeof parsed.result !== "object") {
            deleteIdempotency.run(row.idempotency_key);
            continue;
          }
          const compacted = JSON.stringify({
            bookingId,
            result: {
              action: String(parsed.result.action ?? ""),
              actor: String(parsed.result.actor ?? "Agent"),
              summary: String(parsed.result.summary ?? "").slice(0, 240),
            },
          });
          if (row.response_json !== compacted) {
            updateIdempotency.run(compacted, row.idempotency_key);
          }
        } catch {
          deleteIdempotency.run(row.idempotency_key);
        }
      }
    })();

    const requestChangeColumns = db.prepare("PRAGMA table_info(request_changes)").all();
    if (!requestChangeColumns.some((column) => column.name === "guest_name")) {
      db.exec("ALTER TABLE request_changes ADD COLUMN guest_name TEXT NOT NULL DEFAULT ''");
    }
    if (!requestChangeColumns.some((column) => column.name === "party_size")) {
      db.exec("ALTER TABLE request_changes ADD COLUMN party_size INTEGER NOT NULL DEFAULT 1");
    }
    if (!requestChangeColumns.some((column) => column.name === "accepts_sofa")) {
      db.exec("ALTER TABLE request_changes ADD COLUMN accepts_sofa INTEGER NOT NULL DEFAULT 0");
    }
    if (!requestChangeColumns.some((column) => column.name === "accepts_air_mattress")) {
      db.exec("ALTER TABLE request_changes ADD COLUMN accepts_air_mattress INTEGER NOT NULL DEFAULT 0");
    }
    if (!requestChangeColumns.some((column) => column.name === "exclusive")) {
      db.exec("ALTER TABLE request_changes ADD COLUMN exclusive INTEGER NOT NULL DEFAULT 0");
    }

    const resourceColumns = db.prepare("PRAGMA table_info(resources)").all();
    if (!resourceColumns.some((column) => column.name === "admin_only")) {
      db.exec("ALTER TABLE resources ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0");
    }
    if (!resourceColumns.some((column) => column.name === "requires_sofa_consent")) {
      db.exec("ALTER TABLE resources ADD COLUMN requires_sofa_consent INTEGER NOT NULL DEFAULT 0");
      db.exec("UPDATE resources SET requires_sofa_consent=1 WHERE lower(name) LIKE '%sofa%'");
    }

    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('group_key',?)").run(requestKey);
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('group_key_version','1')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('host_display_name','Host')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('calendar_feed_token',?)").run(randomBytes(24).toString("base64url"));
    db.prepare("INSERT INTO settings (key,value) VALUES ('schema_version','3') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

    if (!db.prepare("SELECT id FROM stays WHERE starts_on IS NULL AND ends_on IS NULL LIMIT 1").get()) {
      db.transaction(() => {
        const result = db
          .prepare("INSERT INTO stays (name, location) VALUES (?, ?)")
          .run(home.name, home.location);
        const stayId = Number(result.lastInsertRowid);
        const insert = db.prepare(
          "INSERT INTO resources (stay_id,name,capacity,priority,admin_only,requires_sofa_consent) VALUES (?,?,?,?,?,?)",
        );
        home.resources.forEach((resource, index) => {
          insert.run(
            stayId,
            resource.name,
            resource.capacity,
            index + 1,
            resource.adminOnly ? 1 : 0,
            resource.requiresSofaConsent ? 1 : 0,
          );
        });
      })();
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
