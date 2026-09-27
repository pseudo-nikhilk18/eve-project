import { createApp } from './app.js';
import { createTokenService } from './auth/token.service.js';
import { createDatabasePool } from './database.js';
import { createLogger, serializeError } from './logger.js';
import { startWebhookRetryWorker } from './payments/webhook-retry.worker.js';

const port = process.env.PORT || 3000;
const logger = createLogger();
const tokenService = createTokenService({ secret: process.env.JWT_SECRET });
const database = createDatabasePool();
const app = createApp({ database, tokenService, logger });
let webhookRetryWorker;

const server = app.listen(port, () => {
  webhookRetryWorker = startWebhookRetryWorker({ database, logger });
  logger.info('server.started', { port: Number(port) });
});

server.once('error', async (error) => {
  logger.error('server.start_failed', { error: serializeError(error) });
  await webhookRetryWorker?.stop();
  await database.end();
  process.exitCode = 1;
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info('server.shutdown_started', { signal });
  const retryWorkerStopped = webhookRetryWorker?.stop() ?? Promise.resolve();

  server.close(async (error) => {
    await retryWorkerStopped;
    await database.end();

    if (error) {
      logger.error('server.shutdown_failed', { error: serializeError(error) });
      process.exitCode = 1;
      return;
    }

    logger.info('server.stopped');
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
