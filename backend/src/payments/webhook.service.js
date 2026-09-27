import { HttpError } from '../errors/http-error.js';

export async function processPaymentWebhook({
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
        FOR UPDATE OF payment, booking
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
          attempt_count
        )
        VALUES ($1, $2, $3, $4, 'PROCESSING', 1)
        ON CONFLICT (provider_event_id) DO NOTHING
        RETURNING id
      `,
      [eventId, payment.paymentId, status, payload],
    );

    let webhookEventId = eventResult.rows[0]?.id;
    const duplicate = !webhookEventId;

    if (duplicate) {
      const existingResult = await client.query(
        `
          SELECT
            id,
            payment_id AS "paymentId",
            target_status AS "targetStatus",
            processing_status AS "processingStatus"
          FROM webhook_events
          WHERE provider_event_id = $1
        `,
        [eventId],
      );
      const existingEvent = existingResult.rows[0];

      if (
        !existingEvent ||
        existingEvent.paymentId !== payment.paymentId ||
        existingEvent.targetStatus !== status
      ) {
        throw new HttpError(
          409,
          'WEBHOOK_EVENT_CONFLICT',
          'Webhook event ID has already been used for different payment data',
        );
      }

      webhookEventId = existingEvent.id;

      if (existingEvent.processingStatus === 'PROCESSED') {
        await client.query('COMMIT');

        return {
          event: {
            eventId,
            processingStatus: 'PROCESSED',
            duplicate: true,
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
      }

      await client.query(
        `
          UPDATE webhook_events
          SET
            processing_status = 'PROCESSING',
            attempt_count = attempt_count + 1,
            updated_at = now()
          WHERE id = $1
        `,
        [webhookEventId],
      );
    }

    if (payment.paymentStatus !== 'PENDING' && payment.paymentStatus !== status) {
      throw new HttpError(
        409,
        'PAYMENT_STATUS_CONFLICT',
        'Payment has already reached a different final status',
      );
    }

    if (status === 'SUCCESS' && payment.bookingStatus === 'CANCELLED') {
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
      [payment.paymentId, status],
    );

    let bookingStatus = payment.bookingStatus;

    if (status === 'SUCCESS') {
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
          processed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [webhookEventId],
    );
    await client.query('COMMIT');

    return {
      event: {
        eventId,
        processingStatus: 'PROCESSED',
        duplicate,
      },
      payment: {
        id: payment.paymentId,
        status,
      },
      booking: {
        id: payment.bookingId,
        status: bookingStatus,
      },
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    throw error;
  } finally {
    client.release();
  }
}
