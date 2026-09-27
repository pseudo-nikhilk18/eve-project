# EVE Healthcare Diagnostic Booking API

A backend service for booking diagnostic tests and processing simulated
payments. The implementation emphasizes API design, database integrity,
edge-case handling, tests, and maintainable code.

## Requirements

### Core capabilities

- User signup and login
- JWT-based authentication
- Request validation
- Diagnostic centre and test management
- Diagnostic centre and test retrieval
- Authenticated diagnostic-test bookings
- Simulated successful and failed payments
- Idempotent payment-status webhooks
- Validation, authorization, and failure edge cases

### Delivery and quality

- Docker and Docker Compose
- Automated unit and integration tests
- OpenAPI documentation
- Structured application logging
- Bounded retry handling for webhook processing

## Technology

- JavaScript
- Node.js
- Express.js
- PostgreSQL
- `pg` for PostgreSQL access
- `jsonwebtoken` for access-token signing and verification
- Plain SQL migrations

## Run locally

### Docker Compose

Docker Compose starts PostgreSQL, applies pending migrations, loads the
diagnostic catalogue through one-shot containers, and starts the API:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000`. PostgreSQL stores its data in
the named `postgres_data` volume and is not published to a host port. The
Compose credentials and fallback JWT secret are for local development only.
Override the secret when needed:

```bash
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
```

Follow API logs or stop the stack with:

```bash
docker compose logs --follow api
docker compose down
```

`docker compose down` preserves the database volume.

### Manual setup

Prerequisites:

- Node.js
- npm
- PostgreSQL

#### Install dependencies

```bash
cd backend
npm install
```

#### Configure PostgreSQL

Create a PostgreSQL database, then copy the example environment file:

```bash
cd backend
cp .env.example .env
```

Update `DATABASE_URL` in `.env` if the local connection details differ. Replace
`JWT_SECRET` with a private random value; for example, one can be generated
with `openssl rand -hex 32`. Apply all pending migrations with:

```bash
npm run db:migrate
npm run db:seed
```

Each migration runs in a transaction and is recorded in `schema_migrations`.
Re-running the migration or seed command is safe: applied migrations are
skipped, and existing seed records are not duplicated or overwritten.

#### Start the API

```bash
cd backend
npm run dev
```

The API listens on `http://localhost:3000` by default. Set `PORT` to use a
different port.

### Run tests

```bash
cd backend
npm test
```

Integration tests exercise the Express application directly without starting
the development server.

## Structured logging

The API writes newline-delimited JSON records to standard output. HTTP request
records include a correlation ID, method, path, response status, and duration:

```json
{"timestamp":"2026-09-27T10:00:00.000Z","level":"info","event":"http.request.completed","requestId":"75e64077-216d-42b1-8feb-870d6d5a6214","method":"POST","path":"/api/v1/bookings","statusCode":201,"durationMs":12.4}
```

A caller can supply an `X-Request-Id` containing letters, numbers, `.`, `_`,
`:`, or `-`; otherwise, the API generates a UUID. The selected ID is returned
in the response header and included in request-related error records. Server
lifecycle and webhook retry-worker events use the same JSON format. Request
bodies, query strings, authorization headers, tokens, passwords, and database
credentials are not logged.

## API endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Confirm that the API process is running |
| `POST` | `/api/v1/auth/signup` | No | Create a user account |
| `POST` | `/api/v1/auth/login` | No | Authenticate and receive an access token |
| `GET` | `/api/v1/diagnostic-centres` | No | List active centres, tests, and prices |
| `POST` | `/api/v1/diagnostic-centres` | Admin | Create a diagnostic centre |
| `POST` | `/api/v1/diagnostic-tests` | Admin | Create a diagnostic test |
| `PUT` | `/api/v1/diagnostic-centres/:centreId/tests/:testId` | Admin | Set a centre's test price and availability |
| `POST` | `/api/v1/bookings` | User | Create a diagnostic-test booking |
| `POST` | `/api/v1/payments` | User | Simulate a payment for the user's booking |
| `POST` | `/api/v1/payments/webhook` | Simulated provider | Apply an idempotent payment-status event |

### Health check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok"
}
```

### Create an account

```bash
curl --request POST http://localhost:3000/api/v1/auth/signup \
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

The signup endpoint accepts only `fullName`, `email`, and `password`. Email
addresses are normalized to lowercase, passwords are stored as Argon2id hashes,
and public signup cannot assign administrative privileges.

### Log in

```bash
curl --request POST http://localhost:3000/api/v1/auth/login \
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

Access tokens expire after one hour. Protected endpoints accept the token in
the `Authorization: Bearer <token>` header. Unknown emails and incorrect
passwords return the same response so the endpoint does not reveal whether an
account exists.

To exercise admin-only endpoints locally, promote an existing account in
PostgreSQL, then log in again to receive a token containing the updated role:

```sql
UPDATE users
SET role = 'ADMIN'
WHERE email = 'asha@example.com';
```

### List diagnostic centres

```bash
curl http://localhost:3000/api/v1/diagnostic-centres
```

Response:

```json
{
  "data": {
    "centres": [
      {
        "id": "54a43c3e-51de-464e-9205-9f6d87443688",
        "name": "EVE Diagnostics",
        "location": "Pune",
        "tests": [
          {
            "id": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
            "name": "Complete Blood Count",
            "price": 500
          }
        ]
      }
    ]
  }
}
```

Only active centres, available centre-test offerings, and active diagnostic
tests are returned. A centre with no available tests has an empty `tests`
array. Prices returned by the API are in INR.

### Create a diagnostic centre

This endpoint requires an admin access token.

```bash
curl --request POST http://localhost:3000/api/v1/diagnostic-centres \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "EVE Diagnostics",
    "location": "Pune"
  }'
```

Response:

```json
{
  "data": {
    "centre": {
      "id": "54a43c3e-51de-464e-9205-9f6d87443688",
      "name": "EVE Diagnostics",
      "location": "Pune",
      "tests": []
    }
  }
}
```

### Create a diagnostic test

This endpoint requires an admin access token.

```bash
curl --request POST http://localhost:3000/api/v1/diagnostic-tests \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "Complete Blood Count"
  }'
```

Response:

```json
{
  "data": {
    "test": {
      "id": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
      "name": "Complete Blood Count"
    }
  }
}
```

### Add a test to a diagnostic centre

This endpoint requires an admin access token. `price` is supplied and returned
in INR. Repeating the request updates the price and marks the offering as
available.

```bash
curl --request PUT \
  http://localhost:3000/api/v1/diagnostic-centres/54a43c3e-51de-464e-9205-9f6d87443688/tests/c9c9f963-1199-49a0-bc20-f42771b6f7cf \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "price": 4000
  }'
```

Response:

```json
{
  "data": {
    "offering": {
      "centreId": "54a43c3e-51de-464e-9205-9f6d87443688",
      "testId": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
      "price": 4000,
      "isAvailable": true
    }
  }
}
```

### Create a booking

This endpoint requires a valid access token.

```bash
curl --request POST http://localhost:3000/api/v1/bookings \
  --header 'Authorization: Bearer <access-token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "centreId": "54a43c3e-51de-464e-9205-9f6d87443688",
    "testId": "c9c9f963-1199-49a0-bc20-f42771b6f7cf",
    "appointmentAt": "2026-10-10T10:30:00.000Z"
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
      "appointmentAt": "2026-10-10T10:30:00.000Z",
      "amount": 4000,
      "status": "PENDING",
      "createdAt": "2026-09-27T08:00:00.000Z"
    }
  }
}
```

The authenticated user is taken from the access token. The amount is read from
the active centre-test offering and stored on the booking so later price changes
cannot alter it. Clients cannot set the booking owner, amount, or status.

### Process a simulated payment

This endpoint requires a valid access token belonging to the booking owner.
`simulateOutcome` is explicit so both mock outcomes can be tested reliably.

```bash
curl --request POST http://localhost:3000/api/v1/payments \
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
      "amount": 4000,
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

A successful payment changes the booking to `CONFIRMED`; a failed payment
changes it to `FAILED`. Failed bookings can be retried, while `CONFIRMED` and
`CANCELLED` bookings reject further payment attempts. Payment creation and the
booking-status update run in one database transaction.

### Process a payment webhook

The webhook represents a callback from the simulated payment provider and does
not use a user access token.

```bash
curl --request POST http://localhost:3000/api/v1/payments/webhook \
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

`eventId` is unique. Repeating an already processed event returns `200` with
`duplicate` set to `true` and does not apply the payment or booking update
again. Reusing an event ID with different payment data returns `409`.

The event receipt is committed before its payment update is attempted. If an
unexpected processing failure occurs, the endpoint returns `202` with
`processingStatus` set to `RETRY_PENDING`, together with `attemptCount` and
`nextAttemptAt`. A database-backed worker retries after 5 seconds and then 30
seconds. Processing stops after three total attempts and marks the event
`EXHAUSTED`. Validation errors and payment or booking status conflicts are
terminal and are not retried.

Each processing attempt updates the webhook event, payment, and booking in one
transaction. Pending retries remain in PostgreSQL, so they survive an API
restart. Concurrent deliveries remain safe because processing locks the event,
payment, and booking rows and rechecks the event state before applying changes.

## Database design

### Tables

| Table | Responsibility |
| --- | --- |
| `users` | Authentication identity and `USER` or `ADMIN` authorization role |
| `diagnostic_centres` | Centre name, location, and active state |
| `diagnostic_tests` | Shared diagnostic-test definitions |
| `centre_tests` | Centre-specific availability and price for a test |
| `bookings` | Patient booking, appointment, amount snapshot, and lifecycle status |
| `payments` | Individual payment attempts for a booking |
| `webhook_events` | Idempotent webhook receipt and retry-processing state |

### Seed data

The seed command creates a representative reference catalogue with five
centres, eight shared diagnostic tests, and 33 centre-specific offerings. This
allows centre retrieval and booking flows to be exercised immediately:

| Centre | Location | Available tests and INR prices |
| --- | --- | --- |
| EVE Diagnostics | Pune, Maharashtra | Complete Blood Count — 800; Thyroid Profile — 1200; HbA1c — 650; Lipid Profile — 1000; Liver Function Test — 1100; Kidney Function Test — 1050; Vitamin D — 1700 |
| EVE Diagnostics | Mumbai, Maharashtra | Complete Blood Count — 900; Thyroid Profile — 1300; HbA1c — 700; Lipid Profile — 1100; Liver Function Test — 1200; Vitamin D — 1800; Vitamin B12 — 1500 |
| EVE Diagnostics | New Delhi, Delhi | Complete Blood Count — 750; Thyroid Profile — 1150; HbA1c — 625; Lipid Profile — 950; Kidney Function Test — 1000; Vitamin B12 — 1400 |
| EVE Diagnostics | Bengaluru, Karnataka | Complete Blood Count — 850; Thyroid Profile — 1250; HbA1c — 675; Liver Function Test — 1150; Kidney Function Test — 1100; Vitamin D — 1750; Vitamin B12 — 1450 |
| EVE Diagnostics | Hyderabad, Telangana | Complete Blood Count — 700; Thyroid Profile — 1100; HbA1c — 600; Lipid Profile — 900; Liver Function Test — 1000; Kidney Function Test — 950 |

It does not create users, admin credentials, bookings, payments, or webhook
events. Existing centre, test, and offering records are left unchanged when the
seed is run again.

### Shared tests and centre-specific offerings

A diagnostic test is a reusable medical-test definition, while a centre's
offering represents that test being available at a particular diagnostic
centre. They are modeled separately:

- `diagnostic_tests` stores the shared test definition.
- `centre_tests` connects a test to a centre and stores the centre-specific
  price.
- `bookings` references the selected centre offering and stores a snapshot
  of the charged amount.

This prevents the same test from being duplicated for every centre, allows each
centre to set its own price, and ensures that a later price change cannot alter
the financial record of an existing booking.

Prices and payment amounts are represented as integer paise. This avoids
floating-point rounding errors in JavaScript and makes financial comparisons
exact.

### Integrity rules

- Emails are normalized to lowercase and unique.
- Centre name and location pairs are unique without case sensitivity.
- A test can be offered only once by a given centre.
- Active duplicate bookings for the same user, offering, and appointment are
  rejected.
- Failed payment attempts can be retried, but a booking can have at most one
  successful payment.
- Provider webhook event IDs are unique, preventing repeated delivery from
  creating duplicate events.
- Foreign-key deletion is restricted for booking and payment records.
- Booking and payment status values are enforced by database constraints.

## Important assumptions

- This is a backend-only assignment; no frontend application is included.
- Payments are simulated. No real payment provider or credentials will be used.
- The assignment does not specify a currency. All monetary values are treated as
  INR and stored as integer paise.
- Passwords must contain 8–128 characters. Access tokens expire after one hour,
  and refresh tokens are outside the assignment scope.
- New bookings start as `PENDING`. A later successful payment changes the
  booking to `CONFIRMED`, while a failed payment changes it to `FAILED`.

## Future improvements

- Add email verification and password-reset flows.
- Add refresh-token rotation and revocation.
- Replace the simulated payment service with a real payment provider.
- Verify cryptographic signatures on webhooks from a real payment provider.

## Project structure

```text
.
├── compose.yaml
└── backend/
    ├── db/
    │   ├── migrations/
    │   │   └── 001_initial_schema.sql
    │   ├── migrate.js
    │   └── seed.js
    ├── src/
    │   ├── auth/
    │   │   ├── auth.controller.js
    │   │   ├── auth.routes.js
    │   │   ├── auth.schema.js
    │   │   ├── auth.service.js
    │   │   └── token.service.js
    │   ├── bookings/
    │   │   ├── bookings.controller.js
    │   │   ├── bookings.routes.js
    │   │   ├── bookings.schema.js
    │   │   └── bookings.service.js
    │   ├── diagnostics/
    │   │   ├── diagnostics.controller.js
    │   │   ├── diagnostics.routes.js
    │   │   ├── diagnostics.schema.js
    │   │   └── diagnostics.service.js
    │   ├── errors/
    │   │   └── http-error.js
    │   ├── middleware/
    │   │   ├── authenticate.js
    │   │   ├── error-handler.js
    │   │   ├── request-logger.js
    │   │   └── require-role.js
    │   ├── payments/
    │   │   ├── payments.controller.js
    │   │   ├── payments.routes.js
    │   │   ├── payments.schema.js
    │   │   ├── payments.service.js
    │   │   ├── webhook-retry.worker.js
    │   │   └── webhook.service.js
    │   ├── app.js
    │   ├── database.js
    │   ├── logger.js
    │   └── server.js
    ├── test/
    │   ├── authenticate.test.js
    │   ├── bookings.test.js
    │   ├── diagnostics-management.test.js
    │   ├── diagnostics.test.js
    │   ├── health.test.js
    │   ├── login.test.js
    │   ├── logging.test.js
    │   ├── payments.test.js
    │   ├── signup.test.js
    │   └── webhook.test.js
    ├── .dockerignore
    ├── .env.example
    ├── Dockerfile
    ├── package.json
    └── package-lock.json
```
