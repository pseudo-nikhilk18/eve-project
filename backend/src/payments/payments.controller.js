import {
  createPaymentSchema,
  paymentWebhookSchema,
} from './payments.schema.js';
import { processSimulatedPayment } from './payments.service.js';
import { processPaymentWebhook } from './webhook.service.js';

export function createPaymentsController({ database }) {
  return {
    async create(request, response) {
      const input = createPaymentSchema.parse(request.body);
      const result = await processSimulatedPayment({
        database,
        userId: request.auth.userId,
        ...input,
      });

      response.status(201).json({ data: result });
    },

    async webhook(request, response) {
      const input = paymentWebhookSchema.parse(request.body);
      const result = await processPaymentWebhook({ database, ...input });
      const statusCode =
        result.event.processingStatus === 'PROCESSED' ? 200 : 202;

      response.status(statusCode).json({ data: result });
    },
  };
}
