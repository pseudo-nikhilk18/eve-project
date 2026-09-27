import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'not-found-test-secret' });

test('unknown routes return the API JSON error format', async () => {
  const response = await request(
    createApp({ database: {}, tokenService }),
  ).get('/api/v1/not-found');

  assert.equal(response.status, 404);
  assert.match(response.headers['content-type'], /^application\/json/);
  assert.deepEqual(response.body, {
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
    },
  });
});
