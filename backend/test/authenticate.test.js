import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createTokenService } from '../src/auth/token.service.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';

const tokenService = createTokenService({ secret: 'middleware-test-secret' });

function createProtectedApp() {
  const app = express();

  app.get(
    '/protected',
    createAuthenticate({ tokenService }),
    (protectedRequest, response) => {
      response.json({ data: protectedRequest.auth });
    },
  );
  app.use(errorHandler);

  return app;
}

test('authentication middleware accepts a valid bearer token', async () => {
  const accessToken = tokenService.sign({
    userId: 'c2596d51-88e8-42e1-8647-abb118e14824',
    role: 'USER',
  });
  const response = await request(createProtectedApp())
    .get('/protected')
    .set('Authorization', `Bearer ${accessToken}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    data: {
      userId: 'c2596d51-88e8-42e1-8647-abb118e14824',
      role: 'USER',
    },
  });
});

test('authentication middleware rejects missing and invalid tokens', async () => {
  for (const authorization of [undefined, 'Bearer invalid-token']) {
    const pendingRequest = request(createProtectedApp()).get('/protected');

    if (authorization) {
      pendingRequest.set('Authorization', authorization);
    }

    const response = await pendingRequest;

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication is required',
      },
    });
  }
});
