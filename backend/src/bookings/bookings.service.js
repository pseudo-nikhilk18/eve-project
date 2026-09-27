import { HttpError } from '../errors/http-error.js';

const bookingSelection = `
  SELECT
    booking.id,
    booking.user_id AS "userId",
    centre.id AS "centreId",
    centre.name AS "centreName",
    centre.location AS "centreLocation",
    diagnostic_test.id AS "testId",
    diagnostic_test.name AS "testName",
    booking.appointment_at AS "appointmentAt",
    booking.amount_paise AS "amountInPaise",
    booking.status,
    booking.created_at AS "createdAt",
    booking.updated_at AS "updatedAt"
  FROM bookings AS booking
  JOIN centre_tests AS offering ON offering.id = booking.centre_test_id
  JOIN diagnostic_centres AS centre ON centre.id = offering.centre_id
  JOIN diagnostic_tests AS diagnostic_test
    ON diagnostic_test.id = offering.diagnostic_test_id
`;

function formatBooking(row) {
  return {
    id: row.id,
    userId: row.userId,
    centre: {
      id: row.centreId,
      name: row.centreName,
      location: row.centreLocation,
    },
    test: {
      id: row.testId,
      name: row.testName,
    },
    appointmentAt: row.appointmentAt,
    amount: row.amountInPaise / 100,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listBookings({ database, userId }) {
  const result = await database.query(
    `
      ${bookingSelection}
      WHERE booking.user_id = $1
      ORDER BY booking.created_at DESC, booking.id DESC
    `,
    [userId],
  );

  return result.rows.map(formatBooking);
}

export async function getBooking({ database, userId, bookingId }) {
  const result = await database.query(
    `
      ${bookingSelection}
      WHERE booking.user_id = $1
        AND booking.id = $2
    `,
    [userId, bookingId],
  );
  const booking = result.rows[0];

  if (!booking) {
    throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }

  return formatBooking(booking);
}

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
          SELECT
            offering.id,
            offering.price_paise,
            centre.id AS centre_id,
            centre.name AS centre_name,
            centre.location AS centre_location,
            diagnostic_test.id AS diagnostic_test_id,
            diagnostic_test.name AS diagnostic_test_name
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
        ),
        inserted_booking AS (
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
            user_id,
            centre_test_id,
            appointment_at,
            amount_paise,
            status,
            created_at,
            updated_at
        )
        SELECT
          booking.id,
          booking.user_id AS "userId",
          offering.centre_id AS "centreId",
          offering.centre_name AS "centreName",
          offering.centre_location AS "centreLocation",
          offering.diagnostic_test_id AS "testId",
          offering.diagnostic_test_name AS "testName",
          booking.appointment_at AS "appointmentAt",
          booking.amount_paise AS "amountInPaise",
          booking.status,
          booking.created_at AS "createdAt",
          booking.updated_at AS "updatedAt"
        FROM inserted_booking AS booking
        JOIN selected_offering AS offering
          ON offering.id = booking.centre_test_id
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

    return formatBooking(booking);
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
