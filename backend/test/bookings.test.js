import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'bookings-test-secret' });
const userId = 'c2596d51-88e8-42e1-8647-abb118e14824';
const centreId = '54a43c3e-51de-464e-9205-9f6d87443688';
const testId = 'c9c9f963-1199-49a0-bc20-f42771b6f7cf';
const appointmentAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const bookingId = '18fd3f4c-f1c0-4b33-882b-5d6d3e224815';

const storedBooking = {
  id: bookingId,
  userId,
  centreId,
  centreName: 'EVE Diagnostics',
  centreLocation: 'Pune, Maharashtra',
  testId,
  testName: 'Complete Blood Count',
  appointmentAt,
  amountInPaise: 400000,
  status: 'CONFIRMED',
  createdAt: '2026-09-27T08:00:00.000Z',
  updatedAt: '2026-09-27T08:05:00.000Z',
};

function authorizationHeader() {
  const accessToken = tokenService.sign({ userId, role: 'USER' });

  return `Bearer ${accessToken}`;
}

function expectedStoredBooking({
  status = 'CONFIRMED',
  updatedAt = '2026-09-27T08:05:00.000Z',
} = {}) {
  return {
    id: bookingId,
    userId,
    centre: {
      id: centreId,
      name: 'EVE Diagnostics',
      location: 'Pune, Maharashtra',
    },
    test: {
      id: testId,
      name: 'Complete Blood Count',
    },
    appointmentAt,
    amount: 4000,
    status,
    createdAt: '2026-09-27T08:00:00.000Z',
    updatedAt,
  };
}

test('GET /api/v1/bookings returns the authenticated user bookings', async () => {
  let executedSql;
  let queryParameters;
  const database = {
    async query(sql, parameters) {
      executedSql = sql;
      queryParameters = parameters;
      return { rows: [storedBooking] };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .get('/api/v1/bookings')
    .set('Authorization', authorizationHeader());

  assert.equal(response.status, 200);
  assert.match(executedSql, /WHERE booking\.user_id = \$1/);
  assert.match(executedSql, /ORDER BY booking\.created_at DESC/);
  assert.deepEqual(queryParameters, [userId]);
  assert.deepEqual(response.body, {
    data: { bookings: [expectedStoredBooking()] },
  });
});

test('GET /api/v1/bookings returns an empty list when the user has no bookings', async () => {
  const database = {
    async query() {
      return { rows: [] };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .get('/api/v1/bookings')
    .set('Authorization', authorizationHeader());

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: { bookings: [] } });
});

test('GET /api/v1/bookings/:bookingId returns an owned booking', async () => {
  let queryParameters;
  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;
      return { rows: [storedBooking] };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .get(`/api/v1/bookings/${bookingId}`)
    .set('Authorization', authorizationHeader());

  assert.equal(response.status, 200);
  assert.deepEqual(queryParameters, [userId, bookingId]);
  assert.deepEqual(response.body, {
    data: { booking: expectedStoredBooking() },
  });
});

test('GET /api/v1/bookings/:bookingId does not expose another user booking', async () => {
  let executedSql;
  const database = {
    async query(sql) {
      executedSql = sql;
      return { rows: [] };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .get(`/api/v1/bookings/${bookingId}`)
    .set('Authorization', authorizationHeader());

  assert.equal(response.status, 404);
  assert.match(executedSql, /booking\.user_id = \$1/);
  assert.deepEqual(response.body, {
    error: {
      code: 'BOOKING_NOT_FOUND',
      message: 'Booking not found',
    },
  });
});

test('GET /api/v1/bookings/:bookingId validates the booking ID', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .get('/api/v1/bookings/not-a-uuid')
    .set('Authorization', authorizationHeader());

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/bookings creates a pending booking from the selected offering', async () => {
  let queryParameters;
  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;

      return {
        rows: [
          {
            ...storedBooking,
            userId,
            status: 'PENDING',
            updatedAt: '2026-09-27T08:00:00.000Z',
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .set('Authorization', authorizationHeader())
    .send({ centreId, testId, appointmentAt });

  assert.equal(response.status, 201);
  assert.deepEqual(queryParameters, [userId, centreId, testId, appointmentAt]);
  assert.deepEqual(response.body, {
    data: {
      booking: {
        ...expectedStoredBooking({
          status: 'PENDING',
          updatedAt: '2026-09-27T08:00:00.000Z',
        }),
      },
    },
  });
});

test('POST /api/v1/bookings requires authentication', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .send({ centreId, testId, appointmentAt });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/bookings rejects client-controlled booking fields', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .set('Authorization', authorizationHeader())
    .send({
      centreId,
      testId,
      appointmentAt,
      userId: '88d9e060-e2a5-43fc-bf67-f5efadd11980',
      amount: 1,
      status: 'CONFIRMED',
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/bookings rejects a past appointment', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .set('Authorization', authorizationHeader())
    .send({
      centreId,
      testId,
      appointmentAt: '2020-01-01T10:30:00.000Z',
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/bookings rejects an unavailable offering', async () => {
  const database = {
    async query() {
      return { rows: [] };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .set('Authorization', authorizationHeader())
    .send({ centreId, testId, appointmentAt });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    error: {
      code: 'DIAGNOSTIC_OFFERING_NOT_FOUND',
      message: 'The selected diagnostic test is not available at this centre',
    },
  });
});

test('POST /api/v1/bookings rejects a duplicate active booking', async () => {
  const database = {
    async query() {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      error.constraint = 'bookings_active_slot_unique';
      throw error;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/bookings')
    .set('Authorization', authorizationHeader())
    .send({ centreId, testId, appointmentAt });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'BOOKING_ALREADY_EXISTS',
      message: 'An active booking already exists for this test and appointment time',
    },
  });
});
