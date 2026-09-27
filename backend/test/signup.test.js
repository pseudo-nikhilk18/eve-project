import assert from 'node:assert/strict';
import { test } from 'node:test';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'signup-test-secret' });

const validSignup = {
  fullName: 'Nikhil Kalaskar',
  email: 'Nikhil@example.com',
  password: 'diagnostic-booking-password',
};

test('POST /api/v1/auth/signup creates a user with a hashed password', async () => {
  let queryParameters;

  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;

      return {
        rows: [
          {
            id: 'c2596d51-88e8-42e1-8647-abb118e14824',
            fullName: 'Nikhil Kalaskar',
            email: 'nikhil@example.com',
            role: 'USER',
            createdAt: '2026-09-27T08:00:00.000Z',
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/signup')
    .send(validSignup);

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    data: {
      user: {
        id: 'c2596d51-88e8-42e1-8647-abb118e14824',
        fullName: 'Nikhil Kalaskar',
        email: 'nikhil@example.com',
        role: 'USER',
        createdAt: '2026-09-27T08:00:00.000Z',
      },
    },
  });
  assert.equal(queryParameters[0], 'Nikhil Kalaskar');
  assert.equal(queryParameters[1], 'nikhil@example.com');
  assert.notEqual(queryParameters[2], validSignup.password);
  assert.equal(await argon2.verify(queryParameters[2], validSignup.password), true);
});

test('POST /api/v1/auth/signup rejects invalid input', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/signup')
    .send({
      fullName: 'N',
      email: 'not-an-email',
      password: 'short',
      role: 'ADMIN',
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/auth/signup rejects malformed JSON', async () => {
  const response = await request(createApp({ database: {}, tokenService }))
    .post('/api/v1/auth/signup')
    .set('Content-Type', 'application/json')
    .send('{"email":');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    error: {
      code: 'INVALID_JSON',
      message: 'Request body must contain valid JSON',
    },
  });
});

test('POST /api/v1/auth/signup rejects a duplicate email', async () => {
  const database = {
    async query() {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      error.constraint = 'users_email_key';
      throw error;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/auth/signup')
    .send(validSignup);

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'An account with this email already exists',
    },
  });
});
