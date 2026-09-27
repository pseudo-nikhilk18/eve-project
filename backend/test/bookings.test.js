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

function authorizationHeader() {
  const accessToken = tokenService.sign({ userId, role: 'USER' });

  return `Bearer ${accessToken}`;
}

test('POST /api/v1/bookings creates a pending booking from the selected offering', async () => {
  let queryParameters;
  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;

      return {
        rows: [
          {
            id: '18fd3f4c-f1c0-4b33-882b-5d6d3e224815',
            userId,
            appointmentAt,
            amountInPaise: 400000,
            status: 'PENDING',
            createdAt: '2026-09-27T08:00:00.000Z',
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
        id: '18fd3f4c-f1c0-4b33-882b-5d6d3e224815',
        userId,
        centreId,
        testId,
        appointmentAt,
        amount: 4000,
        status: 'PENDING',
        createdAt: '2026-09-27T08:00:00.000Z',
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
