import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;

  try {
    client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    const result = await client.query('SELECT filename FROM schema_migrations');
    const appliedMigrations = new Set(
      result.rows.map(({ filename }) => filename),
    );

    let appliedCount = 0;

    for (const filename of migrationFiles) {
      if (appliedMigrations.has(filename)) {
        continue;
      }

      const sql = await readFile(join(migrationsDirectory, filename), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        appliedCount += 1;
        console.log(`Applied migration: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    if (appliedCount === 0) {
      console.log('Database schema is up to date');
    }
  } finally {
    client?.release();
    await pool.end();
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

migrate().catch((error) => {
  console.error(`Database migration failed: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
