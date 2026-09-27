import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'health-test-secret' });

test('GET /health returns the API status', async () => {
  const response = await request(createApp({ database: {}, tokenService })).get(
    '/health',
  );

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^application\/json/);
  assert.deepEqual(response.body, { status: 'ok' });
});
