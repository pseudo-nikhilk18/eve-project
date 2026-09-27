import { randomUUID } from 'node:crypto';
import { HttpError } from '../errors/http-error.js';

export async function processSimulatedPayment({
  database,
  userId,
  bookingId,
  simulateOutcome,
}) {
  const client = await database.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const bookingResult = await client.query(
      `
        SELECT id, user_id AS "userId", amount_paise AS "amountInPaise", status
        FROM bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [bookingId],
    );
    const booking = bookingResult.rows[0];

    if (!booking) {
      throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    if (booking.userId !== userId) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        'You do not have permission to pay for this booking',
      );
    }

    if (!['PENDING', 'FAILED'].includes(booking.status)) {
      throw new HttpError(
        409,
        'BOOKING_NOT_PAYABLE',
        'This booking cannot accept another payment',
      );
    }

    const attemptResult = await client.query(
      `
        SELECT COALESCE(MAX(attempt_number), 0) + 1 AS "attemptNumber"
        FROM payments
        WHERE booking_id = $1
      `,
      [bookingId],
    );
    const attemptNumber = attemptResult.rows[0].attemptNumber;
    const providerReference = `mock_${randomUUID()}`;

    const paymentResult = await client.query(
      `
        INSERT INTO payments (
          booking_id,
          provider_reference,
          attempt_number,
          amount_paise,
          status
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          booking_id AS "bookingId",
          provider_reference AS "providerReference",
          attempt_number AS "attemptNumber",
          amount_paise AS "amountInPaise",
          status,
          created_at AS "createdAt"
      `,
      [
        bookingId,
        providerReference,
        attemptNumber,
        booking.amountInPaise,
        simulateOutcome,
      ],
    );
    const bookingStatus =
      simulateOutcome === 'SUCCESS' ? 'CONFIRMED' : 'FAILED';

    await client.query(
      `
        UPDATE bookings
        SET status = $2, updated_at = now()
        WHERE id = $1
      `,
      [bookingId, bookingStatus],
    );

    await client.query('COMMIT');

    const payment = paymentResult.rows[0];

    return {
      payment: {
        id: payment.id,
        bookingId: payment.bookingId,
        providerReference: payment.providerReference,
        attemptNumber: payment.attemptNumber,
        amount: payment.amountInPaise / 100,
        status: payment.status,
        createdAt: payment.createdAt,
      },
      booking: {
        id: bookingId,
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
