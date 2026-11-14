// Runs once before the API tests: wipes and rebuilds the *test* database
// (civicfix_test by default, or TEST_DATABASE_URL), then loads reference data.
// It refuses to touch any database whose name doesn't end in "_test", so it can
// never wipe your development or production data.
// Load server/.env so TEST_DATABASE_URL (with its password) is picked up from a fresh clone.
import 'dotenv/config';
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { seedReference } from '../src/db/seedData.js';
import { TEST_ADMIN } from './helpers.js';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/civicfix_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": test database names must end in _test`);
  }
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool, () => {});
    await seedReference(pool, { admin: TEST_ADMIN, bcryptRounds: 4 });
  } finally {
    await pool.end();
  }
}
