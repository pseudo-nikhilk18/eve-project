import { HttpError } from '../errors/http-error.js';

export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_RETRY_DELAYS_MS = [5_000, 30_000];

function buildWebhookResult({ event, payment, duplicate }) {
  const result = {
    event: {
      eventId: event.eventId,
      processingStatus: event.processingStatus,
      duplicate,
    },
    payment: {
      id: payment.paymentId,
      status: payment.paymentStatus,
    },
    booking: {
      id: payment.bookingId,
      status: payment.bookingStatus,
    },
  };

  if (event.processingStatus === 'RETRY_PENDING') {
    result.event.attemptCount = event.attemptCount;
    result.event.nextAttemptAt = event.nextAttemptAt;
  }

  return result;
}

function getLastError(error) {
  if (!(error instanceof Error) || !error.message) {
    return 'Unknown webhook processing error';
  }

  return error.message.slice(0, 1_000);
}

async function recordWebhookEvent({
  database,
  eventId,
  providerReference,
  status,
}) {
  const client = await database.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const paymentResult = await client.query(
      `
        SELECT
          payment.id AS "paymentId",
          payment.status AS "paymentStatus",
          booking.id AS "bookingId",
          booking.status AS "bookingStatus"
        FROM payments AS payment
        JOIN bookings AS booking ON booking.id = payment.booking_id
        WHERE payment.provider_reference = $1
      `,
      [providerReference],
    );
    const payment = paymentResult.rows[0];

    if (!payment) {
      throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    const payload = { eventId, providerReference, status };
    const eventResult = await client.query(
      `
        INSERT INTO webhook_events (
          provider_event_id,
          payment_id,
          target_status,
          payload,
          processing_status,
          attempt_count,
          next_attempt_at
        )
        VALUES ($1, $2, $3, $4, 'PENDING', 0, now())
        ON CONFLICT (provider_event_id) DO NOTHING
        RETURNING
          id,
          provider_event_id AS "eventId",
          target_status AS "targetStatus",
          processing_status AS "processingStatus",
          attempt_count AS "attemptCount",
          next_attempt_at AS "nextAttemptAt"
      `,
      [eventId, payment.paymentId, status, payload],
    );

    const duplicate = eventResult.rows.length === 0;
    let event = eventResult.rows[0];

    if (duplicate) {
      const existingResult = await client.query(
        `
          SELECT
            id,
            provider_event_id AS "eventId",
            payment_id AS "paymentId",
            target_status AS "targetStatus",
            processing_status AS "processingStatus",
            attempt_count AS "attemptCount",
            next_attempt_at AS "nextAttemptAt"
          FROM webhook_events
          WHERE provider_event_id = $1
          FOR UPDATE
        `,
        [eventId],
      );
      event = existingResult.rows[0];

      if (
        !event ||
        event.paymentId !== payment.paymentId ||
        event.targetStatus !== status
      ) {
        throw new HttpError(
          409,
          'WEBHOOK_EVENT_CONFLICT',
          'Webhook event ID has already been used for different payment data',
        );
      }
    }

    await client.query('COMMIT');

    return { event, payment, duplicate };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function markTerminalFailure({ database, eventId, error }) {
  await database.query(
    `
      UPDATE webhook_events
      SET
        processing_status = 'EXHAUSTED',
        attempt_count = attempt_count + 1,
        last_error = $2,
        updated_at = now()
      WHERE provider_event_id = $1
        AND processing_status <> 'PROCESSED'
    `,
    [eventId, getLastError(error)],
  );
}

async function scheduleRetry({ database, eventId, attemptNumber, error }) {
  const exhausted = attemptNumber >= WEBHOOK_MAX_ATTEMPTS;
  const retryDelayMs = exhausted
    ? 0
    : WEBHOOK_RETRY_DELAYS_MS[attemptNumber - 1];
  const result = await database.query(
    `
      UPDATE webhook_events
      SET
        processing_status = $2,
        attempt_count = attempt_count + 1,
        next_attempt_at = now() + ($3 * interval '1 millisecond'),
        last_error = $4,
        updated_at = now()
      WHERE provider_event_id = $1
        AND processing_status <> 'PROCESSED'
      RETURNING
        provider_event_id AS "eventId",
        processing_status AS "processingStatus",
        attempt_count AS "attemptCount",
        next_attempt_at AS "nextAttemptAt"
    `,
    [
      eventId,
      exhausted ? 'EXHAUSTED' : 'RETRY_PENDING',
      retryDelayMs,
      getLastError(error),
    ],
  );

  return result.rows[0];
}

export async function processStoredWebhookEvent({
  database,
  eventId,
  duplicate = true,
}) {
  const client = await database.connect();
  let transactionStarted = false;
  let event;
  let payment;
  let attemptNumber;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const eventResult = await client.query(
      `
        SELECT
          webhook_event.id,
          webhook_event.provider_event_id AS "eventId",
          webhook_event.target_status AS "targetStatus",
          webhook_event.processing_status AS "processingStatus",
          webhook_event.attempt_count AS "attemptCount",
          webhook_event.next_attempt_at AS "nextAttemptAt",
          webhook_event.next_attempt_at <= now() AS "isDue",
          payment.id AS "paymentId",
          payment.status AS "paymentStatus",
          booking.id AS "bookingId",
          booking.status AS "bookingStatus"
        FROM webhook_events AS webhook_event
        JOIN payments AS payment ON payment.id = webhook_event.payment_id
        JOIN bookings AS booking ON booking.id = payment.booking_id
        WHERE webhook_event.provider_event_id = $1
        FOR UPDATE OF webhook_event, payment, booking
      `,
      [eventId],
    );
    const row = eventResult.rows[0];

    if (!row) {
      throw new HttpError(
        404,
        'WEBHOOK_EVENT_NOT_FOUND',
        'Webhook event not found',
      );
    }

    event = {
      id: row.id,
      eventId: row.eventId,
      targetStatus: row.targetStatus,
      processingStatus: row.processingStatus,
      attemptCount: row.attemptCount,
      nextAttemptAt: row.nextAttemptAt,
      isDue: row.isDue,
    };
    payment = {
      paymentId: row.paymentId,
      paymentStatus: row.paymentStatus,
      bookingId: row.bookingId,
      bookingStatus: row.bookingStatus,
    };

    if (event.processingStatus === 'PROCESSED') {
      await client.query('COMMIT');
      return buildWebhookResult({ event, payment, duplicate });
    }

    if (event.processingStatus === 'EXHAUSTED') {
      throw new HttpError(
        503,
        'WEBHOOK_PROCESSING_EXHAUSTED',
        'Webhook processing exhausted its retry limit',
      );
    }

    if (event.processingStatus === 'RETRY_PENDING' && !event.isDue) {
      await client.query('COMMIT');
      return buildWebhookResult({ event, payment, duplicate });
    }

    attemptNumber = event.attemptCount + 1;
    await client.query(
      `
        UPDATE webhook_events
        SET
          processing_status = 'PROCESSING',
          attempt_count = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [event.id, attemptNumber],
    );

    if (
      payment.paymentStatus !== 'PENDING' &&
      payment.paymentStatus !== event.targetStatus
    ) {
      throw new HttpError(
        409,
        'PAYMENT_STATUS_CONFLICT',
        'Payment has already reached a different final status',
      );
    }

    if (
      event.targetStatus === 'SUCCESS' &&
      payment.bookingStatus === 'CANCELLED'
    ) {
      throw new HttpError(
        409,
        'BOOKING_STATUS_CONFLICT',
        'A cancelled booking cannot be confirmed by a payment webhook',
      );
    }

    await client.query(
      `
        UPDATE payments
        SET status = $2, updated_at = now()
        WHERE id = $1
      `,
      [payment.paymentId, event.targetStatus],
    );

    let bookingStatus = payment.bookingStatus;

    if (event.targetStatus === 'SUCCESS') {
      bookingStatus = 'CONFIRMED';
    } else if (['PENDING', 'FAILED'].includes(payment.bookingStatus)) {
      bookingStatus = 'FAILED';
    }

    if (bookingStatus !== payment.bookingStatus) {
      await client.query(
        `
          UPDATE bookings
          SET status = $2, updated_at = now()
          WHERE id = $1
        `,
        [payment.bookingId, bookingStatus],
      );
    }

    await client.query(
      `
        UPDATE webhook_events
        SET
          processing_status = 'PROCESSED',
          last_error = NULL,
          processed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [event.id],
    );
    await client.query('COMMIT');

    return buildWebhookResult({
      event: {
        ...event,
        processingStatus: 'PROCESSED',
        attemptCount: attemptNumber,
      },
      payment: {
        ...payment,
        paymentStatus: event.targetStatus,
        bookingStatus,
      },
      duplicate,
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    if (!event || !attemptNumber) {
      throw error;
    }

    if (error instanceof HttpError) {
      await markTerminalFailure({ database, eventId, error });
      throw error;
    }

    const scheduledEvent = await scheduleRetry({
      database,
      eventId,
      attemptNumber,
      error,
    });

    if (!scheduledEvent) {
      throw error;
    }

    if (scheduledEvent.processingStatus === 'EXHAUSTED') {
      throw new HttpError(
        503,
        'WEBHOOK_PROCESSING_EXHAUSTED',
        'Webhook processing exhausted its retry limit',
      );
    }

    return buildWebhookResult({
      event: scheduledEvent,
      payment,
      duplicate,
    });
  } finally {
    client.release();
  }
}

export async function processPaymentWebhook({
  database,
  eventId,
  providerReference,
  status,
}) {
  const receipt = await recordWebhookEvent({
    database,
    eventId,
    providerReference,
    status,
  });

  if (receipt.event.processingStatus === 'PROCESSED') {
    return buildWebhookResult(receipt);
  }

  if (receipt.event.processingStatus === 'EXHAUSTED') {
    throw new HttpError(
      503,
      'WEBHOOK_PROCESSING_EXHAUSTED',
      'Webhook processing exhausted its retry limit',
    );
  }

  return processStoredWebhookEvent({
    database,
    eventId,
    duplicate: receipt.duplicate,
  });
}
