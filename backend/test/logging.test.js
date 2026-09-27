import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';
import { createLogger } from '../src/logger.js';
import { createErrorHandler } from '../src/middleware/error-handler.js';

const tokenService = createTokenService({ secret: 'logging-test-secret' });

function createRecordingLogger() {
  const records = [];

  return {
    records,
    logger: {
      info(event, fields) {
        records.push({ level: 'info', event, ...fields });
      },
      warn(event, fields) {
        records.push({ level: 'warn', event, ...fields });
      },
      error(event, fields) {
        records.push({ level: 'error', event, ...fields });
      },
    },
  };
}

test('logger writes one JSON record per line', () => {
  const chunks = [];
  const logger = createLogger({
    output: {
      write(chunk) {
        chunks.push(chunk);
      },
    },
    now: () => new Date('2026-09-27T10:00:00.000Z'),
  });

  logger.info('server.started', {
    port: 3000,
    level: 'overridden',
    event: 'overridden',
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].endsWith('\n'), true);
  assert.deepEqual(JSON.parse(chunks[0]), {
    timestamp: '2026-09-27T10:00:00.000Z',
    level: 'info',
    event: 'server.started',
    port: 3000,
  });
});

test('HTTP logging correlates a request without recording its query string', async () => {
  const { logger, records } = createRecordingLogger();
  const app = createApp({ database: {}, tokenService, logger });

  const response = await request(app)
    .get('/health?access_token=must-not-be-logged')
    .set('X-Request-Id', 'request-123');

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-request-id'], 'request-123');
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'http.request.completed');
  assert.equal(records[0].requestId, 'request-123');
  assert.equal(records[0].method, 'GET');
  assert.equal(records[0].path, '/health');
  assert.equal(records[0].statusCode, 200);
  assert.equal(records[0].durationMs >= 0, true);
  assert.equal(JSON.stringify(records).includes('must-not-be-logged'), false);
});

test('HTTP logging replaces an unsafe request ID', async () => {
  const { logger, records } = createRecordingLogger();
  const app = createApp({ database: {}, tokenService, logger });

  const response = await request(app)
    .get('/health')
    .set('X-Request-Id', 'unsafe request id');

  assert.match(
    response.headers['x-request-id'],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(records[0].requestId, response.headers['x-request-id']);
});

test('HTTP logging preserves the complete mounted API path', async () => {
  const { logger, records } = createRecordingLogger();
  const app = createApp({ database: {}, tokenService, logger });

  const response = await request(app).get('/api/v1/not-found');

  assert.equal(response.status, 404);
  assert.equal(records[0].path, '/api/v1/not-found');
});

test('unexpected request failures produce a structured error record', () => {
  const { logger, records } = createRecordingLogger();
  const handler = createErrorHandler({ logger });
  let responseStatus;
  let responseBody;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  handler(
    new Error('Database unavailable'),
    { requestId: 'request-456' },
    response,
  );

  assert.equal(responseStatus, 500);
  assert.equal(responseBody.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'error');
  assert.equal(records[0].event, 'http.request.failed');
  assert.equal(records[0].requestId, 'request-456');
  assert.equal(records[0].error.message, 'Database unavailable');
});
