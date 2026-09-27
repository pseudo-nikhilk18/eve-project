import express from 'express';
import { createAuthRouter } from './auth/auth.routes.js';
import { createBookingsRouter } from './bookings/bookings.routes.js';
import { createDiagnosticsRouter } from './diagnostics/diagnostics.routes.js';
import { silentLogger } from './logger.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createPaymentsRouter } from './payments/payments.routes.js';

export function createApp({ database, tokenService, logger = silentLogger } = {}) {
  if (!database) {
    throw new Error('A database connection is required to create the API');
  }

  if (!tokenService) {
    throw new Error('A token service is required to create the API');
  }

  const app = express();

  app.use(createRequestLogger({ logger }));
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', createAuthRouter({ database, tokenService }));
  app.use('/api/v1', createDiagnosticsRouter({ database, tokenService }));
  app.use('/api/v1/bookings', createBookingsRouter({ database, tokenService }));
  app.use('/api/v1/payments', createPaymentsRouter({ database, tokenService }));
  app.use(notFound);
  app.use(createErrorHandler({ logger }));

  return app;
}
