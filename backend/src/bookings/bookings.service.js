import { HttpError } from '../errors/http-error.js';

export async function createBooking({
  database,
  userId,
  centreId,
  testId,
  appointmentAt,
}) {
  try {
    const result = await database.query(
      `
        WITH selected_offering AS (
          SELECT offering.id, offering.price_paise
          FROM centre_tests AS offering
          JOIN diagnostic_centres AS centre
            ON centre.id = offering.centre_id
          JOIN diagnostic_tests AS diagnostic_test
            ON diagnostic_test.id = offering.diagnostic_test_id
          WHERE centre.id = $2
            AND diagnostic_test.id = $3
            AND centre.is_active = true
            AND diagnostic_test.is_active = true
            AND offering.is_available = true
        )
        INSERT INTO bookings (
          user_id,
          centre_test_id,
          appointment_at,
          amount_paise
        )
        SELECT $1, id, $4, price_paise
        FROM selected_offering
        RETURNING
          id,
          user_id AS "userId",
          appointment_at AS "appointmentAt",
          amount_paise AS "amountInPaise",
          status,
          created_at AS "createdAt"
      `,
      [userId, centreId, testId, appointmentAt],
    );

    const booking = result.rows[0];

    if (!booking) {
      throw new HttpError(
        404,
        'DIAGNOSTIC_OFFERING_NOT_FOUND',
        'The selected diagnostic test is not available at this centre',
      );
    }

    return {
      id: booking.id,
      userId: booking.userId,
      centreId,
      testId,
      appointmentAt: booking.appointmentAt,
      amount: booking.amountInPaise / 100,
      status: booking.status,
      createdAt: booking.createdAt,
    };
  } catch (error) {
    if (
      error.code === '23505' &&
      error.constraint === 'bookings_active_slot_unique'
    ) {
      throw new HttpError(
        409,
        'BOOKING_ALREADY_EXISTS',
        'An active booking already exists for this test and appointment time',
      );
    }

    throw error;
  }
}
