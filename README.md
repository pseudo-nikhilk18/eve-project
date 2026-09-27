# EVE Healthcare Diagnostic Booking API

A backend service for booking diagnostic tests and processing simulated
payments. The implementation emphasizes API design, database integrity,
edge-case handling, tests, and maintainable code.

## Assignment scope

### Required capabilities

- [ ] User signup and login
- [ ] JWT-based authentication
- [ ] Request validation
- [ ] Diagnostic centre and test management
- [ ] Diagnostic centre and test retrieval
- [ ] Authenticated diagnostic-test bookings
- [ ] Simulated successful and failed payments
- [ ] Idempotent payment-status webhooks
- [ ] Validation, authorization, and failure edge cases

### Chosen engineering additions

- [ ] Docker and Docker Compose
- [ ] Automated unit and integration tests
- [ ] OpenAPI documentation
- [ ] Structured application logging
- [ ] Bounded retry handling for webhook processing

## Current status

The Express application exposes a tested health endpoint. Application
configuration is separated from network startup so integration tests can run
without occupying the development port. The initial PostgreSQL schema and
transactional migration runner are defined; feature APIs have not been
implemented yet.

## Technology

- JavaScript
- Node.js
- Express.js
- PostgreSQL
- `pg` for PostgreSQL access
- Plain SQL migrations

## Run locally

### Prerequisites

- Node.js
- npm

### Start the API

```bash
cd backend
npm install
npm run dev
```

The API listens on `http://localhost:3000` by default. Set `PORT` to use a
different port.

### Configure PostgreSQL

Create a PostgreSQL database, then copy the example environment file:

```bash
cd backend
cp .env.example .env
```

Update `DATABASE_URL` in `.env` if the local connection details differ. Apply
all pending migrations with:

```bash
npm run db:migrate
```

Each migration runs in a transaction and is recorded in `schema_migrations`.
Re-running the command applies only migrations that have not already run.

### Run tests

```bash
cd backend
npm test
```

Integration tests exercise the Express application directly without starting
the development server.

## API endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Confirm that the API process is running |

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

## Project structure

```text
backend/
├── db/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── migrate.js
├── src/
│   ├── app.js
│   └── server.js
├── test/
│   └── health.test.js
├── .env.example
├── package.json
└── package-lock.json
```
