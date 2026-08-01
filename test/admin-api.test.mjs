import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase } from "../scripts/database.mjs";
import {
  handleAdminApiRequest,
  resetAdminApiRateLimitsForTests,
} from "../scripts/admin-api-handler.mjs";

const AGENT_TOKEN = "test-agent-token-with-more-than-32-characters";
const temporaryDirectories = [];
let tokenSequence = 0;

beforeEach(() => resetAdminApiRateLimitsForTests());

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "booking-jc-admin-api-test-"));
  temporaryDirectories.push(directory);
  return initializeDatabase({ databasePath: join(directory, "booking.db"), requestKey: "test-group-key" });
}

function insertBooking(db, overrides = {}) {
  tokenSequence += 1;
  const stayId = overrides.stayId ?? db.prepare("SELECT id FROM stays ORDER BY id LIMIT 1").get().id;
  return Number(db.prepare(`INSERT INTO requests
    (stay_id,guest_name,contact,starts_on,ends_on,party_size,accepts_sofa,accepts_air_mattress,
      exclusive,note,host_note,status,manage_token)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      stayId,
      overrides.guestName ?? "Test Guest",
      overrides.contact ?? "",
      overrides.startsOn ?? "2032-01-10",
      overrides.endsOn ?? "2032-01-12",
      overrides.partySize ?? 1,
      overrides.acceptsSofa ? 1 : 0,
      overrides.acceptsAirMattress ? 1 : 0,
      overrides.exclusive ? 1 : 0,
      overrides.note ?? "Guest note",
      overrides.hostNote ?? "Host note",
      overrides.status ?? "pending",
      `private-manage-token-${tokenSequence}`,
    ).lastInsertRowid);
}

async function api(db, path, {
  method = "GET",
  token,
  body,
  idempotencyKey,
  resource = "collection",
  bookingId,
  action,
  clientId,
  configuredToken = AGENT_TOKEN,
} = {}) {
  const headers = new Headers();
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (clientId) headers.set("user-agent", clientId);
  const request = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleAdminApiRequest({
    db,
    request,
    resource,
    bookingId,
    action,
    configuredToken,
  });
  return { response, json: await response.json() };
}

test("Admin API requires its independent Agent Token", async () => {
  const db = testDatabase();
  insertBooking(db);
  const missing = await api(db, "/api/admin/v1/bookings");
  const wrong = await api(db, "/api/admin/v1/bookings", { token: "wrong-token" });
  const correct = await api(db, "/api/admin/v1/bookings", { token: AGENT_TOKEN });

  assert.equal(missing.response.status, 401);
  assert.equal(wrong.response.status, 401);
  assert.deepEqual(missing.json, wrong.json);
  assert.equal(missing.json.error.code, "UNAUTHORIZED");
  assert.equal(correct.response.status, 200);
  assert.equal(correct.json.count, 1);
  db.close();
});

test("Agent API rate limits unauthenticated traffic separately from authenticated traffic", async () => {
  const db = testDatabase();
  insertBooking(db);
  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await api(db, "/api/admin/v1/bookings", {
      token: "wrong-token",
      clientId: "rate-limit-test-client",
    });
    assert.equal(result.response.status, 401);
  }
  const limited = await api(db, "/api/admin/v1/bookings", {
    token: "wrong-token",
    clientId: "rate-limit-test-client",
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.json.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.response.headers.get("retry-after")) >= 1);

  const authenticated = await api(db, "/api/admin/v1/bookings", {
    token: AGENT_TOKEN,
    clientId: "rate-limit-test-client",
  });
  assert.equal(authenticated.response.status, 200);
  db.close();
});

test("pending list and booking detail return stable agent-safe resources", async () => {
  const db = testDatabase();
  const pendingId = insertBooking(db, { guestName: "Pending", contact: "private-contact-value" });
  insertBooking(db, { guestName: "Approved", status: "approved", startsOn: "2032-02-01", endsOn: "2032-02-02" });

  const list = await api(db, "/api/admin/v1/bookings?status=pending", { token: AGENT_TOKEN });
  assert.equal(list.response.status, 200);
  assert.equal(list.json.count, 1);
  assert.equal(list.json.pagination.total, 1);
  assert.equal(list.json.items[0].id, pendingId);
  assert.equal(list.json.items[0].dateSemantics, "arrival_inclusive_departure_exclusive");
  assert.match(list.json.items[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(list.json.items[0].validation.canApprove, true);
  assert.equal("manageToken" in list.json.items[0], false);

  const detail = await api(db, `/api/admin/v1/bookings/${pendingId}`, {
    token: AGENT_TOKEN,
    resource: "booking",
    bookingId: pendingId,
  });
  assert.equal(detail.response.status, 200);
  assert.deepEqual(detail.json.booking.applicant, { guestName: "Pending" });
  assert.equal(JSON.stringify(detail.json).includes("private-contact-value"), false);
  db.close();
});

test("approve, reject, adjust, and adjust-and-approve use atomic booking rules", async () => {
  const db = testDatabase();
  const approveId = insertBooking(db, { startsOn: "2033-01-01", endsOn: "2033-01-03" });
  const rejectId = insertBooking(db, { startsOn: "2033-02-01", endsOn: "2033-02-03" });
  const adjustId = insertBooking(db, { startsOn: "2033-03-01", endsOn: "2033-03-03" });
  const atomicId = insertBooking(db, { startsOn: "2033-04-01", endsOn: "2033-04-03" });

  const approved = await api(db, `/api/admin/v1/bookings/${approveId}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "approve-2033-0001",
    resource: "action", bookingId: approveId, action: "approve",
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.json.booking.status, "approved");
  assert.equal(approved.json.result.actor, "Agent");
  assert.equal(approved.json.booking.allocations.reduce((sum, item) => sum + item.seats, 0), 1);

  const rejected = await api(db, `/api/admin/v1/bookings/${rejectId}/reject`, {
    method: "POST", token: AGENT_TOKEN, body: { reason: "Dates no longer work" },
    idempotencyKey: "reject-2033-0001", resource: "action", bookingId: rejectId, action: "reject",
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.json.booking.status, "rejected");
  assert.equal(rejected.json.booking.rejectionReason, "Dates no longer work");

  const adjusted = await api(db, `/api/admin/v1/bookings/${adjustId}`, {
    method: "PATCH", token: AGENT_TOKEN,
    body: { startsOn: "2033-03-05", endsOn: "2033-03-08", partySize: 2, exclusive: true },
    idempotencyKey: "adjust-2033-0001", resource: "booking", bookingId: adjustId,
  });
  assert.equal(adjusted.response.status, 200);
  assert.equal(adjusted.json.booking.status, "pending");
  assert.equal(adjusted.json.booking.partySize, 2);
  assert.equal(adjusted.json.booking.exclusive, true);

  const atomic = await api(db, `/api/admin/v1/bookings/${atomicId}/adjust-and-approve`, {
    method: "POST", token: AGENT_TOKEN,
    body: { startsOn: "2033-04-02", endsOn: "2033-04-05", partySize: 2 },
    idempotencyKey: "atomic-2033-0001", resource: "action", bookingId: atomicId,
    action: "adjust-and-approve",
  });
  assert.equal(atomic.response.status, 200);
  assert.equal(atomic.json.booking.status, "approved");
  assert.equal(atomic.json.booking.startsOn, "2033-04-02");
  assert.equal(atomic.json.result.action, "adjusted_and_approved");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE actor='Agent'").get().count, 4);
  db.close();
});

test("date and party size validation reject malformed adjustments", async () => {
  const db = testDatabase();
  const id = insertBooking(db);
  const invalidDates = await api(db, `/api/admin/v1/bookings/${id}`, {
    method: "PATCH", token: AGENT_TOKEN, body: { startsOn: "2032-02-30" },
    idempotencyKey: "invalid-date-0001", resource: "booking", bookingId: id,
  });
  const invalidParty = await api(db, `/api/admin/v1/bookings/${id}`, {
    method: "PATCH", token: AGENT_TOKEN, body: { partySize: 0 },
    idempotencyKey: "invalid-party-001", resource: "booking", bookingId: id,
  });
  assert.equal(invalidDates.response.status, 422);
  assert.equal(invalidDates.json.error.code, "VALIDATION_ERROR");
  assert.equal(invalidParty.response.status, 422);
  assert.equal(db.prepare("SELECT party_size FROM requests WHERE id=?").get(id).party_size, 1);
  db.close();
});

test("exclusive and capacity conflicts roll back approval", async () => {
  const db = testDatabase();
  const resourceId = db.prepare("SELECT id FROM resources ORDER BY priority,id LIMIT 1").get().id;
  const approvedId = insertBooking(db, {
    status: "approved", exclusive: true, startsOn: "2034-01-01", endsOn: "2034-01-04",
  });
  db.prepare("INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,1)").run(approvedId, resourceId);
  const exclusiveConflictId = insertBooking(db, { startsOn: "2034-01-02", endsOn: "2034-01-03" });
  const exclusiveConflict = await api(db, `/api/admin/v1/bookings/${exclusiveConflictId}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "exclusive-conflict-1",
    resource: "action", bookingId: exclusiveConflictId, action: "approve",
  });
  assert.equal(exclusiveConflict.response.status, 409);
  assert.equal(exclusiveConflict.json.error.code, "BOOKING_CONFLICT");
  assert.equal(db.prepare("SELECT status FROM requests WHERE id=?").get(exclusiveConflictId).status, "pending");

  const capacityId = insertBooking(db, {
    partySize: 8, startsOn: "2034-02-01", endsOn: "2034-02-03",
    acceptsSofa: false, acceptsAirMattress: false,
  });
  const capacityConflict = await api(db, `/api/admin/v1/bookings/${capacityId}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "capacity-conflict-01",
    resource: "action", bookingId: capacityId, action: "approve",
  });
  assert.equal(capacityConflict.response.status, 409);
  assert.equal(capacityConflict.json.error.code, "CAPACITY_CONFLICT");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM allocations WHERE request_id=?").get(capacityId).count, 0);
  db.close();
});

test("blackout conflicts and illegal transitions return deterministic errors", async () => {
  const db = testDatabase();
  const id = insertBooking(db, { startsOn: "2035-01-01", endsOn: "2035-01-04" });
  const stayId = db.prepare("SELECT stay_id FROM requests WHERE id=?").get(id).stay_id;
  db.prepare("INSERT INTO blackouts (stay_id,starts_on,ends_on,reason) VALUES (?,?,?,?)")
    .run(stayId, "2035-01-02", "2035-01-03", "Private reason");
  const blocked = await api(db, `/api/admin/v1/bookings/${id}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "blackout-conflict-1",
    resource: "action", bookingId: id, action: "approve",
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.json.error.code, "BLACKOUT_CONFLICT");
  assert.equal(JSON.stringify(blocked.json).includes("Private reason"), false);

  db.prepare("DELETE FROM blackouts WHERE stay_id=?").run(stayId);
  const approved = await api(db, `/api/admin/v1/bookings/${id}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "legal-approve-0001",
    resource: "action", bookingId: id, action: "approve",
  });
  assert.equal(approved.response.status, 200);
  const repeated = await api(db, `/api/admin/v1/bookings/${id}/approve`, {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "different-retry-key",
    resource: "action", bookingId: id, action: "approve",
  });
  assert.equal(repeated.response.status, 409);
  assert.equal(repeated.json.error.code, "INVALID_STATE_TRANSITION");
  db.close();
});

test("Idempotency-Key safely replays writes and cannot be repurposed", async () => {
  const db = testDatabase();
  const firstId = insertBooking(db, { startsOn: "2036-01-01", endsOn: "2036-01-02" });
  const secondId = insertBooking(db, { startsOn: "2036-02-01", endsOn: "2036-02-02" });
  const options = {
    method: "POST", token: AGENT_TOKEN, body: {}, idempotencyKey: "stable-retry-key-0001",
    resource: "action", bookingId: firstId, action: "approve",
  };
  const first = await api(db, `/api/admin/v1/bookings/${firstId}/approve`, options);
  const stored = JSON.parse(db.prepare(
    "SELECT response_json FROM admin_api_idempotency WHERE idempotency_key=?",
  ).get(options.idempotencyKey).response_json);
  assert.deepEqual(Object.keys(stored).sort(), ["bookingId", "result"]);
  assert.deepEqual(Object.keys(stored.result).sort(), ["action", "actor", "summary"]);
  assert.equal(stored.bookingId, firstId);
  assert.equal(JSON.stringify(stored).includes("Test Guest"), false);
  assert.equal(JSON.stringify(stored).includes("Guest note"), false);
  assert.equal(JSON.stringify(stored).includes("Host note"), false);
  db.prepare("UPDATE requests SET host_note='Current note after original response' WHERE id=?").run(firstId);
  const replay = await api(db, `/api/admin/v1/bookings/${firstId}/approve`, options);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.result.idempotentReplay, false);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.json.result.idempotentReplay, true);
  assert.equal(replay.json.booking.notes.host, "Current note after original response");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='request.approved' AND entity_id=?").get(firstId).count, 1);

  const reused = await api(db, `/api/admin/v1/bookings/${secondId}/approve`, {
    ...options,
    bookingId: secondId,
  });
  assert.equal(reused.response.status, 409);
  assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(db.prepare("SELECT status FROM requests WHERE id=?").get(secondId).status, "pending");
  db.close();
});

test("expired idempotency records are removed opportunistically", async () => {
  const db = testDatabase();
  const id = insertBooking(db);
  db.prepare(`INSERT INTO admin_api_idempotency
    (idempotency_key,operation,request_hash,response_json,created_at)
    VALUES (?,?,?,?,datetime('now','-31 days'))`).run(
      "expired-key-0001",
      "booking.999.approve",
      "expired-hash",
      JSON.stringify({ bookingId: 999, result: { action: "approved", actor: "Agent", summary: "Expired" } }),
    );
  const approved = await api(db, `/api/admin/v1/bookings/${id}/approve`, {
    method: "POST",
    token: AGENT_TOKEN,
    body: {},
    idempotencyKey: "cleanup-trigger-key-01",
    resource: "action",
    bookingId: id,
    action: "approve",
  });
  assert.equal(approved.response.status, 200);
  assert.equal(db.prepare(
    "SELECT COUNT(*) count FROM admin_api_idempotency WHERE idempotency_key='expired-key-0001'",
  ).get().count, 0);
  db.close();
});

test("Agent Token never appears in responses, audit data, idempotency data, or logs", async () => {
  const db = testDatabase();
  const id = insertBooking(db);
  const logged = [];
  const originalError = console.error;
  console.error = (...values) => logged.push(values.join(" "));
  try {
    const result = await api(db, `/api/admin/v1/bookings/${id}/reject`, {
      method: "POST", token: AGENT_TOKEN, body: { reason: "Sensitive rejection reason" },
      idempotencyKey: "secret-check-key-01", resource: "action", bookingId: id, action: "reject",
    });
    assert.equal(result.response.status, 200);
    assert.equal(JSON.stringify(result.json).includes(AGENT_TOKEN), false);
  } finally {
    console.error = originalError;
  }
  const auditText = JSON.stringify(db.prepare("SELECT * FROM audit_logs").all());
  const idempotencyText = JSON.stringify(db.prepare("SELECT * FROM admin_api_idempotency").all());
  assert.equal(auditText.includes(AGENT_TOKEN), false);
  assert.equal(idempotencyText.includes(AGENT_TOKEN), false);
  assert.equal(idempotencyText.includes("Test Guest"), false);
  assert.equal(idempotencyText.includes("Guest note"), false);
  assert.equal(idempotencyText.includes("Host note"), false);
  assert.equal(idempotencyText.includes("Sensitive rejection reason"), false);
  assert.equal(logged.join("\n").includes(AGENT_TOKEN), false);
  db.close();
});
