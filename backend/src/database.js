import pg from 'pg';

const { Pool } = pg;

export function createDatabasePool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to start the API');
  }

  return new Pool({ connectionString });
}
