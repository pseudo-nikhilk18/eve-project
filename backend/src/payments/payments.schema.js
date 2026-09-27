import { z } from 'zod';

export const createPaymentSchema = z
  .object({
    bookingId: z.uuid(),
    simulateOutcome: z.enum(['SUCCESS', 'FAILED']),
  })
  .strict();

export const paymentWebhookSchema = z
  .object({
    eventId: z.string().trim().min(1).max(120),
    providerReference: z.string().trim().min(1).max(120),
    status: z.enum(['SUCCESS', 'FAILED']),
  })
  .strict();
