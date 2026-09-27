import {
  bookingParamsSchema,
  createBookingSchema,
} from './bookings.schema.js';
import {
  createBooking,
  getBooking,
  listBookings,
} from './bookings.service.js';

export function createBookingsController({ database }) {
  return {
    async list(request, response) {
      const bookings = await listBookings({
        database,
        userId: request.auth.userId,
      });

      response.json({ data: { bookings } });
    },

    async get(request, response) {
      const { bookingId } = bookingParamsSchema.parse(request.params);
      const booking = await getBooking({
        database,
        userId: request.auth.userId,
        bookingId,
      });

      response.json({ data: { booking } });
    },

    async create(request, response) {
      const input = createBookingSchema.parse(request.body);
      const booking = await createBooking({
        database,
        userId: request.auth.userId,
        ...input,
      });

      response.status(201).json({ data: { booking } });
    },
  };
}
