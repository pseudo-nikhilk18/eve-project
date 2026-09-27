import { createBookingSchema } from './bookings.schema.js';
import { createBooking } from './bookings.service.js';

export function createBookingsController({ database }) {
  return {
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
