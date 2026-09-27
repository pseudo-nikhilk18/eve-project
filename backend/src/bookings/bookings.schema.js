import { z } from 'zod';

export const createBookingSchema = z
  .object({
    centreId: z.uuid(),
    testId: z.uuid(),
    appointmentAt: z.iso.datetime({ offset: true }).refine(
      (value) => Date.parse(value) > Date.now(),
      'Appointment date/time must be in the future',
    ),
  })
  .strict();

export const bookingParamsSchema = z.object({
  bookingId: z.uuid(),
});
