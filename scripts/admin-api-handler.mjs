import { createHash, timingSafeEqual } from "node:crypto";
import { requiredSecret } from "./config.mjs";
import {
  AdminBookingError,
  adjustAdminBooking,
  adjustAndApproveAdminBooking,
  approveAdminBooking,
  getAdminBooking,
  listAdminBookings,
  rejectAdminBooking,
} from "./admin-booking-service.mjs";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const UNAUTHENTICATED_RATE_LIMIT = 30;
const AUTHENTICATED_RATE_LIMIT = 300;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(code, message, status, details = {}, headers = {}) {
  return json({ error: { code, message, details } }, status, headers);
}

function tokenDigest(value) {
  return createHash("sha256").update(value).digest();
}

function clientFingerprint(request) {
  const trustedAddress = process.env.TRUST_PROXY === "1"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") || "proxy"
    : "direct";
  return createHash("sha256").update([
    trustedAddress,
    request.headers.get("user-agent") ?? "unknown",
    request.headers.get("accept-language") ?? "unknown",
  ].join("\n")).digest("hex").slice(0, 24);
}

function consumeRateLimit(request, authenticated) {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
    if (rateBuckets.size > 5000) rateBuckets.clear();
  }
  const scope = authenticated ? "authenticated" : "unauthenticated";
  const limit = authenticated ? AUTHENTICATED_RATE_LIMIT : UNAUTHENTICATED_RATE_LIMIT;
  const key = `${scope}:${clientFingerprint(request)}`;
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function resetAdminApiRateLimitsForTests() {
  rateBuckets.clear();
}

export function authenticateAdminApiRequest(authorization, configuredToken) {
  let validConfiguredToken;
  try {
    validConfiguredToken = requiredSecret("AGENT_TOKEN", configuredToken);
  } catch {
    return { ok: false, configurationError: true };
  }
  const match = typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  const supplied = match?.[1] ?? "";
  const valid = timingSafeEqual(tokenDigest(supplied), tokenDigest(validConfiguredToken));
  return { ok: valid, configurationError: false };
}

function parseIntegerQuery(value, fallback) {
  if (value === null) return fallback;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

async function parseBody(request) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > 16_384) {
    throw new AdminBookingError("REQUEST_TOO_LARGE", "JSON request body is too large.", 400);
  }
  const text = await request.text();
  if (text.length > 16_384) {
    throw new AdminBookingError("REQUEST_TOO_LARGE", "JSON request body is too large.", 400);
  }
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("object required");
    }
    return value;
  } catch {
    throw new AdminBookingError("INVALID_JSON", "Request body must be a valid JSON object.", 400);
  }
}

function idempotencyKey(request) {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new AdminBookingError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key is required and must contain 8 to 128 safe characters.",
      400,
    );
  }
  return key;
}

/**
 * @param {{
 *   db: import("better-sqlite3").Database,
 *   request: Request,
 *   resource: "collection" | "booking" | "action",
 *   bookingId?: number,
 *   action?: "approve" | "reject" | "adjust-and-approve",
 *   configuredToken?: string
 * }} input
 */
export async function handleAdminApiRequest({
  db,
  request,
  resource,
  bookingId,
  action,
  configuredToken = process.env.AGENT_TOKEN,
}) {
  const authentication = authenticateAdminApiRequest(
    request.headers.get("authorization"),
    configuredToken,
  );
  if (authentication.configurationError) {
    return errorResponse("SERVICE_MISCONFIGURED", "Admin API is not configured.", 500);
  }
  const rateLimit = consumeRateLimit(request, authentication.ok);
  if (!rateLimit.allowed) {
    return errorResponse("RATE_LIMITED", "Too many Agent API requests.", 429, {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    }, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }
  if (!authentication.ok) {
    return errorResponse("UNAUTHORIZED", "A valid Agent Token is required.", 401, {}, {
      "www-authenticate": "Bearer",
    });
  }

  try {
    if (resource === "collection" && request.method === "GET") {
      const url = new URL(request.url);
      return json(listAdminBookings(db, {
        status: url.searchParams.get("status") ?? "pending",
        limit: parseIntegerQuery(url.searchParams.get("limit"), 50),
        offset: parseIntegerQuery(url.searchParams.get("offset"), 0),
      }));
    }
    if (resource === "booking" && request.method === "GET") {
      return json({ booking: getAdminBooking(db, bookingId) });
    }
    if (resource === "booking" && request.method === "PATCH") {
      const key = idempotencyKey(request);
      const body = await parseBody(request);
      return json(adjustAdminBooking(db, bookingId, body, {
        actor: "Agent",
        idempotencyKey: key,
      }));
    }
    if (resource === "action" && request.method === "POST") {
      const key = idempotencyKey(request);
      const body = await parseBody(request);
      const options = { actor: "Agent", idempotencyKey: key };
      if (action === "approve") {
        if (Object.keys(body).length) {
          throw new AdminBookingError("VALIDATION_ERROR", "approve does not accept body fields.", 422);
        }
        return json(approveAdminBooking(db, bookingId, options));
      }
      if (action === "reject") {
        const unknown = Object.keys(body).filter((field) => field !== "reason");
        if (unknown.length) {
          throw new AdminBookingError("VALIDATION_ERROR", "reject contains unsupported fields.", 422, { fields: unknown });
        }
        return json(rejectAdminBooking(db, bookingId, { reason: body.reason ?? "" }, options));
      }
      if (action === "adjust-and-approve") {
        return json(adjustAndApproveAdminBooking(db, bookingId, body, options));
      }
    }
    return errorResponse("METHOD_NOT_ALLOWED", "HTTP method is not supported for this resource.", 405);
  } catch (error) {
    if (error instanceof AdminBookingError) {
      return errorResponse(error.code, error.message, error.status, error.details);
    }
    return errorResponse("INTERNAL_ERROR", "The request could not be completed.", 500);
  }
}
