import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../scripts/database.mjs";
import { approvedExclusiveConflict } from "../scripts/booking-conflicts.mjs";

const temporaryDirectories = [];
afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "booking-jc-conflict-test-"));
  temporaryDirectories.push(directory);
  return initializeDatabase({ databasePath: join(directory, "booking.db"), requestKey: "test-key" });
}

function insertRequest(db, stayId, { status = "approved", exclusive = false, startsOn = "2035-01-10", endsOn = "2035-01-12" } = {}) {
  return Number(db.prepare(`INSERT INTO requests
    (stay_id,guest_name,contact,starts_on,ends_on,party_size,exclusive,note,status,manage_token)
    VALUES (?,?,?,?,?,1,?,'',?,?)`).run(
      stayId, "Guest", "", startsOn, endsOn, exclusive ? 1 : 0, status,
      `token-${status}-${exclusive}-${startsOn}-${endsOn}`,
    ).lastInsertRowid);
}

test("an approved shared stay blocks a new overlapping exclusive request", () => {
  const db = testDatabase();
  const stayId = db.prepare("SELECT id FROM stays ORDER BY id LIMIT 1").get().id;
  const approvedId = insertRequest(db, stayId);

  assert.deepEqual(approvedExclusiveConflict(db, {
    stayId, startsOn: "2035-01-11", endsOn: "2035-01-13", exclusive: true,
  }).map((request) => request.id), [approvedId]);
  assert.equal(approvedExclusiveConflict(db, {
    stayId, startsOn: "2035-01-12", endsOn: "2035-01-13", exclusive: true,
  }), null);
  db.close();
});

test("an approved exclusive stay blocks a new overlapping shared request", () => {
  const db = testDatabase();
  const stayId = db.prepare("SELECT id FROM stays ORDER BY id LIMIT 1").get().id;
  insertRequest(db, stayId, { exclusive: true });

  assert.ok(approvedExclusiveConflict(db, {
    stayId, startsOn: "2035-01-09", endsOn: "2035-01-11", exclusive: false,
  }));
  db.close();
});

test("pending stays do not reserve exclusivity and a booking can exclude itself", () => {
  const db = testDatabase();
  const stayId = db.prepare("SELECT id FROM stays ORDER BY id LIMIT 1").get().id;
  insertRequest(db, stayId, { status: "pending", exclusive: true });
  const approvedId = insertRequest(db, stayId, { startsOn: "2035-02-01", endsOn: "2035-02-03" });

  assert.equal(approvedExclusiveConflict(db, {
    stayId, startsOn: "2035-01-10", endsOn: "2035-01-11", exclusive: false,
  }), null);
  assert.equal(approvedExclusiveConflict(db, {
    stayId, startsOn: "2035-02-01", endsOn: "2035-02-03", exclusive: true, excludeRequestId: approvedId,
  }), null);
  db.close();
});
