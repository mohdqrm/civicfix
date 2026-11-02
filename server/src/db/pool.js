// One shared PostgreSQL connection pool for the whole server.
// Every query goes through pg's parameter placeholders ($1, $2 ...), which is
// what prevents SQL injection: user input is sent as data, never spliced into SQL.
import pg from 'pg';
import { config } from '../config.js';

// Return NUMERIC columns (latitude, longitude, score) as JS numbers instead of strings.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// COUNT(*) is BIGINT; our counts always fit in a JS number.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction; rolls back if it throws. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
