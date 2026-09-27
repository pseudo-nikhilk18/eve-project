import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'payments-test-secret' });
const userId = 'c2596d51-88e8-42e1-8647-abb118e14824';
const bookingId = '18fd3f4c-f1c0-4b33-882b-5d6d3e224815';

function authorizationHeader(authenticatedUserId = userId) {
  const accessToken = tokenService.sign({
    userId: authenticatedUserId,
    role: 'USER',
  });

  return `Bearer ${accessToken}`;
}

function createTransactionalDatabase({ booking, attemptNumber = 1 }) {
  const state = {
    commands: [],
    released: false,
  };
  const client = {
    async query(sql, parameters) {
      const command = sql.trim();
      state.commands.push({ sql: command, parameters });

      if (command === 'BEGIN' || command === 'COMMIT' || command === 'ROLLBACK') {
        return { rows: [] };
      }

      if (command.includes('FROM bookings') && command.includes('FOR UPDATE')) {
        return { rows: booking ? [booking] : [] };
      }

      if (command.includes('MAX(attempt_number)')) {
        return { rows: [{ attemptNumber }] };
      }

      if (command.includes('INSERT INTO payments')) {
        return {
          rows: [
            {
              id: '690028f1-c847-4925-a311-fdd5b576115b',
              bookingId: parameters[0],
              providerReference: parameters[1],
              attemptNumber: parameters[2],
              amountInPaise: parameters[3],
              status: parameters[4],
              createdAt: '2026-09-27T08:00:00.000Z',
            },
          ],
        };
      }

      if (command.includes('UPDATE bookings')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${command}`);
    },

    release() {
      state.released = true;
    },
  };

  return {
    database: {
      async connect() {
        return client;
      },
    },
    state,
  };
}

test('POST /api/v1/payments confirms the booking after simulated success', async () => {
  const { database, state } = createTransactionalDatabase({
    booking: {
      id: bookingId,
      userId,
      amountInPaise: 400000,
      status: 'PENDING',
    },
  });

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .set('Authorization', authorizationHeader())
    .send({ bookingId, simulateOutcome: 'SUCCESS' });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.payment.bookingId, bookingId);
  assert.match(response.body.data.payment.providerReference, /^mock_/);
  assert.equal(response.body.data.payment.attemptNumber, 1);
  assert.equal(response.body.data.payment.amount, 4000);
  assert.equal(response.body.data.payment.status, 'SUCCESS');
  assert.deepEqual(response.body.data.booking, {
    id: bookingId,
    status: 'CONFIRMED',
  });
  assert.equal(state.commands.at(-1).sql, 'COMMIT');
  assert.equal(state.released, true);
});

test('POST /api/v1/payments permits a retry after failure', async () => {
  const { database, state } = createTransactionalDatabase({
    booking: {
      id: bookingId,
      userId,
      amountInPaise: 400000,
      status: 'FAILED',
    },
    attemptNumber: 2,
  });

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .set('Authorization', authorizationHeader())
    .send({ bookingId, simulateOutcome: 'FAILED' });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.payment.attemptNumber, 2);
  assert.equal(response.body.data.payment.status, 'FAILED');
  assert.equal(response.body.data.booking.status, 'FAILED');
  assert.equal(state.commands.at(-1).sql, 'COMMIT');
});

test('POST /api/v1/payments rejects access to another user booking', async () => {
  const { database, state } = createTransactionalDatabase({
    booking: {
      id: bookingId,
      userId: '88d9e060-e2a5-43fc-bf67-f5efadd11980',
      amountInPaise: 400000,
      status: 'PENDING',
    },
  });

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .set('Authorization', authorizationHeader())
    .send({ bookingId, simulateOutcome: 'SUCCESS' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
  assert.equal(
    state.commands.some(({ sql }) => sql.includes('INSERT INTO payments')),
    false,
  );
  assert.equal(state.released, true);
});

test('POST /api/v1/payments rejects an unknown booking', async () => {
  const { database, state } = createTransactionalDatabase({ booking: null });

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .set('Authorization', authorizationHeader())
    .send({ bookingId, simulateOutcome: 'SUCCESS' });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'BOOKING_NOT_FOUND');
  assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
});

test('POST /api/v1/payments rejects confirmed and cancelled bookings', async () => {
  for (const status of ['CONFIRMED', 'CANCELLED']) {
    const { database, state } = createTransactionalDatabase({
      booking: {
        id: bookingId,
        userId,
        amountInPaise: 400000,
        status,
      },
    });

    const response = await request(createApp({ database, tokenService }))
      .post('/api/v1/payments')
      .set('Authorization', authorizationHeader())
      .send({ bookingId, simulateOutcome: 'SUCCESS' });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'BOOKING_NOT_PAYABLE');
    assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
  }
});

test('POST /api/v1/payments validates authentication and input', async () => {
  let connectCalled = false;
  const database = {
    async connect() {
      connectCalled = true;
    },
  };

  const unauthenticated = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .send({ bookingId, simulateOutcome: 'SUCCESS' });
  const invalidInput = await request(createApp({ database, tokenService }))
    .post('/api/v1/payments')
    .set('Authorization', authorizationHeader())
    .send({ bookingId: 'not-a-uuid', simulateOutcome: 'PENDING' });

  assert.equal(unauthenticated.status, 401);
  assert.equal(invalidInput.status, 400);
  assert.equal(invalidInput.body.error.code, 'VALIDATION_ERROR');
  assert.equal(connectCalled, false);
});
