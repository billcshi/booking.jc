import { createHash } from "node:crypto";

const BOOKING_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);
const ADJUSTABLE_FIELDS = new Set([
  "guestName",
  "startsOn",
  "endsOn",
  "partySize",
  "acceptsSofa",
  "acceptsAirMattress",
  "exclusive",
  "note",
  "hostNote",
]);

export class AdminBookingError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message);
    this.name = "AdminBookingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status, details = {}) {
  throw new AdminBookingError(code, message, status, details);
}

function isoTimestamp(value) {
  if (!value) return null;
  return `${String(value).replace(" ", "T")}Z`;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function nightsBetween(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDay(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function loadBookingRow(db, id) {
  return db.prepare(`SELECT q.id,q.stay_id,q.guest_name,q.starts_on,q.ends_on,q.party_size,
    q.accepts_sofa,q.accepts_air_mattress,q.exclusive,q.note,q.host_note,q.rejection_reason,q.status,
    q.created_at,q.updated_at,s.name stay_name,
    CASE WHEN s.starts_on IS NULL AND s.ends_on IS NULL THEN 1 ELSE 0 END is_home,
    s.starts_on stay_starts_on,s.ends_on stay_ends_on
    FROM requests q JOIN stays s ON s.id=q.stay_id
    WHERE q.id=? AND q.deleted_at IS NULL`).get(id);
}

function requireBookingRow(db, id) {
  if (!Number.isInteger(id) || id < 1) {
    fail("INVALID_BOOKING_ID", "Booking ID must be a positive integer.", 400, { field: "id" });
  }
  const row = loadBookingRow(db, id);
  if (!row) fail("BOOKING_NOT_FOUND", "Booking was not found.", 404, { bookingId: id });
  return row;
}

function listAllocations(db, requestId) {
  return db.prepare(`SELECT a.resource_id resourceId,r.name resourceName,a.seats
    FROM allocations a JOIN resources r ON r.id=a.resource_id
    WHERE a.request_id=? ORDER BY r.priority,r.id`).all(requestId);
}

function allocationPlan(db, booking) {
  if (
    (booking.stay_starts_on && booking.starts_on < booking.stay_starts_on) ||
    (booking.stay_ends_on && booking.ends_on > booking.stay_ends_on)
  ) {
    return {
      code: "OUTSIDE_STAY_DATES",
      details: { stayStartsOn: booking.stay_starts_on, stayEndsOn: booking.stay_ends_on },
      plan: [],
    };
  }

  const blackout = db.prepare(`SELECT id FROM blackouts
    WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1`).get(
      booking.stay_id,
      booking.ends_on,
      booking.starts_on,
    );
  if (blackout) return { code: "BLACKOUT_CONFLICT", details: { blackoutId: blackout.id }, plan: [] };

  const overlaps = db.prepare(`SELECT id,exclusive FROM requests
    WHERE deleted_at IS NULL AND stay_id=? AND id<>? AND status='approved'
      AND starts_on < ? AND ends_on > ? ORDER BY id`).all(
        booking.stay_id,
        booking.id,
        booking.ends_on,
        booking.starts_on,
      );
  if ((booking.exclusive && overlaps.length > 0) || overlaps.some((row) => row.exclusive)) {
    return {
      code: "BOOKING_CONFLICT",
      details: { kind: "exclusive", conflictingBookingIds: overlaps.map((row) => row.id) },
      plan: [],
    };
  }

  const resources = db.prepare(`SELECT id,name,capacity,admin_only,requires_sofa_consent
    FROM resources WHERE stay_id=? ORDER BY priority,capacity DESC,id`).all(booking.stay_id);
  let remaining = booking.party_size;
  const plan = [];
  for (const resource of resources) {
    if (resource.requires_sofa_consent && !booking.accepts_sofa) continue;
    if (resource.admin_only && !booking.accepts_air_mattress) continue;
    const existing = db.prepare(`SELECT q.starts_on,q.ends_on,a.seats
      FROM allocations a JOIN requests q ON q.id=a.request_id
      WHERE a.resource_id=? AND q.deleted_at IS NULL AND q.status='approved' AND q.id<>?
        AND q.starts_on < ? AND q.ends_on > ?`).all(
          resource.id,
          booking.id,
          booking.ends_on,
          booking.starts_on,
        );
    let peak = 0;
    for (let night = 0; night < nightsBetween(booking.starts_on, booking.ends_on); night += 1) {
      const day = addDay(booking.starts_on, night);
      peak = Math.max(
        peak,
        existing
          .filter((row) => row.starts_on <= day && row.ends_on > day)
          .reduce((sum, row) => sum + row.seats, 0),
      );
    }
    const seats = Math.min(remaining, Math.max(0, resource.capacity - peak));
    if (seats > 0) {
      plan.push({ resourceId: resource.id, resourceName: resource.name, seats });
      remaining -= seats;
    }
    if (!remaining) break;
  }
  if (remaining > 0) {
    return {
      code: "CAPACITY_CONFLICT",
      details: { requiredSeats: booking.party_size, availableSeats: booking.party_size - remaining },
      plan: [],
    };
  }
  return { code: "CLEAR", details: {}, plan };
}

function validationSummary(db, booking) {
  if (!["pending", "approved"].includes(booking.status)) {
    return { status: "not_applicable", canApprove: false, conflicts: [] };
  }
  const evaluated = allocationPlan(db, booking);
  if (evaluated.code === "CLEAR") {
    return { status: "clear", canApprove: booking.status === "pending", conflicts: [] };
  }
  return {
    status: "conflict",
    canApprove: false,
    conflicts: [{ code: evaluated.code, details: evaluated.details }],
  };
}

function toBookingResource(db, row) {
  return {
    id: row.id,
    status: row.status,
    stay: { id: row.stay_id, name: row.stay_name },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    dateSemantics: "arrival_inclusive_departure_exclusive",
    partySize: row.party_size,
    exclusive: Boolean(row.exclusive),
    sleepingPreferences: {
      acceptsSofa: Boolean(row.accepts_sofa),
      acceptsAirMattress: Boolean(row.accepts_air_mattress),
    },
    applicant: { guestName: row.guest_name },
    notes: { guest: row.note || null, host: row.host_note || null },
    rejectionReason: row.rejection_reason || null,
    allocations: listAllocations(db, row.id),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    validation: validationSummary(db, row),
  };
}

export function getAdminBooking(db, id) {
  return toBookingResource(db, requireBookingRow(db, id));
}

export function listAdminBookings(db, { status = "pending", limit = 50, offset = 0 } = {}) {
  if (status !== "all" && !BOOKING_STATUSES.has(status)) {
    fail("INVALID_QUERY", "status is not supported.", 400, { field: "status" });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail("INVALID_QUERY", "limit must be between 1 and 100.", 400, { field: "limit" });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    fail("INVALID_QUERY", "offset must be a non-negative integer.", 400, { field: "offset" });
  }
  const where = status === "all" ? "" : "AND q.status=?";
  const parameters = status === "all" ? [limit, offset] : [status, limit, offset];
  const rows = db.prepare(`SELECT q.id FROM requests q
    WHERE q.deleted_at IS NULL ${where}
    ORDER BY q.starts_on,q.created_at,q.id LIMIT ? OFFSET ?`).all(...parameters);
  const countParameters = status === "all" ? [] : [status];
  const total = db.prepare(`SELECT COUNT(*) count FROM requests q
    WHERE q.deleted_at IS NULL ${where}`).get(...countParameters).count;
  const items = rows.map((row) => getAdminBooking(db, row.id));
  return { items, count: items.length, pagination: { limit, offset, total } };
}

function validateAdjustments(row, adjustments) {
  if (!adjustments || typeof adjustments !== "object" || Array.isArray(adjustments)) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 422);
  }
  const unknownFields = Object.keys(adjustments).filter((key) => !ADJUSTABLE_FIELDS.has(key));
  if (unknownFields.length) {
    fail("VALIDATION_ERROR", "Request body contains unsupported fields.", 422, { fields: unknownFields });
  }
  if (!Object.keys(adjustments).length) {
    fail("VALIDATION_ERROR", "At least one adjustable field is required.", 422);
  }
  const next = {
    guestName: adjustments.guestName ?? row.guest_name,
    startsOn: adjustments.startsOn ?? row.starts_on,
    endsOn: adjustments.endsOn ?? row.ends_on,
    partySize: adjustments.partySize ?? row.party_size,
    acceptsSofa: adjustments.acceptsSofa ?? Boolean(row.accepts_sofa),
    acceptsAirMattress: adjustments.acceptsAirMattress ?? Boolean(row.accepts_air_mattress),
    exclusive: adjustments.exclusive ?? Boolean(row.exclusive),
    note: adjustments.note ?? row.note,
    hostNote: adjustments.hostNote ?? row.host_note,
  };
  if (typeof next.guestName !== "string" || !next.guestName.trim() || next.guestName.trim().length > 80) {
    fail("VALIDATION_ERROR", "guestName must contain 1 to 80 characters.", 422, { field: "guestName" });
  }
  if (!validIsoDate(next.startsOn) || !validIsoDate(next.endsOn) || next.startsOn >= next.endsOn) {
    fail("VALIDATION_ERROR", "startsOn and endsOn must be valid dates with startsOn before endsOn.", 422, { fields: ["startsOn", "endsOn"] });
  }
  if (nightsBetween(next.startsOn, next.endsOn) > 3650) {
    fail("VALIDATION_ERROR", "A booking cannot exceed 3650 nights.", 422, { fields: ["startsOn", "endsOn"] });
  }
  if (!Number.isInteger(next.partySize) || next.partySize < 1 || next.partySize > 8) {
    fail("VALIDATION_ERROR", "partySize must be an integer between 1 and 8.", 422, { field: "partySize" });
  }
  for (const field of ["acceptsSofa", "acceptsAirMattress", "exclusive"]) {
    if (typeof next[field] !== "boolean") {
      fail("VALIDATION_ERROR", `${field} must be a boolean.`, 422, { field });
    }
  }
  for (const field of ["note", "hostNote"]) {
    if (typeof next[field] !== "string" || next[field].length > 1000) {
      fail("VALIDATION_ERROR", `${field} must be a string of at most 1000 characters.`, 422, { field });
    }
  }
  if ((row.stay_starts_on && next.startsOn < row.stay_starts_on) ||
      (row.stay_ends_on && next.endsOn > row.stay_ends_on)) {
    fail("OUTSIDE_STAY_DATES", "Booking dates must remain inside the stay dates.", 422, {
      stayStartsOn: row.stay_starts_on,
      stayEndsOn: row.stay_ends_on,
    });
  }
  if (!row.is_home) {
    next.acceptsSofa = false;
    next.acceptsAirMattress = false;
  }
  next.guestName = next.guestName.trim();
  return next;
}

function updateDetails(db, id, next) {
  db.prepare(`UPDATE requests SET guest_name=?,starts_on=?,ends_on=?,party_size=?,accepts_sofa=?,
    accepts_air_mattress=?,exclusive=?,note=?,host_note=? WHERE id=?`).run(
      next.guestName,
      next.startsOn,
      next.endsOn,
      next.partySize,
      next.acceptsSofa ? 1 : 0,
      next.acceptsAirMattress ? 1 : 0,
      next.exclusive ? 1 : 0,
      next.note,
      next.hostNote,
      id,
    );
}

function throwApprovalConflict(evaluated) {
  const messages = {
    OUTSIDE_STAY_DATES: "Booking dates are outside the stay dates.",
    BLACKOUT_CONFLICT: "Booking dates overlap an unavailable period.",
    BOOKING_CONFLICT: "Booking conflicts with an exclusive approved booking.",
    CAPACITY_CONFLICT: "There is not enough eligible capacity for this booking.",
  };
  const status = evaluated.code === "OUTSIDE_STAY_DATES" ? 422 : 409;
  fail(evaluated.code, messages[evaluated.code] ?? "Booking cannot be approved.", status, evaluated.details);
}

function insertPlan(db, requestId, plan) {
  const insert = db.prepare("INSERT INTO allocations (request_id,resource_id,seats) VALUES (?,?,?)");
  for (const allocation of plan) insert.run(requestId, allocation.resourceId, allocation.seats);
}

function validateManualPlan(db, booking, allocations) {
  if (!Array.isArray(allocations) || allocations.length > 30) {
    fail("ALLOCATION_INVALID", "allocations must be an array with at most 30 entries.", 422);
  }
  if (allocations.some((item) => !item || !Number.isInteger(item.resourceId) || item.resourceId < 1 ||
      !Number.isInteger(item.seats) || item.seats < 1 || item.seats > 8) ||
      new Set(allocations.map((item) => item.resourceId)).size !== allocations.length ||
      allocations.reduce((sum, item) => sum + item.seats, 0) !== booking.party_size) {
    fail("ALLOCATION_INVALID", "Manual allocations must be unique and add up to partySize.", 422);
  }
  const automaticCheck = allocationPlan(db, booking);
  if (["OUTSIDE_STAY_DATES", "BLACKOUT_CONFLICT", "BOOKING_CONFLICT"].includes(automaticCheck.code)) {
    throwApprovalConflict(automaticCheck);
  }
  for (const allocation of allocations) {
    const resource = db.prepare(`SELECT id,stay_id,capacity,admin_only,requires_sofa_consent
      FROM resources WHERE id=?`).get(allocation.resourceId);
    if (!resource || resource.stay_id !== booking.stay_id ||
        (resource.admin_only && !booking.accepts_air_mattress) ||
        (resource.requires_sofa_consent && !booking.accepts_sofa)) {
      fail("ALLOCATION_INVALID", "A manual allocation is not eligible for this booking.", 422, {
        resourceId: allocation.resourceId,
      });
    }
    const overlapping = db.prepare(`SELECT q.starts_on,q.ends_on,a.seats
      FROM allocations a JOIN requests q ON q.id=a.request_id
      WHERE a.resource_id=? AND q.deleted_at IS NULL AND q.status='approved' AND q.id<>?
        AND q.starts_on < ? AND q.ends_on > ?`).all(
          resource.id,
          booking.id,
          booking.ends_on,
          booking.starts_on,
        );
    let peak = 0;
    for (let night = 0; night < nightsBetween(booking.starts_on, booking.ends_on); night += 1) {
      const day = addDay(booking.starts_on, night);
      peak = Math.max(peak, overlapping.filter((item) => item.starts_on <= day && item.ends_on > day)
        .reduce((sum, item) => sum + item.seats, 0));
    }
    if (allocation.seats > resource.capacity - peak) {
      fail("CAPACITY_CONFLICT", "A manual allocation exceeds available capacity.", 409, {
        resourceId: allocation.resourceId,
      });
    }
  }
  return allocations;
}

function auditSnapshot(db, row) {
  if (!row) return null;
  return {
    status: row.status,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    partySize: row.party_size,
    exclusive: Boolean(row.exclusive),
    acceptsSofa: Boolean(row.accepts_sofa),
    acceptsAirMattress: Boolean(row.accepts_air_mattress),
    allocations: listAllocations(db, row.id).map(({ resourceId, seats }) => ({ resourceId, seats })),
  };
}

function addMutationAudit(db, { action, bookingId, actor, before, after }) {
  db.prepare(`INSERT INTO audit_logs
    (action,entity_type,entity_id,summary,actor,before_summary,after_summary)
    VALUES (?,?,?,?,?,?,?)`).run(
      action,
      "request",
      bookingId,
      `${action} by ${actor}`,
      actor,
      JSON.stringify(before),
      JSON.stringify(after),
    );
}

export function stableRequestHash(value) {
  function canonical(item) {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
    }
    return item;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function executeMutation(db, { operation, idempotencyKey, requestHash, mutate }) {
  const transaction = db.transaction(() => {
    if (idempotencyKey) {
      db.prepare("DELETE FROM admin_api_idempotency WHERE created_at < datetime('now','-30 days')").run();
      const existing = db.prepare(`SELECT operation,request_hash,response_json
        FROM admin_api_idempotency WHERE idempotency_key=?`).get(idempotencyKey);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          fail("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different operation or body.", 409);
        }
        const stored = JSON.parse(existing.response_json);
        return {
          booking: getAdminBooking(db, stored.bookingId),
          result: { ...stored.result, idempotentReplay: true },
        };
      }
    }
    const response = mutate();
    response.result.idempotentReplay = false;
    if (idempotencyKey) {
      const stored = {
        bookingId: response.booking.id,
        result: {
          action: response.result.action,
          actor: response.result.actor,
          summary: response.result.summary,
        },
      };
      db.prepare(`INSERT INTO admin_api_idempotency
        (idempotency_key,operation,request_hash,response_json) VALUES (?,?,?,?)`).run(
          idempotencyKey,
          operation,
          requestHash,
          JSON.stringify(stored),
        );
    }
    return response;
  });
  return transaction.immediate();
}

function mutationOptions(id, action, body, options = {}) {
  return {
    operation: `booking.${id}.${action}`,
    idempotencyKey: options.idempotencyKey ?? null,
    requestHash: options.requestHash ?? stableRequestHash(body),
    actor: options.actor ?? "web-admin",
  };
}

function requireState(row, states, target) {
  if (!states.includes(row.status)) {
    fail("INVALID_STATE_TRANSITION", `Cannot transition booking from ${row.status} to ${target}.`, 409, {
      currentStatus: row.status,
      requestedStatus: target,
    });
  }
}

export function approveAdminBooking(db, id, options = {}) {
  const settings = mutationOptions(id, "approve", {}, options);
  return executeMutation(db, {
    ...settings,
    mutate: () => {
      const beforeRow = requireBookingRow(db, id);
      requireState(beforeRow, ["pending"], "approved");
      const before = auditSnapshot(db, beforeRow);
      db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
      const evaluated = allocationPlan(db, beforeRow);
      if (evaluated.code !== "CLEAR") throwApprovalConflict(evaluated);
      insertPlan(db, id, evaluated.plan);
      db.prepare("UPDATE requests SET status='approved',rejection_reason='' WHERE id=?").run(id);
      const afterRow = requireBookingRow(db, id);
      const after = auditSnapshot(db, afterRow);
      addMutationAudit(db, { action: "request.approved", bookingId: id, actor: settings.actor, before, after });
      return {
        booking: toBookingResource(db, afterRow),
        result: { action: "approved", actor: settings.actor, summary: `Booking #${id} was approved and allocated.` },
      };
    },
  });
}

export function rejectAdminBooking(db, id, { reason = "" } = {}, options = {}) {
  if (typeof reason !== "string" || reason.length > 1000) {
    fail("VALIDATION_ERROR", "reason must be a string of at most 1000 characters.", 422, { field: "reason" });
  }
  const body = { reason };
  const settings = mutationOptions(id, "reject", body, options);
  return executeMutation(db, {
    ...settings,
    mutate: () => {
      const beforeRow = requireBookingRow(db, id);
      requireState(beforeRow, ["pending"], "rejected");
      const before = auditSnapshot(db, beforeRow);
      db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
      db.prepare("UPDATE requests SET status='rejected',rejection_reason=? WHERE id=?").run(reason.trim(), id);
      db.prepare(`UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP
        WHERE request_id=? AND status='pending'`).run(id);
      const afterRow = requireBookingRow(db, id);
      const after = auditSnapshot(db, afterRow);
      addMutationAudit(db, { action: "request.rejected", bookingId: id, actor: settings.actor, before, after });
      return {
        booking: toBookingResource(db, afterRow),
        result: { action: "rejected", actor: settings.actor, summary: `Booking #${id} was rejected.` },
      };
    },
  });
}

export function adjustAdminBooking(db, id, adjustments, options = {}) {
  const settings = mutationOptions(id, "adjust", adjustments, options);
  return executeMutation(db, {
    ...settings,
    mutate: () => {
      const beforeRow = requireBookingRow(db, id);
      requireState(beforeRow, ["pending", "approved"], beforeRow.status);
      const next = validateAdjustments(beforeRow, adjustments);
      const before = auditSnapshot(db, beforeRow);
      db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
      updateDetails(db, id, next);
      const updatedRow = requireBookingRow(db, id);
      if (updatedRow.status === "approved") {
        const evaluated = allocationPlan(db, updatedRow);
        if (evaluated.code !== "CLEAR") throwApprovalConflict(evaluated);
        insertPlan(db, id, evaluated.plan);
      }
      const afterRow = requireBookingRow(db, id);
      const after = auditSnapshot(db, afterRow);
      addMutationAudit(db, { action: "request.adjusted", bookingId: id, actor: settings.actor, before, after });
      return {
        booking: toBookingResource(db, afterRow),
        result: { action: "adjusted", actor: settings.actor, summary: `Booking #${id} was adjusted.` },
      };
    },
  });
}

export function adjustAndApproveAdminBooking(db, id, adjustments, options = {}) {
  const settings = mutationOptions(id, "adjust-and-approve", adjustments, options);
  return executeMutation(db, {
    ...settings,
    mutate: () => {
      const beforeRow = requireBookingRow(db, id);
      requireState(beforeRow, ["pending"], "approved");
      const next = validateAdjustments(beforeRow, adjustments);
      const before = auditSnapshot(db, beforeRow);
      db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
      updateDetails(db, id, next);
      const adjustedRow = requireBookingRow(db, id);
      const evaluated = allocationPlan(db, adjustedRow);
      if (evaluated.code !== "CLEAR") throwApprovalConflict(evaluated);
      insertPlan(db, id, evaluated.plan);
      db.prepare("UPDATE requests SET status='approved',rejection_reason='' WHERE id=?").run(id);
      const afterRow = requireBookingRow(db, id);
      const after = auditSnapshot(db, afterRow);
      addMutationAudit(db, { action: "request.adjusted_and_approved", bookingId: id, actor: settings.actor, before, after });
      return {
        booking: toBookingResource(db, afterRow),
        result: {
          action: "adjusted_and_approved",
          actor: settings.actor,
          summary: `Booking #${id} was adjusted, approved, and allocated atomically.`,
        },
      };
    },
  });
}

export function editAdminBooking(db, id, input, options = {}) {
  const { status, allocationMode = "auto", allocations = [], ...adjustments } = input;
  if (!BOOKING_STATUSES.has(status)) {
    fail("VALIDATION_ERROR", "status is not supported.", 422, { field: "status" });
  }
  if (!["auto", "manual"].includes(allocationMode)) {
    fail("ALLOCATION_INVALID", "allocationMode must be auto or manual.", 422);
  }
  const settings = mutationOptions(id, "web-edit", input, options);
  return executeMutation(db, {
    ...settings,
    mutate: () => {
      const beforeRow = requireBookingRow(db, id);
      const next = validateAdjustments(beforeRow, adjustments);
      const before = auditSnapshot(db, beforeRow);
      db.prepare("DELETE FROM allocations WHERE request_id=?").run(id);
      updateDetails(db, id, next);
      db.prepare("UPDATE requests SET status=?,rejection_reason=CASE WHEN ?='rejected' THEN rejection_reason ELSE '' END WHERE id=?")
        .run(status, status, id);
      db.prepare(`UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP
        WHERE request_id=? AND status='pending'`).run(id);
      const updatedRow = requireBookingRow(db, id);
      if (status === "approved") {
        if (allocationMode === "auto") {
          const evaluated = allocationPlan(db, updatedRow);
          if (evaluated.code !== "CLEAR") throwApprovalConflict(evaluated);
          insertPlan(db, id, evaluated.plan);
        } else {
          insertPlan(db, id, validateManualPlan(db, updatedRow, allocations));
        }
      }
      const afterRow = requireBookingRow(db, id);
      const after = auditSnapshot(db, afterRow);
      addMutationAudit(db, { action: "request.edited", bookingId: id, actor: settings.actor, before, after });
      return {
        booking: toBookingResource(db, afterRow),
        result: { action: "edited", actor: settings.actor, summary: `Booking #${id} was edited.` },
      };
    },
  });
}
