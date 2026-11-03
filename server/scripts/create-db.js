// npm run db:create  — create the database named in DATABASE_URL if it doesn't exist yet.
// Saves beginners from opening pgAdmin or psql. It never drops or changes anything.
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Check server/.env');
  process.exit(1);
}

const target = new URL(url);
const dbName = decodeURIComponent(target.pathname.slice(1));
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Database name "${dbName}" should contain only letters, numbers and _`);
  process.exit(1);
}

// Connect to the built-in "postgres" database to run CREATE DATABASE.
const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({
  connectionString: admin.toString(),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount) {
    console.log(`Database "${dbName}" already exists.`);
  } else {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database "${dbName}".`);
  }
} catch (err) {
  if (err.code === '28P01') {
    console.error('PostgreSQL rejected the password. Fix the password in DATABASE_URL in server/.env');
  } else if (err.code === 'ECONNREFUSED') {
    console.error('Could not reach PostgreSQL on that address. Is PostgreSQL installed and running?');
  } else {
    console.error(err.message);
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
