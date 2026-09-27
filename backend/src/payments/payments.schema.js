import { z } from 'zod';
import { databaseText } from '../validation.js';

export const createPaymentSchema = z
  .object({
    bookingId: z.uuid(),
    simulateOutcome: z.enum(['SUCCESS', 'FAILED']),
  })
  .strict();

export const paymentWebhookSchema = z
  .object({
    eventId: databaseText(z.string().trim().min(1).max(120)),
    providerReference: databaseText(z.string().trim().min(1).max(120)),
    status: z.enum(['SUCCESS', 'FAILED']),
  })
  .strict();
