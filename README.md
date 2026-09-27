# EVE Healthcare Diagnostic Booking API

A backend-only REST API for discovering diagnostic tests, creating patient
bookings, simulating payments, and processing payment-provider webhooks. The
service is built around explicit domain rules, PostgreSQL constraints,
transactional state changes, and predictable JSON contracts.

## Capabilities

- User signup and login with Argon2id password hashing and JWT access tokens
- Public retrieval of diagnostic centres, available tests, and INR prices
- Admin-only management of centres, test definitions, and centre offerings
- Authenticated bookings with server-controlled ownership, amount, and status
- Deterministic successful and failed payment simulation
- Idempotent payment-status webhooks with conflict detection
- Durable, bounded retry handling for unexpected webhook-processing failures
- Strict request validation and consistent authorization and error responses
- Structured JSON logs with request correlation IDs
- Transactional SQL migrations and idempotent reference-data seeding
- Automated request, service, edge-case, and concurrency-focused tests
- Docker image and Compose orchestration for PostgreSQL, migration, seed, and API services

## Architecture

```mermaid
flowchart LR
    Client[API client] --> HTTP[Express routes and middleware]
    Provider[Simulated payment provider] --> HTTP
    HTTP --> Controllers[Feature controllers and Zod schemas]
    Controllers --> Services[Domain services]
    Services --> Database[(PostgreSQL)]
    Worker[Webhook retry worker] --> Services
    Worker --> Database
```

The code is organized by feature (`auth`, `diagnostics`, `bookings`, and
`payments`). Each feature keeps HTTP routing, input schemas, controllers, and
database-facing services together:

- Routes define the public HTTP contract and middleware chain.
- Controllers validate input and translate service results into responses.
- Services enforce domain rules and own SQL and transaction boundaries.
- Middleware handles authentication, role authorization, request logging,
  unknown routes, and error serialization.
- `app.js` constructs the Express application without opening a socket, which
  keeps request-level tests isolated.
- `server.js` owns process concerns: configuration, the database pool, network
  startup, the retry worker, structured logging, and graceful shutdown.

PostgreSQL is accessed through `pg` and explicit SQL. Avoiding an ORM keeps
locking, partial indexes, constraints, and transaction behavior visible for
the parts of the system where correctness depends on them.

## Technology stack

| Technology | Responsibility |
| --- | --- |
| JavaScript with Node.js | Application runtime and ES modules |
| Express 5 | HTTP routing and middleware |
| PostgreSQL 16 | Relational persistence, constraints, and row locking |
| `pg` | PostgreSQL connection pooling and parameterized queries |
| Zod | Strict request-body and path-parameter validation |
| Argon2 | Password hashing using Argon2id |
| `jsonwebtoken` | HS256 access-token signing and verification |
| Node test runner + Supertest | Service and HTTP contract tests |
| Docker + Docker Compose | Reproducible API and database environment |

The container image uses Node.js 22 on Debian slim. Application dependencies
are installed with `npm ci --omit=dev`, and the API runs as the non-root
`node` user.

## Key design decisions

| Decision | Reasoning |
| --- | --- |
| Separate tests from centre offerings | A diagnostic test is a reusable definition; `centre_tests` represents availability and centre-specific pricing without duplicating test records. |
| Derive booking fields on the server | The JWT supplies the user, the selected offering supplies the amount, and the server assigns `PENDING`; clients cannot forge ownership, price, or initial status. |
| Expose INR and store integer paise | API consumers use values such as `800`; PostgreSQL stores `80000` to avoid floating-point errors in financial records. |
| Snapshot booking and payment amounts | Later price changes cannot rewrite an existing booking or payment history. |
| Keep public signup non-administrative | Signup always creates a `USER`. Admin access is granted outside the public API, avoiding a public privilege-escalation path. |
| Use database constraints as a second line of validation | Unique, foreign-key, check, and partial-index constraints protect invariants even under concurrent requests. |
| Lock rows during payment and webhook transitions | `FOR UPDATE` serializes competing updates so a booking cannot receive inconsistent final states. |
| Persist webhook receipt before processing | An accepted event survives a processing failure or API restart and can be retried from PostgreSQL. |
| Use bounded database-backed retries | Unexpected webhook failures are attempted at most three times, after 5-second and 30-second delays, without introducing Redis for this assignment-sized service. |
| Keep logs structured and privacy-conscious | Newline-delimited JSON is container-friendly; request bodies, query strings, authorization headers, tokens, passwords, and database credentials are excluded. |

## Running the project

### Docker Compose

Docker Compose is the shortest setup path. From the repository root:

```bash
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
```

Startup is ordered as follows:

```text
PostgreSQL healthy → migrations complete → seed complete → API starts
```

The API is available at `http://localhost:3000`. PostgreSQL is reachable only
inside the Compose network and persists data in the named `postgres_data`
volume. The credentials in `compose.yaml` are local-development values.

Useful commands:

```bash
docker compose ps
docker compose logs --follow api
docker compose down
```

`docker compose down` preserves the database volume.

### Manual setup

Requirements: Node.js 22 or later, npm, and PostgreSQL.

```bash
cd backend
npm ci
cp .env.example .env
```

Create a PostgreSQL database named `eve`, then update `backend/.env` for the
local role and password:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/eve
JWT_SECRET=replace-with-a-long-random-string
```

Apply the schema, load reference data, and start the API:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Migrations are recorded in `schema_migrations` and each migration runs in a
transaction. The seed command inserts missing reference records without
duplicating data or overwriting later administrative changes.

### Seed catalogue

The seed contains five centres across Pune, Mumbai, New Delhi, Bengaluru, and
Hyderabad; eight shared diagnostic tests; and 33 centre-specific offerings.
It creates no users, credentials, bookings, payments, or webhook history.

Seeded tests include Complete Blood Count, Thyroid Profile, HbA1c, Lipid
Profile, Liver Function Test, Kidney Function Test, Vitamin D, and Vitamin B12.
Use `GET /api/v1/diagnostic-centres` to inspect the complete catalogue and its
centre-specific INR prices.

### Creating an admin locally

Public signup deliberately creates only `USER` accounts. After signing up,
promote the account directly in PostgreSQL and log in again so the new JWT
contains the `ADMIN` role.

With Docker Compose:

```bash
docker compose exec database psql -U postgres -d eve \
  -c "UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com';"
```

With a manual PostgreSQL setup:

```sql
UPDATE users
SET role = 'ADMIN'
WHERE email = 'admin@example.com';
```

## API contract

All application endpoints use JSON. Successful responses use a `data`
envelope; errors use a stable `error` object. Protected endpoints expect:

```http
Authorization: Bearer <access-token>
```

API prices and amounts are numeric INR values. Timestamps are ISO 8601 values
with a timezone offset. Unknown request fields are rejected.

### Endpoint summary

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Process liveness check |
| `POST` | `/api/v1/auth/signup` | Public | Create a `USER` account |
| `POST` | `/api/v1/auth/login` | Public | Authenticate and receive a JWT |
| `GET` | `/api/v1/diagnostic-centres` | Public | Retrieve active centres, available tests, and prices |
| `POST` | `/api/v1/diagnostic-centres` | Admin | Create a diagnostic centre |
| `POST` | `/api/v1/diagnostic-tests` | Admin | Create a diagnostic test definition |
| `PUT` | `/api/v1/diagnostic-centres/:centreId/tests/:testId` | Admin | Create or re-enable an offering and set its price |
| `POST` | `/api/v1/bookings` | User/Admin | Create a booking owned by the authenticated account |
| `POST` | `/api/v1/payments` | Booking owner | Simulate a successful or failed payment attempt |
| `POST` | `/api/v1/payments/webhook` | Simulated provider | Apply an idempotent payment-status event |

### Endpoint reference

Set the base URL used by the examples:

```bash
BASE_URL=http://localhost:3000
```

#### Health check

`GET /health` — Public — Success: `200 OK`

```bash
curl "$BASE_URL/health"
```

Response:

```json
{
  "status": "ok"
}
```

#### Create an account

`POST /api/v1/auth/signup` — Public — Success: `201 Created`

```bash
curl --request POST "$BASE_URL/api/v1/auth/signup" \
  --header 'Content-Type: application/json' \
  --data '{
    "fullName": "Asha Rao",
    "email": "asha@example.com",
    "password": "secure-password"
  }'
```

Response:

```json
{
  "data": {
    "user": {
      "id": "b565d12c-53b8-4c98-8864-50de03d780fc",
      "fullName": "Asha Rao",
      "email": "asha@example.com",
      "role": "USER",
      "createdAt": "2026-09-27T08:00:00.000Z"
    }
  }
}
```

Only `fullName`, `email`, and `password` are accepted. Email addresses are
normalized to lowercase, passwords are stored as Argon2id hashes, and public
signup cannot assign administrative privileges. Invalid input returns `400`;
an existing email returns `409`.

#### Log in

`POST /api/v1/auth/login` — Public — Success: `200 OK`

```bash
curl --request POST "$BASE_URL/api/v1/auth/login" \
  --header 'Content-Type: application/json' \
  --data '{
    "email": "asha@example.com",
    "password": "secure-password"
  }'
```

Response:

```json
{
  "data": {
    "user": {
      "id": "b565d12c-53b8-4c98-8864-50de03d780fc",
      "fullName": "Asha Rao",
      "email": "asha@example.com",
      "role": "USER",
      "createdAt": "2026-09-27T08:00:00.000Z"
    },
    "accessToken": "<signed-jwt>",
    "tokenType": "Bearer",
    "expiresIn": 3600
  }
}
```

Access tokens expire after one hour. Unknown emails and incorrect passwords
both return `401` without revealing whether an account exists.

#### List diagnostic centres

`GET /api/v1/diagnostic-centres` — Public — Success: `200 OK`

```bash
curl "$BASE_URL/api/v1/diagnostic-centres"
```

Response:

```json
{
  "data": {
    "centres": [
      {
        "id": "54a43c3e-51de-464e-9205-9f6d87443688",
        "name": "EVE Diagnostics",
        "location": "Pune, Maharashtra",
        "tests": [
          {
            "id": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
            "name": "Complete Blood Count",
            "price": 800
          }
        ]
      }
    ]
  }
}
```

Only active centres, available centre-test offerings, and active tests are
returned. A centre with no available tests has an empty `tests` array. Prices
are numeric INR values.

#### Create a diagnostic centre

`POST /api/v1/diagnostic-centres` — Admin — Success: `201 Created`

```bash
curl --request POST "$BASE_URL/api/v1/diagnostic-centres" \
  --header 'Authorization: Bearer <admin-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "EVE Diagnostics",
    "location": "Chennai, Tamil Nadu"
  }'
```

Response:

```json
{
  "data": {
    "centre": {
      "id": "2ec1f8e0-e892-45e8-9b77-e4cf3af01bb3",
      "name": "EVE Diagnostics",
      "location": "Chennai, Tamil Nadu",
      "tests": []
    }
  }
}
```

Missing authentication returns `401`, a non-admin token returns `403`, and a
duplicate name/location pair returns `409`.

#### Create a diagnostic test

`POST /api/v1/diagnostic-tests` — Admin — Success: `201 Created`

```bash
curl --request POST "$BASE_URL/api/v1/diagnostic-tests" \
  --header 'Authorization: Bearer <admin-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "Electrolyte Panel"
  }'
```

Response:

```json
{
  "data": {
    "test": {
      "id": "8146a349-4e72-41e3-83ca-aec0e82fc975",
      "name": "Electrolyte Panel"
    }
  }
}
```

Missing authentication returns `401`, a non-admin token returns `403`, and a
duplicate test name returns `409`.

#### Set a centre's test offering

`PUT /api/v1/diagnostic-centres/:centreId/tests/:testId` — Admin — Success:
`200 OK`

Path parameters:

- `centreId`: diagnostic centre UUID
- `testId`: diagnostic test UUID

```bash
curl --request PUT \
  "$BASE_URL/api/v1/diagnostic-centres/2ec1f8e0-e892-45e8-9b77-e4cf3af01bb3/tests/8146a349-4e72-41e3-83ca-aec0e82fc975" \
  --header 'Authorization: Bearer <admin-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "price": 850
  }'
```

Response:

```json
{
  "data": {
    "offering": {
      "centreId": "2ec1f8e0-e892-45e8-9b77-e4cf3af01bb3",
      "testId": "8146a349-4e72-41e3-83ca-aec0e82fc975",
      "price": 850,
      "isAvailable": true
    }
  }
}
```

`price` is supplied and returned in INR. Repeating the request updates the
price and marks the offering as available. An unknown centre or test returns
`404`.

#### Create a booking

`POST /api/v1/bookings` — Authenticated — Success: `201 Created`

```bash
curl --request POST "$BASE_URL/api/v1/bookings" \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "centreId": "54a43c3e-51de-464e-9205-9f6d87443688",
    "testId": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
    "appointmentAt": "2030-10-10T10:30:00.000Z"
  }'
```

Response:

```json
{
  "data": {
    "booking": {
      "id": "18fd3f4c-f1c0-4b33-882b-5d6d3e224815",
      "userId": "b565d12c-53b8-4c98-8864-50de03d780fc",
      "centreId": "54a43c3e-51de-464e-9205-9f6d87443688",
      "testId": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
      "appointmentAt": "2030-10-10T10:30:00.000Z",
      "amount": 800,
      "status": "PENDING",
      "createdAt": "2026-09-27T08:00:00.000Z"
    }
  }
}
```

The authenticated user is taken from the JWT. The amount is read from the
active centre-test offering and snapshotted on the booking; clients cannot set
the owner, amount, or initial status. An unavailable offering returns `404`, a
duplicate active booking returns `409`, and an invalid or past appointment
returns `400`.

#### Process a simulated payment

`POST /api/v1/payments` — Booking owner — Success: `201 Created`

```bash
curl --request POST "$BASE_URL/api/v1/payments" \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "bookingId": "18fd3f4c-f1c0-4b33-882b-5d6d3e224815",
    "simulateOutcome": "SUCCESS"
  }'
```

Response:

```json
{
  "data": {
    "payment": {
      "id": "690028f1-c847-4925-a311-fdd5b576115b",
      "bookingId": "18fd3f4c-f1c0-4b33-882b-5d6d3e224815",
      "providerReference": "mock_24c37900-a776-4a70-a8a9-4efb4fcc2dcc",
      "attemptNumber": 1,
      "amount": 800,
      "status": "SUCCESS",
      "createdAt": "2026-09-27T08:05:00.000Z"
    },
    "booking": {
      "id": "18fd3f4c-f1c0-4b33-882b-5d6d3e224815",
      "status": "CONFIRMED"
    }
  }
}
```

`simulateOutcome` accepts `SUCCESS` or `FAILED`. Success changes the booking to
`CONFIRMED`; failure changes it to `FAILED`. A failed booking can be retried,
while confirmed and cancelled bookings reject further attempts. An unknown
booking returns `404`; a booking owned by another user returns `403`.

#### Process a payment webhook

`POST /api/v1/payments/webhook` — Simulated provider — Success: `200 OK`

```bash
curl --request POST "$BASE_URL/api/v1/payments/webhook" \
  --header 'Content-Type: application/json' \
  --data '{
    "eventId": "event_123",
    "providerReference": "mock_24c37900-a776-4a70-a8a9-4efb4fcc2dcc",
    "status": "SUCCESS"
  }'
```

Response:

```json
{
  "data": {
    "event": {
      "eventId": "event_123",
      "processingStatus": "PROCESSED",
      "duplicate": false
    },
    "payment": {
      "id": "690028f1-c847-4925-a311-fdd5b576115b",
      "status": "SUCCESS"
    },
    "booking": {
      "id": "18fd3f4c-f1c0-4b33-882b-5d6d3e224815",
      "status": "CONFIRMED"
    }
  }
}
```

The webhook does not use a user JWT because it represents the simulated
provider. The first successful processing returns `200`. An unexpected,
recoverable failure returns `202` with `RETRY_PENDING`, `attemptCount`, and
`nextAttemptAt`. Repeating an already processed event returns `200` with
`duplicate: true` and does not reapply the transition. Reusing an event ID for
different payment data returns `409`; an unknown provider reference returns
`404`.

### Error format

Expected failures use HTTP status codes and machine-readable error codes:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "appointmentAt",
        "message": "Appointment date/time must be in the future"
      }
    ]
  }
}
```

The API distinguishes validation errors, missing or invalid authentication,
forbidden ownership or roles, missing resources, duplicate/conflicting state,
invalid JSON, unknown routes, and unexpected server errors.

## Domain and database design

```mermaid
erDiagram
    USERS ||--o{ BOOKINGS : creates
    DIAGNOSTIC_CENTRES ||--o{ CENTRE_TESTS : offers
    DIAGNOSTIC_TESTS ||--o{ CENTRE_TESTS : defines
    CENTRE_TESTS ||--o{ BOOKINGS : selected_for
    BOOKINGS ||--o{ PAYMENTS : has_attempts
    PAYMENTS ||--o{ WEBHOOK_EVENTS : receives
```

| Table | Responsibility |
| --- | --- |
| `users` | Identity, password hash, and `USER`/`ADMIN` role |
| `diagnostic_centres` | Centre name, location, and active state |
| `diagnostic_tests` | Shared diagnostic-test definitions |
| `centre_tests` | Centre/test relationship, availability, and exact price |
| `bookings` | User, offering, appointment, amount snapshot, and lifecycle state |
| `payments` | Payment-attempt sequence, provider reference, amount snapshot, and status |
| `webhook_events` | Provider event identity, payload, processing state, retry schedule, and last error |

Important database invariants include:

- Normalized, unique user emails
- Case-insensitive uniqueness for centre name/location pairs and test names
- One offering per centre/test pair
- Positive prices and booking/payment amounts
- Enumerated role and lifecycle values through check constraints
- No duplicate active booking for the same user, offering, and appointment
- At most one successful payment per booking
- Unique provider references and provider event IDs
- Restricted deletion of referenced clinical and financial records
- Indexed booking lookup, appointment lookup, payment lookup, and retry queues

### State transitions

| Resource | States | Transition rules |
| --- | --- | --- |
| Booking | `PENDING`, `CONFIRMED`, `FAILED`, `CANCELLED` | Creation starts at `PENDING`; payment success confirms; payment failure fails; cancelled bookings reject payment confirmation. |
| Payment | `PENDING`, `SUCCESS`, `FAILED` | The simulated payment endpoint records a final success/failure; webhook processing can safely reconcile a pending or matching final status. |
| Webhook event | `PENDING`, `PROCESSING`, `PROCESSED`, `RETRY_PENDING`, `EXHAUSTED` | Receipt is durable; successful processing is final; unexpected failures retry within the configured bound. |

## Reliability and edge-case handling

- Zod schemas reject malformed UUIDs, timestamps, enum values, unknown fields,
  invalid prices, signup passwords outside the allowed length, and past
  appointments.
- JWT middleware validates the bearer format, signature, expiry, subject, role,
  and allowed signing algorithm.
- Admin middleware protects catalogue changes; booking ownership protects
  payment attempts.
- Payment attempts lock the booking row and update payment plus booking state in
  one transaction.
- Webhook processing locks the event, payment, and booking rows before applying
  a transition.
- Webhook receipt is unique by provider event ID. Identical replays are no-ops;
  conflicting reuse is rejected.
- Unexpected webhook-processing failures are retried after 5 and 30 seconds.
  The third failed attempt marks the event `EXHAUSTED`; validation and business
  conflicts are terminal and are not retried.
- Pending retry state lives in PostgreSQL, so it survives API restarts.
- Request logs include timestamp, level, event, request ID, method, path, status,
  and duration. A valid incoming `X-Request-Id` is preserved; otherwise a UUID
  is generated and returned in the response.

Example request log:

```json
{"timestamp":"2026-09-27T10:00:00.000Z","level":"info","event":"http.request.completed","requestId":"75e64077-216d-42b1-8feb-870d6d5a6214","method":"POST","path":"/api/v1/bookings","statusCode":201,"durationMs":12.4}
```

## Testing

```bash
cd backend
npm test
```

The suite uses Node's test runner and Supertest. Request-level tests exercise
the Express application without opening the development server, while
controlled database doubles isolate service behavior and failure paths.

Coverage includes authentication, authorization, strict validation, duplicate
resources, booking ownership and amount derivation, unavailable offerings,
payment success/failure/retry behavior, idempotent and conflicting webhooks,
bounded retry scheduling and exhaustion, structured logging, request
correlation, and consistent JSON 404 handling.

## Assumptions and boundaries

- The deliverable is a backend service; a frontend is outside the assignment
  scope.
- Payments and provider webhooks are simulated. No real gateway or credentials
  are used.
- The assignment does not specify a currency, so public amounts are treated as
  INR and stored internally as integer paise.
- Public signup creates `USER` accounts only. There is intentionally no public
  admin-registration endpoint.
- JWT access tokens expire after one hour. Refresh tokens, revocation, email
  verification, and password reset are outside the current scope.
- Appointment timestamps must be in the future and include a timezone offset.
- `CANCELLED` is part of the booking model and is protected from later payment
  confirmation, but a cancellation endpoint was not required and is not
  exposed.
- The webhook endpoint represents a simulated provider and therefore does not
  use user JWT authentication. A real provider integration would authenticate
  webhook signatures.
- `/health` is a process-liveness endpoint; it does not perform a database
  readiness query.

## Improvements with more time

- Add booking retrieval, cancellation, and rescheduling endpoints with explicit
  rules for which booking states can transition.
- Extend catalogue administration with update and deactivate operations for
  centres, tests, and centre-specific offerings.
- Add filtering and pagination to catalogue retrieval as the reference dataset
  grows.

## Project layout

```text
.
├── compose.yaml                 # Local PostgreSQL and application stack
└── backend/
    ├── db/
    │   ├── migrations/          # Ordered SQL schema migrations
    │   ├── migrate.js           # Transactional migration runner
    │   └── seed.js              # Idempotent reference catalogue
    ├── src/
    │   ├── auth/                # Signup, login, and JWT support
    │   ├── bookings/            # Authenticated booking creation
    │   ├── diagnostics/         # Centre, test, and offering APIs
    │   ├── middleware/          # Auth, roles, logging, 404, and errors
    │   ├── payments/            # Payments, webhooks, and retry worker
    │   ├── app.js               # Express composition
    │   ├── database.js          # PostgreSQL pool factory
    │   ├── logger.js            # Structured JSON logger
    │   └── server.js            # Runtime lifecycle
    ├── test/                    # Automated test suite
    ├── .env.example
    ├── Dockerfile
    ├── package.json
    └── package-lock.json
```
