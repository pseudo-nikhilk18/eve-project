import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({
  secret: 'diagnostics-management-test-secret',
});

function authorizationHeader(role) {
  const accessToken = tokenService.sign({
    userId: 'c2596d51-88e8-42e1-8647-abb118e14824',
    role,
  });

  return `Bearer ${accessToken}`;
}

test('POST /api/v1/diagnostic-centres allows an admin to create a centre', async () => {
  let queryParameters;
  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;

      return {
        rows: [
          {
            id: '54a43c3e-51de-464e-9205-9f6d87443688',
            name: 'EVE Diagnostics',
            location: 'Pune',
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-centres')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: '  EVE Diagnostics  ', location: '  Pune  ' });

  assert.equal(response.status, 201);
  assert.deepEqual(queryParameters, ['EVE Diagnostics', 'Pune']);
  assert.deepEqual(response.body, {
    data: {
      centre: {
        id: '54a43c3e-51de-464e-9205-9f6d87443688',
        name: 'EVE Diagnostics',
        location: 'Pune',
        tests: [],
      },
    },
  });
});

test('POST /api/v1/diagnostic-centres requires authentication', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-centres')
    .send({ name: 'EVE Diagnostics', location: 'Pune' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/diagnostic-centres rejects a non-admin user', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-centres')
    .set('Authorization', authorizationHeader('USER'))
    .send({ name: 'EVE Diagnostics', location: 'Pune' });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    error: {
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action',
    },
  });
  assert.equal(queryCalled, false);
});

test('POST /api/v1/diagnostic-centres rejects invalid input', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-centres')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: '', location: 'Pune', isActive: true });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/diagnostic-centres rejects a duplicate centre', async () => {
  const database = {
    async query() {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      error.constraint = 'diagnostic_centres_name_location_unique';
      throw error;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-centres')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: 'EVE Diagnostics', location: 'Pune' });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'CENTRE_ALREADY_EXISTS',
      message: 'A diagnostic centre with this name and location already exists',
    },
  });
});

test('POST /api/v1/diagnostic-tests allows an admin to create a test', async () => {
  let queryParameters;
  const database = {
    async query(_sql, parameters) {
      queryParameters = parameters;

      return {
        rows: [
          {
            id: 'c9c9f963-1199-49a0-bc20-f42771b6f7cf',
            name: 'Complete Blood Count',
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-tests')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: '  Complete Blood Count  ' });

  assert.equal(response.status, 201);
  assert.deepEqual(queryParameters, ['Complete Blood Count']);
  assert.deepEqual(response.body, {
    data: {
      test: {
        id: 'c9c9f963-1199-49a0-bc20-f42771b6f7cf',
        name: 'Complete Blood Count',
      },
    },
  });
});

test('POST /api/v1/diagnostic-tests rejects a non-admin user', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-tests')
    .set('Authorization', authorizationHeader('USER'))
    .send({ name: 'Complete Blood Count' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/diagnostic-tests rejects invalid input', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-tests')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: '', price: 500 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('POST /api/v1/diagnostic-tests rejects a duplicate test', async () => {
  const database = {
    async query() {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      error.constraint = 'diagnostic_tests_name_unique';
      throw error;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .post('/api/v1/diagnostic-tests')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ name: 'Complete Blood Count' });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'DIAGNOSTIC_TEST_ALREADY_EXISTS',
      message: 'A diagnostic test with this name already exists',
    },
  });
});

test('PUT /api/v1/diagnostic-centres/:centreId/tests/:testId sets the INR price', async () => {
  let executedSql;
  let queryParameters;
  const centreId = '54a43c3e-51de-464e-9205-9f6d87443688';
  const testId = 'c9c9f963-1199-49a0-bc20-f42771b6f7cf';
  const database = {
    async query(sql, parameters) {
      executedSql = sql;
      queryParameters = parameters;

      return {
        rows: [
          {
            centreId,
            testId,
            priceInPaise: 400000,
            isAvailable: true,
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .put(`/api/v1/diagnostic-centres/${centreId}/tests/${testId}`)
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ price: 4000 });

  assert.equal(response.status, 200);
  assert.match(executedSql, /ON CONFLICT \(centre_id, diagnostic_test_id\)/);
  assert.deepEqual(queryParameters, [centreId, testId, 400000]);
  assert.deepEqual(response.body, {
    data: {
      offering: {
        centreId,
        testId,
        price: 4000,
        isAvailable: true,
      },
    },
  });
});

test('PUT /api/v1/diagnostic-centres/:centreId/tests/:testId rejects a non-admin user', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };
  const centreId = '54a43c3e-51de-464e-9205-9f6d87443688';
  const testId = 'c9c9f963-1199-49a0-bc20-f42771b6f7cf';

  const response = await request(createApp({ database, tokenService }))
    .put(`/api/v1/diagnostic-centres/${centreId}/tests/${testId}`)
    .set('Authorization', authorizationHeader('USER'))
    .send({ price: 4000 });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(queryCalled, false);
});

test('PUT /api/v1/diagnostic-centres/:centreId/tests/:testId validates IDs and price', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };

  const response = await request(createApp({ database, tokenService }))
    .put('/api/v1/diagnostic-centres/not-a-uuid/tests/not-a-uuid')
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ price: 4000.123 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('PUT /api/v1/diagnostic-centres/:centreId/tests/:testId rejects a price that exceeds database storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
    },
  };
  const centreId = '54a43c3e-51de-464e-9205-9f6d87443688';
  const testId = 'c9c9f963-1199-49a0-bc20-f42771b6f7cf';

  const response = await request(createApp({ database, tokenService }))
    .put(`/api/v1/diagnostic-centres/${centreId}/tests/${testId}`)
    .set('Authorization', authorizationHeader('ADMIN'))
    .send({ price: 99_999_999_999 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(queryCalled, false);
});

test('PUT /api/v1/diagnostic-centres/:centreId/tests/:testId rejects missing resources', async () => {
  const centreId = '54a43c3e-51de-464e-9205-9f6d87443688';
  const testId = 'c9c9f963-1199-49a0-bc20-f42771b6f7cf';
  const cases = [
    {
      constraint: 'centre_tests_centre_id_fkey',
      code: 'DIAGNOSTIC_CENTRE_NOT_FOUND',
      message: 'Diagnostic centre not found',
    },
    {
      constraint: 'centre_tests_diagnostic_test_id_fkey',
      code: 'DIAGNOSTIC_TEST_NOT_FOUND',
      message: 'Diagnostic test not found',
    },
  ];

  for (const testCase of cases) {
    const database = {
      async query() {
        const error = new Error('insert or update violates foreign key constraint');
        error.code = '23503';
        error.constraint = testCase.constraint;
        throw error;
      },
    };

    const response = await request(createApp({ database, tokenService }))
      .put(`/api/v1/diagnostic-centres/${centreId}/tests/${testId}`)
      .set('Authorization', authorizationHeader('ADMIN'))
      .send({ price: 4000 });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: {
        code: testCase.code,
        message: testCase.message,
      },
    });
  }
});
