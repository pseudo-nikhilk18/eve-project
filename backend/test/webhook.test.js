import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'webhook-test-secret' });
const paymentId = '690028f1-c847-4925-a311-fdd5b576115b';
const bookingId = '18fd3f4c-f1c0-4b33-882b-5d6d3e224815';
const eventId = 'event_123';
const providerReference = 'mock_24c37900-a776-4a70-a8a9-4efb4fcc2dcc';

function createWebhookDatabase({ payment = null, event = null }) {
  const state = {
    payment,
    event,
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

      if (command.includes('FROM payments AS payment')) {
        return { rows: state.payment ? [state.payment] : [] };
      }

      if (command.includes('INSERT INTO webhook_events')) {
        if (state.event) {
          return { rows: [] };
        }

        state.event = {
          id: '25ff183b-56fb-42e8-9c14-03a96b53300f',
          paymentId: parameters[1],
          targetStatus: parameters[2],
          processingStatus: 'PROCESSING',
        };

        return { rows: [{ id: state.event.id }] };
      }

      if (command.includes('FROM webhook_events')) {
        return { rows: state.event ? [state.event] : [] };
      }

      if (command.includes('UPDATE payments')) {
        state.payment.paymentStatus = parameters[1];
        return { rows: [] };
      }

      if (command.includes('UPDATE bookings')) {
        state.payment.bookingStatus = parameters[1];
        return { rows: [] };
      }

      if (command.includes('UPDATE webhook_events')) {
        state.event.processingStatus = command.includes("'PROCESSED'")
          ? 'PROCESSED'
          : 'PROCESSING';
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

function webhookRequest(app, overrides = {}) {
  return request(app)
    .post('/api/v1/payments/webhook')
    .send({
      eventId,
      providerReference,
      status: 'SUCCESS',
      ...overrides,
    });
}

test('POST /api/v1/payments/webhook processes a payment event', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    data: {
      event: {
        eventId,
        processingStatus: 'PROCESSED',
        duplicate: false,
      },
      payment: { id: paymentId, status: 'SUCCESS' },
      booking: { id: bookingId, status: 'CONFIRMED' },
    },
  });
  assert.equal(state.payment.paymentStatus, 'SUCCESS');
  assert.equal(state.payment.bookingStatus, 'CONFIRMED');
  assert.equal(state.event.processingStatus, 'PROCESSED');
  assert.equal(state.commands.at(-1).sql, 'COMMIT');
  assert.equal(state.released, true);
});

test('POST /api/v1/payments/webhook treats a processed event as a successful duplicate', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'SUCCESS',
      bookingId,
      bookingStatus: 'CONFIRMED',
    },
    event: {
      id: '25ff183b-56fb-42e8-9c14-03a96b53300f',
      paymentId,
      targetStatus: 'SUCCESS',
      processingStatus: 'PROCESSED',
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 200);
  assert.equal(response.body.data.event.duplicate, true);
  assert.equal(
    state.commands.some(({ sql }) => sql.includes('UPDATE payments')),
    false,
  );
  assert.equal(state.commands.at(-1).sql, 'COMMIT');
});

test('POST /api/v1/payments/webhook rejects event ID reuse with different data', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    event: {
      id: '25ff183b-56fb-42e8-9c14-03a96b53300f',
      paymentId,
      targetStatus: 'FAILED',
      processingStatus: 'PROCESSED',
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'WEBHOOK_EVENT_CONFLICT');
  assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
});

test('POST /api/v1/payments/webhook rejects an unknown payment reference', async () => {
  const { database, state } = createWebhookDatabase({ payment: null });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'PAYMENT_NOT_FOUND');
  assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
});

test('POST /api/v1/payments/webhook does not downgrade a confirmed booking', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'CONFIRMED',
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }), {
    status: 'FAILED',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.payment.status, 'FAILED');
  assert.equal(response.body.data.booking.status, 'CONFIRMED');
  assert.equal(
    state.commands.some(({ sql }) => sql.includes('UPDATE bookings')),
    false,
  );
});

test('POST /api/v1/payments/webhook validates its payload', async () => {
  let connectCalled = false;
  const database = {
    async connect() {
      connectCalled = true;
    },
  };

  const response = await webhookRequest(createApp({ database, tokenService }), {
    eventId: '',
    status: 'PENDING',
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(connectCalled, false);
});
