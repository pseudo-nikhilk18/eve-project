import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth/token.service.js';

const tokenService = createTokenService({ secret: 'diagnostics-test-secret' });

test('GET /api/v1/diagnostic-centres returns centres with offered tests', async () => {
  const database = {
    async query() {
      return {
        rows: [
          {
            centreId: '54a43c3e-51de-464e-9205-9f6d87443688',
            centreName: 'EVE Diagnostics',
            location: 'Pune',
            testId: 'c9c9f963-1199-49a0-bc20-f42771b6f7cf',
            testName: 'Complete Blood Count',
            priceInPaise: 50000,
          },
          {
            centreId: '54a43c3e-51de-464e-9205-9f6d87443688',
            centreName: 'EVE Diagnostics',
            location: 'Pune',
            testId: '771c5344-b2f4-4d32-8c6f-67d75b79c57d',
            testName: 'Thyroid Profile',
            priceInPaise: 90000,
          },
          {
            centreId: '88d9e060-e2a5-43fc-bf67-f5efadd11980',
            centreName: 'Northside Labs',
            location: 'Mumbai',
            testId: null,
            testName: null,
            priceInPaise: null,
          },
        ],
      };
    },
  };

  const response = await request(createApp({ database, tokenService })).get(
    '/api/v1/diagnostic-centres',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    data: {
      centres: [
        {
          id: '54a43c3e-51de-464e-9205-9f6d87443688',
          name: 'EVE Diagnostics',
          location: 'Pune',
          tests: [
            {
              id: 'c9c9f963-1199-49a0-bc20-f42771b6f7cf',
              name: 'Complete Blood Count',
              price: 500,
            },
            {
              id: '771c5344-b2f4-4d32-8c6f-67d75b79c57d',
              name: 'Thyroid Profile',
              price: 900,
            },
          ],
        },
        {
          id: '88d9e060-e2a5-43fc-bf67-f5efadd11980',
          name: 'Northside Labs',
          location: 'Mumbai',
          tests: [],
        },
      ],
    },
  });
});

test('GET /api/v1/diagnostic-centres returns an empty list when none exist', async () => {
  const database = {
    async query() {
      return { rows: [] };
    },
  };

  const response = await request(createApp({ database, tokenService })).get(
    '/api/v1/diagnostic-centres',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { data: { centres: [] } });
});
