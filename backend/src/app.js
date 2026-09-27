import express from 'express';
import { createAuthRouter } from './auth/auth.routes.js';
import { createDiagnosticsRouter } from './diagnostics/diagnostics.routes.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp({ database, tokenService } = {}) {
  if (!database) {
    throw new Error('A database connection is required to create the API');
  }

  if (!tokenService) {
    throw new Error('A token service is required to create the API');
  }

  const app = express();

  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', createAuthRouter({ database, tokenService }));
  app.use('/api/v1', createDiagnosticsRouter({ database, tokenService }));
  app.use(errorHandler);

  return app;
}
