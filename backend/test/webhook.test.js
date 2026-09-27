import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';
import { processDueWebhookEvents } from '../src/payments/webhook-retry.worker.js';
import { processStoredWebhookEvent } from '../src/payments/webhook.service.js';

const tokenService = createTokenService({ secret: 'webhook-test-secret' });
const paymentId = '690028f1-c847-4925-a311-fdd5b576115b';
const bookingId = '18fd3f4c-f1c0-4b33-882b-5d6d3e224815';
const eventId = 'event_123';
const providerReference = 'mock_24c37900-a776-4a70-a8a9-4efb4fcc2dcc';

function clone(value) {
  return value ? { ...value } : value;
}

function createWebhookDatabase({
  payment = null,
  event = null,
  processingFailures = 0,
} = {}) {
  const state = {
    payment: clone(payment),
    event: event
      ? {
          id: '25ff183b-56fb-42e8-9c14-03a96b53300f',
          eventId,
          paymentId,
          targetStatus: 'SUCCESS',
          processingStatus: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: new Date(0).toISOString(),
          ...event,
        }
      : null,
    processingFailures,
    commands: [],
    released: false,
  };
  let transactionSnapshot;

  const client = {
    async query(sql, parameters = []) {
      const command = sql.trim();
      state.commands.push({ sql: command, parameters });

      if (command === 'BEGIN') {
        transactionSnapshot = {
          payment: clone(state.payment),
          event: clone(state.event),
        };
        return { rows: [] };
      }

      if (command === 'COMMIT') {
        transactionSnapshot = undefined;
        return { rows: [] };
      }

      if (command === 'ROLLBACK') {
        state.payment = clone(transactionSnapshot?.payment);
        state.event = clone(transactionSnapshot?.event);
        transactionSnapshot = undefined;
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
          eventId: parameters[0],
          paymentId: parameters[1],
          targetStatus: parameters[2],
          processingStatus: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: new Date(0).toISOString(),
        };

        return { rows: [clone(state.event)] };
      }

      if (command.includes('FROM webhook_events AS webhook_event')) {
        if (!state.event || !state.payment) {
          return { rows: [] };
        }

        return {
          rows: [
            {
              ...state.event,
              ...state.payment,
              isDue:
                state.event.isDue ??
                new Date(state.event.nextAttemptAt) <= new Date(),
            },
          ],
        };
      }

      if (command.includes('FROM webhook_events')) {
        return { rows: state.event ? [clone(state.event)] : [] };
      }

      if (
        command.includes('UPDATE webhook_events') &&
        command.includes("processing_status = 'PROCESSING'")
      ) {
        state.event.processingStatus = 'PROCESSING';
        state.event.attemptCount = parameters[1];
        return { rows: [] };
      }

      if (command.includes('UPDATE payments')) {
        if (state.processingFailures > 0) {
          state.processingFailures -= 1;
          throw new Error('Temporary database failure');
        }

        state.payment.paymentStatus = parameters[1];
        return { rows: [] };
      }

      if (command.includes('UPDATE bookings')) {
        state.payment.bookingStatus = parameters[1];
        return { rows: [] };
      }

      if (
        command.includes('UPDATE webhook_events') &&
        command.includes("processing_status = 'PROCESSED'")
      ) {
        state.event.processingStatus = 'PROCESSED';
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${command}`);
    },

    release() {
      state.released = true;
    },
  };

  const database = {
    async connect() {
      return client;
    },

    async query(sql, parameters = []) {
      const command = sql.trim();
      state.commands.push({ sql: command, parameters });

      if (command.startsWith('SELECT provider_event_id')) {
        const isDue =
          state.event &&
          ['PENDING', 'RETRY_PENDING'].includes(
            state.event.processingStatus,
          ) &&
          (state.event.isDue ??
            new Date(state.event.nextAttemptAt) <= new Date());

        return { rows: isDue ? [{ eventId: state.event.eventId }] : [] };
      }

      if (
        command.includes('UPDATE webhook_events') &&
        command.includes("processing_status = 'EXHAUSTED'")
      ) {
        state.event.processingStatus = 'EXHAUSTED';
        state.event.attemptCount += 1;
        state.event.lastError = parameters[1];
        return { rows: [] };
      }

      if (
        command.includes('UPDATE webhook_events') &&
        command.includes('processing_status = $2')
      ) {
        state.event.processingStatus = parameters[1];
        state.event.attemptCount += 1;
        state.event.nextAttemptAt = new Date(
          Date.now() + parameters[2],
        ).toISOString();
        state.event.lastError = parameters[3];

        return { rows: [clone(state.event)] };
      }

      throw new Error(`Unexpected pool query: ${command}`);
    },
  };

  return { database, state };
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
  assert.equal(state.event.attemptCount, 1);
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
      processingStatus: 'PROCESSED',
      attemptCount: 1,
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
      targetStatus: 'FAILED',
      processingStatus: 'PROCESSED',
      attemptCount: 1,
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'WEBHOOK_EVENT_CONFLICT');
  assert.equal(state.commands.at(-1).sql, 'ROLLBACK');
});

test('POST /api/v1/payments/webhook rejects an unknown payment reference', async () => {
  const { database, state } = createWebhookDatabase();

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

test('POST /api/v1/payments/webhook queues an unexpected processing failure', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    processingFailures: 1,
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 202);
  assert.equal(response.body.data.event.processingStatus, 'RETRY_PENDING');
  assert.equal(response.body.data.event.attemptCount, 1);
  assert.ok(response.body.data.event.nextAttemptAt);
  assert.equal(state.event.processingStatus, 'RETRY_PENDING');
  assert.equal(state.event.attemptCount, 1);
  assert.equal(state.payment.paymentStatus, 'PENDING');
  assert.equal(state.payment.bookingStatus, 'PENDING');
  const retryCommand = state.commands.find(
    ({ sql }) =>
      sql.includes('UPDATE webhook_events') &&
      sql.includes('processing_status = $2'),
  );
  assert.equal(retryCommand.parameters[2], 5_000);
});

test('webhook processing applies the second retry delay', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    event: {
      processingStatus: 'RETRY_PENDING',
      attemptCount: 1,
      isDue: true,
    },
    processingFailures: 1,
  });

  const result = await processStoredWebhookEvent({ database, eventId });

  assert.equal(result.event.processingStatus, 'RETRY_PENDING');
  assert.equal(result.event.attemptCount, 2);
  const retryCommand = state.commands.find(
    ({ sql }) =>
      sql.includes('UPDATE webhook_events') &&
      sql.includes('processing_status = $2'),
  );
  assert.equal(retryCommand.parameters[2], 30_000);
});

test('a duplicate delivery does not bypass a pending retry delay', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    event: {
      processingStatus: 'RETRY_PENDING',
      attemptCount: 1,
      nextAttemptAt: '2030-01-01T10:00:00.000Z',
      isDue: false,
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 202);
  assert.equal(response.body.data.event.duplicate, true);
  assert.equal(response.body.data.event.attemptCount, 1);
  assert.equal(state.event.attemptCount, 1);
  assert.equal(
    state.commands.some(({ sql }) => sql.includes('UPDATE payments')),
    false,
  );
});

test('the retry worker processes a due webhook event', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    event: {
      processingStatus: 'RETRY_PENDING',
      attemptCount: 1,
      isDue: true,
    },
  });

  const processedCount = await processDueWebhookEvents({ database });

  assert.equal(processedCount, 1);
  assert.equal(state.event.processingStatus, 'PROCESSED');
  assert.equal(state.event.attemptCount, 2);
  assert.equal(state.payment.paymentStatus, 'SUCCESS');
  assert.equal(state.payment.bookingStatus, 'CONFIRMED');
});

test('webhook processing stops after three failed attempts', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'PENDING',
      bookingId,
      bookingStatus: 'PENDING',
    },
    event: {
      processingStatus: 'RETRY_PENDING',
      attemptCount: 2,
      isDue: true,
    },
    processingFailures: 1,
  });

  await assert.rejects(
    processStoredWebhookEvent({ database, eventId }),
    (error) =>
      error.status === 503 && error.code === 'WEBHOOK_PROCESSING_EXHAUSTED',
  );
  assert.equal(state.event.processingStatus, 'EXHAUSTED');
  assert.equal(state.event.attemptCount, 3);
  assert.equal(state.payment.paymentStatus, 'PENDING');
});

test('business conflicts are terminal and are not queued for retry', async () => {
  const { database, state } = createWebhookDatabase({
    payment: {
      paymentId,
      paymentStatus: 'FAILED',
      bookingId,
      bookingStatus: 'FAILED',
    },
  });

  const response = await webhookRequest(createApp({ database, tokenService }));

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'PAYMENT_STATUS_CONFLICT');
  assert.equal(state.event.processingStatus, 'EXHAUSTED');
  assert.equal(state.event.attemptCount, 1);
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
