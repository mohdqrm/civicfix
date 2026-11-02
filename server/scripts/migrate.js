// npm run db:migrate  — create/upgrade the tables in DATABASE_URL.
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

try {
  await migrate(pool);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
