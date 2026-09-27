import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { seedDatabase } from '../db/seed.js';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const { Pool } = pg;
const executeFile = promisify(execFile);
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const backendDirectory = fileURLToPath(new URL('..', import.meta.url));
const databaseName = `eve_integration_${randomUUID().replaceAll('-', '')}`;
const password = 'integration-test-password';

let adminDatabase;
let database;
let app;
let initialSeed;

function expectStatus(response, expected, operation) {
  assert.equal(
    response.status,
    expected,
    `${operation} returned ${response.status}: ${JSON.stringify(response.body)}`,
  );
}

function testDatabaseUrl() {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function signupAndLogin(label) {
  const email = `${label}-${randomUUID()}@example.com`;
  const signupResponse = await request(app)
    .post('/api/v1/auth/signup')
    .send({ fullName: `${label} User`, email, password });
  expectStatus(signupResponse, 201, `${label} signup`);

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  expectStatus(loginResponse, 200, `${label} login`);

  return {
    id: loginResponse.body.data.user.id,
    authorization: `Bearer ${loginResponse.body.data.accessToken}`,
  };
}

async function getOffering() {
  const response = await request(app).get('/api/v1/diagnostic-centres');
  expectStatus(response, 200, 'catalogue retrieval');

  const centre = response.body.data.centres.find(
    (candidate) => candidate.tests.length > 0,
  );

  assert.ok(centre, 'seed must provide a centre with an available test');

  return { centre, diagnosticTest: centre.tests[0] };
}

async function createBooking({ authorization, daysFromNow }) {
  const { centre, diagnosticTest } = await getOffering();
  const appointmentAt = new Date(
    Date.now() + daysFromNow * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const response = await request(app)
    .post('/api/v1/bookings')
    .set('Authorization', authorization)
    .send({
      centreId: centre.id,
      testId: diagnosticTest.id,
      appointmentAt,
    });
  expectStatus(response, 201, 'booking creation');

  return response.body.data.booking;
}

before(async () => {
  if (!adminDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is required and must allow temporary database creation',
    );
  }

  adminDatabase = new Pool({ connectionString: adminDatabaseUrl });
  await adminDatabase.query(`CREATE DATABASE "${databaseName}"`);

  await executeFile(process.execPath, ['db/migrate.js'], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl(),
    },
  });

  database = new Pool({ connectionString: testDatabaseUrl() });
  initialSeed = await seedDatabase(database);
  app = createApp({
    database,
    tokenService: createTokenService({
      secret: 'integration-test-jwt-secret-at-least-32-characters',
    }),
  });
});

after(async () => {
  await database?.end();

  if (adminDatabase) {
    await adminDatabase.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminDatabase.end();
  }
});

test('migrations and reference-data seeding work against PostgreSQL', async () => {
  assert.deepEqual(initialSeed, { centres: 5, tests: 8, offerings: 33 });
  assert.deepEqual(await seedDatabase(database), {
    centres: 0,
    tests: 0,
    offerings: 0,
  });

  const migrationResult = await database.query(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  assert.deepEqual(migrationResult.rows, [
    { filename: '001_initial_schema.sql' },
  ]);
});

test('PostgreSQL enforces one active booking and isolates booking reads', async () => {
  const owner = await signupAndLogin('booking-owner');
  const otherUser = await signupAndLogin('other-patient');
  const { centre, diagnosticTest } = await getOffering();
  const appointmentAt = new Date(
    Date.now() + 20 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const payload = {
    centreId: centre.id,
    testId: diagnosticTest.id,
    appointmentAt,
  };

  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', owner.authorization)
        .send(payload),
    ),
  );
  const statuses = responses.map(({ status }) => status).sort();

  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409]);

  const createdBooking = responses.find(({ status }) => status === 201).body
    .data.booking;
  assert.equal(createdBooking.userId, owner.id);
  assert.equal(createdBooking.centre.id, centre.id);
  assert.equal(createdBooking.test.id, diagnosticTest.id);
  assert.equal(createdBooking.status, 'PENDING');
  assert.ok(createdBooking.updatedAt);

  const ownerList = await request(app)
    .get('/api/v1/bookings')
    .set('Authorization', owner.authorization);
  expectStatus(ownerList, 200, 'owner booking list');
  assert.deepEqual(
    ownerList.body.data.bookings.map(({ id }) => id),
    [createdBooking.id],
  );

  const ownerDetail = await request(app)
    .get(`/api/v1/bookings/${createdBooking.id}`)
    .set('Authorization', owner.authorization);
  expectStatus(ownerDetail, 200, 'owner booking detail');
  assert.deepEqual(ownerDetail.body.data.booking, createdBooking);

  const otherList = await request(app)
    .get('/api/v1/bookings')
    .set('Authorization', otherUser.authorization);
  expectStatus(otherList, 200, 'other user booking list');
  assert.deepEqual(otherList.body.data.bookings, []);

  const otherDetail = await request(app)
    .get(`/api/v1/bookings/${createdBooking.id}`)
    .set('Authorization', otherUser.authorization);
  expectStatus(otherDetail, 404, 'other user booking detail');
  assert.equal(otherDetail.body.error.code, 'BOOKING_NOT_FOUND');

  const countResult = await database.query(
    'SELECT count(*)::int AS count FROM bookings WHERE user_id = $1',
    [owner.id],
  );
  assert.equal(countResult.rows[0].count, 1);
});

test('PostgreSQL keeps repeated webhook delivery idempotent', async () => {
  const user = await signupAndLogin('webhook-patient');
  const booking = await createBooking({
    authorization: user.authorization,
    daysFromNow: 30,
  });
  const paymentResponse = await request(app)
    .post('/api/v1/payments')
    .set('Authorization', user.authorization)
    .send({ bookingId: booking.id, simulateOutcome: 'SUCCESS' });
  expectStatus(paymentResponse, 201, 'payment creation');

  const payment = paymentResponse.body.data.payment;
  const eventId = `event-${randomUUID()}`;
  const payload = {
    eventId,
    providerReference: payment.providerReference,
    status: 'SUCCESS',
  };
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app).post('/api/v1/payments/webhook').send(payload),
    ),
  );

  assert.deepEqual(
    responses.map(({ status }) => status),
    Array(10).fill(200),
  );
  assert.equal(
    responses.filter(({ body }) => body.data.event.duplicate === false).length,
    1,
  );
  assert.equal(
    responses.filter(({ body }) => body.data.event.duplicate === true).length,
    9,
  );

  const eventResult = await database.query(
    `
      SELECT processing_status AS "processingStatus", attempt_count AS "attemptCount"
      FROM webhook_events
      WHERE provider_event_id = $1
    `,
    [eventId],
  );
  assert.deepEqual(eventResult.rows, [
    { processingStatus: 'PROCESSED', attemptCount: 1 },
  ]);

  const stateResult = await database.query(
    `
      SELECT
        payment.status AS "paymentStatus",
        booking.status AS "bookingStatus"
      FROM payments AS payment
      JOIN bookings AS booking ON booking.id = payment.booking_id
      WHERE payment.id = $1
    `,
    [payment.id],
  );
  assert.deepEqual(stateResult.rows, [
    { paymentStatus: 'SUCCESS', bookingStatus: 'CONFIRMED' },
  ]);
});
