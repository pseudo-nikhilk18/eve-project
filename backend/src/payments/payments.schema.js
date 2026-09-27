import { z } from 'zod';

export const createPaymentSchema = z
  .object({
    bookingId: z.uuid(),
    simulateOutcome: z.enum(['SUCCESS', 'FAILED']),
  })
  .strict();
