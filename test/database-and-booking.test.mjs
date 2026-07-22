import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { initializeDatabase } from "../scripts/database.mjs";
import { reviewRequestChangeInTransaction } from "../scripts/request-change-transaction.mjs";

const temporaryDirectories = [];
afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "booking-jc-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "booking.db");
}

test("legacy requests migrate safely and initialization is idempotent", () => {
  const databasePath = temporaryDatabasePath();
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE stays (id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, starts_on TEXT, ends_on TEXT, is_public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE resources (id INTEGER PRIMARY KEY, stay_id INTEGER NOT NULL REFERENCES stays(id), name TEXT NOT NULL, capacity INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 10);
    CREATE TABLE requests (id INTEGER PRIMARY KEY, stay_id INTEGER NOT NULL REFERENCES stays(id), guest_name TEXT NOT NULL, contact TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, party_size INTEGER NOT NULL, accepts_sofa INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', manage_token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO stays (id,name,location) VALUES (1,'Home','Private');
    INSERT INTO requests (id,stay_id,guest_name,contact,starts_on,ends_on,party_size,note,status,manage_token) VALUES (1,1,'Guest','','2030-01-01','2030-01-02',1,'','pending','test-token');
  `);
  legacy.close();

  let db = initializeDatabase({ databasePath, requestKey: "first-key" });
  assert.equal(db.prepare("SELECT host_note FROM requests WHERE id=1").get().host_note, "");
  assert.ok(db.prepare("PRAGMA table_info(requests)").all().some((column) => column.name === "submission_key"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='request_changes'").get());
  db.prepare("UPDATE requests SET submission_key=? WHERE id=1").run("00000000-0000-4000-8000-000000000001");
  assert.throws(() => db.prepare(`INSERT INTO requests
    (stay_id,guest_name,contact,starts_on,ends_on,party_size,note,status,manage_token,submission_key)
    VALUES (1,'Duplicate','','2030-01-01','2030-01-02',1,'','pending','other-token',?)`)
    .run("00000000-0000-4000-8000-000000000001"), /UNIQUE/);
  db.close();

  db = initializeDatabase({ databasePath, requestKey: "replacement-must-not-win" });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='group_key'").get().value, "first-key");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM requests").get().count, 1);
  db.close();
});

function approvedRequestWithChange() {
  const db = initializeDatabase({ databasePath: temporaryDatabasePath(), requestKey: "test-key" });
  const stayId = db.prepare("SELECT id FROM stays LIMIT 1").get().id;
  const resourceId = db.prepare("SELECT id FROM resources WHERE stay_id=? ORDER BY id LIMIT 1").get(stayId).id;
  const requestId = db.prepare(`INSERT INTO requests
    (stay_id,guest_name,contact,starts_on,ends_on,party_size,note,status,manage_token)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(stayId,"Original","","2030-02-01","2030-02-03",1,"old","approved","test-token").lastInsertRowid;
  db.prepare("INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,1)").run(requestId,resourceId);
  const changeId = db.prepare(`INSERT INTO request_changes
    (request_id,guest_name,starts_on,ends_on,party_size,note) VALUES (?,?,?,?,?,?)`)
    .run(requestId,"Changed","2030-03-01","2030-03-03",1,"new").lastInsertRowid;
  return { db, requestId: Number(requestId), resourceId, changeId: Number(changeId) };
}

test("capacity failure rolls back profile replacement and allocation deletion", () => {
  const { db, requestId, changeId } = approvedRequestWithChange();
  assert.throws(() => reviewRequestChangeInTransaction({ db, changeId, decision: "approve", suggestAllocation: () => false }), /capacity/);
  assert.equal(db.prepare("SELECT guest_name FROM requests WHERE id=?").get(requestId).guest_name, "Original");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM allocations WHERE request_id=?").get(requestId).count, 1);
  assert.equal(db.prepare("SELECT status FROM request_changes WHERE id=?").get(changeId).status, "pending");
  db.close();
});

test("approval replaces details and allocation atomically", () => {
  const { db, requestId, resourceId, changeId } = approvedRequestWithChange();
  reviewRequestChangeInTransaction({
    db,
    changeId,
    decision: "approve",
    suggestAllocation: (id) => {
      db.prepare("INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,1)").run(id,resourceId);
      return true;
    },
  });
  const request = db.prepare("SELECT guest_name,starts_on,ends_on,note FROM requests WHERE id=?").get(requestId);
  assert.deepEqual(request, { guest_name: "Changed", starts_on: "2030-03-01", ends_on: "2030-03-03", note: "new" });
  assert.equal(db.prepare("SELECT status FROM request_changes WHERE id=?").get(changeId).status, "approved");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM allocations WHERE request_id=?").get(requestId).count, 1);
  assert.equal(
    reviewRequestChangeInTransaction({ db, changeId, decision: "approve", suggestAllocation: () => false }),
    "test-token",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM allocations WHERE request_id=?").get(requestId).count, 1);
  db.close();
});

test("blackout conflict leaves an approved request unchanged", () => {
  const { db, requestId, changeId } = approvedRequestWithChange();
  const stayId = db.prepare("SELECT stay_id FROM requests WHERE id=?").get(requestId).stay_id;
  db.prepare("INSERT INTO blackouts (stay_id,starts_on,ends_on) VALUES (?,?,?)").run(stayId,"2030-03-02","2030-03-04");
  assert.throws(() => reviewRequestChangeInTransaction({ db, changeId, decision: "approve", suggestAllocation: () => true }), /blocked/);
  assert.equal(db.prepare("SELECT guest_name FROM requests WHERE id=?").get(requestId).guest_name, "Original");
  assert.equal(db.prepare("SELECT status FROM request_changes WHERE id=?").get(changeId).status, "pending");
  db.close();
});
