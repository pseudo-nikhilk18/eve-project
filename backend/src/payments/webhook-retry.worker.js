import { HttpError } from '../errors/http-error.js';
import { serializeError, silentLogger } from '../logger.js';
import { processStoredWebhookEvent } from './webhook.service.js';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 20;

export async function processDueWebhookEvents({
  database,
  batchSize = DEFAULT_BATCH_SIZE,
  logger = silentLogger,
}) {
  const result = await database.query(
    `
      SELECT provider_event_id AS "eventId"
      FROM webhook_events
      WHERE processing_status IN ('PENDING', 'RETRY_PENDING')
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at, created_at
      LIMIT $1
    `,
    [batchSize],
  );

  for (const { eventId } of result.rows) {
    try {
      const processed = await processStoredWebhookEvent({ database, eventId });

      if (processed.event.processingStatus === 'PROCESSED') {
        logger.info('webhook.retry.processed', { eventId });
      } else {
        logger.warn('webhook.retry.deferred', {
          eventId,
          attemptCount: processed.event.attemptCount,
          nextAttemptAt: processed.event.nextAttemptAt,
        });
      }
    } catch (error) {
      if (!(error instanceof HttpError)) {
        throw error;
      }

      logger.warn('webhook.retry.exhausted', {
        eventId,
        error: serializeError(error),
      });
    }
  }

  return result.rows.length;
}

export function startWebhookRetryWorker({
  database,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  logger = silentLogger,
}) {
  let timer;
  let stopped = false;
  let activeCycle = Promise.resolve();

  function scheduleNextCycle() {
    if (stopped) {
      return;
    }

    timer = setTimeout(runCycle, pollIntervalMs);
    timer.unref?.();
  }

  async function runCycle() {
    activeCycle = processDueWebhookEvents({ database, logger }).catch((error) => {
      logger.error('webhook.retry_cycle.failed', {
        error: serializeError(error),
      });
    });
    await activeCycle;
    scheduleNextCycle();
  }

  scheduleNextCycle();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await activeCycle;
    },
  };
}
