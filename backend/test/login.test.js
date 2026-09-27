import assert from 'node:assert/strict';
import { test } from 'node:test';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const password = 'diagnostic-booking-password';
const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
const tokenService = createTokenService({ secret: 'login-test-secret' });
const storedUser = {
  id: 'c2596d51-88e8-42e1-8647-abb118e14824',
  fullName: 'Nikhil Kalaskar',
  email: 'nikhil@example.com',
  passwordHash,
  role: 'USER',
  createdAt: '2026-09-27T08:00:00.000Z',
};

function createDatabase(rows) {
  return {
    async query() {
      return { rows };
    },
  };
}

test('POST /api/v1/auth/login returns a JWT for valid credentials', async () => {
  const database = createDatabase([storedUser]);
  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/login')
    .send({ email: 'Nikhil@example.com', password });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.id, storedUser.id);
  assert.equal(response.body.data.user.email, storedUser.email);
  assert.equal(response.body.data.user.passwordHash, undefined);
  assert.equal(response.body.data.tokenType, 'Bearer');
  assert.equal(response.body.data.expiresIn, 3600);

  const payload = tokenService.verify(response.body.data.accessToken);
  assert.equal(payload.sub, storedUser.id);
  assert.equal(payload.role, 'USER');
  assert.equal(payload.exp - payload.iat, 3600);
});

test('POST /api/v1/auth/login rejects an incorrect password', async () => {
  const database = createDatabase([storedUser]);
  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/login')
    .send({ email: storedUser.email, password: 'incorrect-password' });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    },
  });
});

test('POST /api/v1/auth/login rejects an unknown email', async () => {
  const database = createDatabase([]);
  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/login')
    .send({ email: 'unknown@example.com', password });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    },
  });
});
