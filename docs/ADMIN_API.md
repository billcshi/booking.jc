# AI Agent Admin API v1

This private, versioned machine API is for a trusted AI Agent operating booking.jc on
behalf of the Host. It is not a browser UI, a public API, or a general third-party
integration surface. It exposes booking operations only; it does not expose SQL,
tables, management tokens, guest keys, or arbitrary database access.

The API uses the application's existing listener and deployment boundary. It does not
open another port or change Docker's published address. Keep the application behind
HTTPS and the existing firewall, VPN, private reverse proxy, or other trusted-network
boundary. Where the main site is internet-accessible, the deployment must restrict
`/api/admin/v1/` at the reverse proxy or firewall to the Agent's trusted network.

## Authentication and token lifecycle

Set `AGENT_TOKEN` in the ignored `.env` file. It is independent from
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, group keys, invitation keys, and
booking management tokens. Generate at least 32 cryptographically random characters:

```bash
openssl rand -hex 32
```

Store the output directly in `.env` without adding quotes or whitespace:

```dotenv
AGENT_TOKEN=replace-with-generated-secret
```

Restart the application after adding or changing the value. To rotate it, generate a
new value, replace the old value atomically in `.env`, restart the service, verify a
read request with the new token, then remove the old value from the Agent's secret
store. Only one token is active, so the old token stops working after restart. The
deployment helpers add a missing token to `.env` without printing it.

Send the token on every request:

```http
Authorization: Bearer <AGENT_TOKEN>
```

Missing and incorrect tokens receive the same `401` JSON response. Authentication
uses constant-time digest comparison. The token is never returned, audited, or
intentionally logged. Do not put it in source code, prompts, chat messages, shell
history, URLs, or monitoring labels.

## Date and retry semantics

`startsOn` and `endsOn` are ISO `YYYY-MM-DD` calendar dates for the stay. Arrival is
inclusive and departure is exclusive. Resource timestamps (`createdAt` and `updatedAt`)
are ISO 8601 UTC timestamps ending in `Z`.

Every write requires an `Idempotency-Key` header containing 8 to 128 letters, digits,
periods, underscores, colons, or hyphens. A UUID is recommended. Retrying the same
operation and canonical JSON body with the same key returns the original operation
result with `result.idempotentReplay: true` and does not repeat the mutation or audit
entry. The `booking` field is refreshed from the current resource at replay time rather
than retained as a second private snapshot. Reusing
the key for a different booking, action, or body returns `409 IDEMPOTENCY_KEY_REUSED`.
Idempotency records store only booking ID plus action, actor, and summary. They survive
application restarts for 30 days and are removed opportunistically during startup and
subsequent writes. A retry after expiry is treated as a new request and remains subject
to the current booking state.

The application also applies a bounded in-process rate limit per client fingerprint:
30 unauthenticated requests and 300 authenticated requests per minute. A limited
request receives `429 RATE_LIMITED` and `Retry-After`. Restarting the process resets
these counters, so this is defense in depth and does not replace the required network
restriction. Set `TRUST_PROXY=1` only behind a proxy that removes and rewrites incoming
forwarding headers.

## Endpoints

### List bookings

```http
GET /api/admin/v1/bookings?status=pending&limit=50&offset=0
```

`status` defaults to `pending` and accepts `pending`, `approved`, `rejected`,
`cancelled`, or `all`. `limit` defaults to 50 and is capped at 100.

```json
{
  "items": [],
  "count": 0,
  "pagination": { "limit": 50, "offset": 0, "total": 0 }
}
```

### Read one booking

```http
GET /api/admin/v1/bookings/28
```

```json
{
  "booking": {
    "id": 28,
    "status": "pending",
    "stay": { "id": 1, "name": "Home" },
    "startsOn": "2030-07-10",
    "endsOn": "2030-07-12",
    "dateSemantics": "arrival_inclusive_departure_exclusive",
    "partySize": 2,
    "exclusive": false,
    "sleepingPreferences": {
      "acceptsSofa": true,
      "acceptsAirMattress": false
    },
    "applicant": { "guestName": "Guest" },
    "notes": { "guest": null, "host": null },
    "rejectionReason": null,
    "allocations": [],
    "createdAt": "2030-07-01T12:00:00Z",
    "updatedAt": "2030-07-01T12:00:00Z",
    "validation": { "status": "clear", "canApprove": true, "conflicts": [] }
  }
}
```

The resource intentionally omits contact details, the guest's management token,
invitation key, exact stay location, soft-deletion fields, database names, and other
unrelated private data. `validation` is a current
preview; the write transaction always reruns all checks.

### Approve

Only a `pending` booking may be approved. Capacity, blackout, stay-bound, exclusive,
consent, and allocation checks run in the same immediate transaction.

```http
POST /api/admin/v1/bookings/28/approve
Idempotency-Key: 2b34b3a4-47ed-4eaa-a5f3-c5d55e93bb16
Content-Type: application/json

{}
```

### Reject

Only a `pending` booking may be rejected. `reason` is optional, limited to 1000
characters, and stored separately from the public guest note.

```http
POST /api/admin/v1/bookings/28/reject
Idempotency-Key: 373f43ca-3c53-42b2-826b-ea2a02245ee2
Content-Type: application/json

{ "reason": "Dates are unavailable" }
```

### Adjust

`PATCH` accepts any non-empty subset of the fields below. It does not accept `status`,
stay IDs, allocation IDs, management tokens, or database fields.

| Field | Type and limits |
| --- | --- |
| `guestName` | non-empty string, at most 80 characters |
| `startsOn`, `endsOn` | valid `YYYY-MM-DD`; maximum range 3650 nights |
| `partySize` | integer from 1 through 8 |
| `acceptsSofa`, `acceptsAirMattress`, `exclusive` | boolean |
| `note`, `hostNote` | string, at most 1000 characters |

Pending and approved bookings may be adjusted. Adjusting an approved booking deletes
and recreates its allocation in the same transaction; failure restores all original
fields and allocations. Rejected and cancelled bookings cannot be adjusted through
the Agent API.

```http
PATCH /api/admin/v1/bookings/28
Idempotency-Key: 7acd6037-79c7-455b-b2dd-da07fa295822
Content-Type: application/json

{ "startsOn": "2030-07-11", "endsOn": "2030-07-13", "partySize": 3 }
```

### Adjust and approve

This is the preferred single operation when the Host approves with changes. The
booking must be `pending`. Field update, validation, allocation, status transition,
audit, and idempotency result are committed atomically.

```http
POST /api/admin/v1/bookings/28/adjust-and-approve
Idempotency-Key: f978e029-3af0-426c-a37a-a40d72a153df
Content-Type: application/json

{ "startsOn": "2030-07-11", "endsOn": "2030-07-13", "partySize": 3 }
```

All successful writes return the full post-operation resource:

```json
{
  "booking": { "id": 28, "status": "approved" },
  "result": {
    "action": "adjusted_and_approved",
    "actor": "Agent",
    "summary": "Booking #28 was adjusted, approved, and allocated atomically.",
    "idempotentReplay": false
  }
}
```

## curl examples

Load the token from the Agent's secret store into `AGENT_TOKEN`; do not paste the
literal token into shared terminals or saved command history.

```bash
base_url=http://127.0.0.1:3000
idempotency_key=$(openssl rand -hex 16)
curl -fsS \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  "${base_url}/api/admin/v1/bookings?status=pending"

curl -fsS -X POST \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Idempotency-Key: ${idempotency_key}" \
  -H "Content-Type: application/json" \
  --data '{}' \
  "${base_url}/api/admin/v1/bookings/28/approve"

curl -fsS -X POST \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Idempotency-Key: $(openssl rand -hex 16)" \
  -H "Content-Type: application/json" \
  --data '{"partySize":3,"endsOn":"2030-07-13"}' \
  "${base_url}/api/admin/v1/bookings/28/adjust-and-approve"
```

For a retry, reuse both the original JSON and its original `Idempotency-Key`; do not
generate a new key.

## Error contract

Every error is JSON and does not contain stack traces, SQL, schema details, or secrets:

```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "Booking conflicts with an exclusive approved booking.",
    "details": { "kind": "exclusive", "conflictingBookingIds": [27] }
  }
}
```

| HTTP | Common codes |
| --- | --- |
| `400` | `INVALID_BOOKING_ID`, `INVALID_QUERY`, `INVALID_JSON`, `INVALID_IDEMPOTENCY_KEY`, `REQUEST_TOO_LARGE` |
| `401` | `UNAUTHORIZED` |
| `404` | `BOOKING_NOT_FOUND` |
| `429` | `RATE_LIMITED` |
| `409` | `BLACKOUT_CONFLICT`, `BOOKING_CONFLICT`, `CAPACITY_CONFLICT`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED` |
| `422` | `VALIDATION_ERROR`, `OUTSIDE_STAY_DATES`, `ALLOCATION_INVALID` |
| `500` | `SERVICE_MISCONFIGURED`, `INTERNAL_ERROR` |

Write audit entries record UTC time, action, booking ID, caller (`Agent`), and
privacy-minimized before/after operational summaries. Guest names, contact details,
notes, rejection reasons, credentials, and tokens are excluded from audit summaries.
