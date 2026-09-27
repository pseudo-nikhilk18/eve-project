import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const centres = [
  {
    key: 'pune',
    name: 'EVE Diagnostics',
    location: 'Pune, Maharashtra',
  },
  {
    key: 'mumbai',
    name: 'EVE Diagnostics',
    location: 'Mumbai, Maharashtra',
  },
  {
    key: 'delhi',
    name: 'EVE Diagnostics',
    location: 'New Delhi, Delhi',
  },
  {
    key: 'bengaluru',
    name: 'EVE Diagnostics',
    location: 'Bengaluru, Karnataka',
  },
  {
    key: 'hyderabad',
    name: 'EVE Diagnostics',
    location: 'Hyderabad, Telangana',
  },
];

const diagnosticTests = [
  { key: 'cbc', name: 'Complete Blood Count' },
  { key: 'thyroid', name: 'Thyroid Profile' },
  { key: 'hba1c', name: 'HbA1c' },
  { key: 'lipid', name: 'Lipid Profile' },
  { key: 'liver', name: 'Liver Function Test' },
  { key: 'kidney', name: 'Kidney Function Test' },
  { key: 'vitamin_d', name: 'Vitamin D' },
  { key: 'vitamin_b12', name: 'Vitamin B12' },
];

const offerings = [
  { centreKey: 'pune', testKey: 'cbc', pricePaise: 80_000 },
  { centreKey: 'pune', testKey: 'thyroid', pricePaise: 120_000 },
  { centreKey: 'pune', testKey: 'hba1c', pricePaise: 65_000 },
  { centreKey: 'pune', testKey: 'lipid', pricePaise: 100_000 },
  { centreKey: 'pune', testKey: 'liver', pricePaise: 110_000 },
  { centreKey: 'pune', testKey: 'kidney', pricePaise: 105_000 },
  { centreKey: 'pune', testKey: 'vitamin_d', pricePaise: 170_000 },
  { centreKey: 'mumbai', testKey: 'cbc', pricePaise: 90_000 },
  { centreKey: 'mumbai', testKey: 'thyroid', pricePaise: 130_000 },
  { centreKey: 'mumbai', testKey: 'hba1c', pricePaise: 70_000 },
  { centreKey: 'mumbai', testKey: 'lipid', pricePaise: 110_000 },
  { centreKey: 'mumbai', testKey: 'liver', pricePaise: 120_000 },
  { centreKey: 'mumbai', testKey: 'vitamin_d', pricePaise: 180_000 },
  { centreKey: 'mumbai', testKey: 'vitamin_b12', pricePaise: 150_000 },
  { centreKey: 'delhi', testKey: 'cbc', pricePaise: 75_000 },
  { centreKey: 'delhi', testKey: 'thyroid', pricePaise: 115_000 },
  { centreKey: 'delhi', testKey: 'hba1c', pricePaise: 62_500 },
  { centreKey: 'delhi', testKey: 'lipid', pricePaise: 95_000 },
  { centreKey: 'delhi', testKey: 'kidney', pricePaise: 100_000 },
  { centreKey: 'delhi', testKey: 'vitamin_b12', pricePaise: 140_000 },
  { centreKey: 'bengaluru', testKey: 'cbc', pricePaise: 85_000 },
  { centreKey: 'bengaluru', testKey: 'thyroid', pricePaise: 125_000 },
  { centreKey: 'bengaluru', testKey: 'hba1c', pricePaise: 67_500 },
  { centreKey: 'bengaluru', testKey: 'liver', pricePaise: 115_000 },
  { centreKey: 'bengaluru', testKey: 'kidney', pricePaise: 110_000 },
  { centreKey: 'bengaluru', testKey: 'vitamin_d', pricePaise: 175_000 },
  { centreKey: 'bengaluru', testKey: 'vitamin_b12', pricePaise: 145_000 },
  { centreKey: 'hyderabad', testKey: 'cbc', pricePaise: 70_000 },
  { centreKey: 'hyderabad', testKey: 'thyroid', pricePaise: 110_000 },
  { centreKey: 'hyderabad', testKey: 'hba1c', pricePaise: 60_000 },
  { centreKey: 'hyderabad', testKey: 'lipid', pricePaise: 90_000 },
  { centreKey: 'hyderabad', testKey: 'liver', pricePaise: 100_000 },
  { centreKey: 'hyderabad', testKey: 'kidney', pricePaise: 95_000 },
];

async function ensureCentre(client, centre) {
  const insertResult = await client.query(
    `
      INSERT INTO diagnostic_centres (name, location)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [centre.name, centre.location],
  );

  if (insertResult.rows[0]) {
    return { id: insertResult.rows[0].id, inserted: true };
  }

  const existingResult = await client.query(
    `
      SELECT id
      FROM diagnostic_centres
      WHERE lower(name) = lower($1)
        AND lower(location) = lower($2)
    `,
    [centre.name, centre.location],
  );

  return { id: existingResult.rows[0].id, inserted: false };
}

async function ensureDiagnosticTest(client, diagnosticTest) {
  const insertResult = await client.query(
    `
      INSERT INTO diagnostic_tests (name)
      VALUES ($1)
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [diagnosticTest.name],
  );

  if (insertResult.rows[0]) {
    return { id: insertResult.rows[0].id, inserted: true };
  }

  const existingResult = await client.query(
    `
      SELECT id
      FROM diagnostic_tests
      WHERE lower(name) = lower($1)
    `,
    [diagnosticTest.name],
  );

  return { id: existingResult.rows[0].id, inserted: false };
}

export async function seedDatabase(database) {
  const client = await database.connect();
  const centreIds = new Map();
  const testIds = new Map();
  const inserted = { centres: 0, tests: 0, offerings: 0 };

  try {
    await client.query('BEGIN');

    for (const centre of centres) {
      const result = await ensureCentre(client, centre);
      centreIds.set(centre.key, result.id);
      inserted.centres += Number(result.inserted);
    }

    for (const diagnosticTest of diagnosticTests) {
      const result = await ensureDiagnosticTest(client, diagnosticTest);
      testIds.set(diagnosticTest.key, result.id);
      inserted.tests += Number(result.inserted);
    }

    for (const offering of offerings) {
      const result = await client.query(
        `
          INSERT INTO centre_tests (
            centre_id,
            diagnostic_test_id,
            price_paise
          )
          VALUES ($1, $2, $3)
          ON CONFLICT (centre_id, diagnostic_test_id) DO NOTHING
        `,
        [
          centreIds.get(offering.centreKey),
          testIds.get(offering.testKey),
          offering.pricePaise,
        ],
      );
      inserted.offerings += result.rowCount;
    }

    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function getErrorMessage(error) {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map((nestedError) => nestedError.message).join('; ');
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error) || 'Unknown error';
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const inserted = await seedDatabase(pool);
    console.log(
      `Database seed complete: ${inserted.centres} centres, ` +
        `${inserted.tests} tests, and ${inserted.offerings} offerings added`,
    );
  } finally {
    await pool.end();
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;

if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`Database seed failed: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
