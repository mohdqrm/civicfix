// Central place for every setting read from environment variables.
// Values come from server/.env locally (see .env.example) and from the host's
// dashboard in production. Nothing secret is hard-coded for production use.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  return devFallback;
}

const jwtSecret = required('JWT_SECRET', 'dev-only-secret-change-me-dev-only-secret');
if (isProd && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const config = Object.freeze({
  env,
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/civicfix_test'
    : required('DATABASE_URL', 'postgres://postgres@localhost:5432/civicfix'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret,
  sessionDays: 7,
  // Origin of the React dev server; only needed when frontend and API are on different origins.
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  // Number of reverse proxies in front of the app (1 on Render/Railway), so rate limits see real IPs.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  storageDriver: process.env.STORAGE_DRIVER ?? 'local', // 'local' | 'cloudinary'
  uploadDir: path.resolve(serverRoot, process.env.UPLOAD_DIR ?? 'uploads'),
  cloudinaryUrl: process.env.CLOUDINARY_URL ?? '',
  maxUploadBytes: 5 * 1024 * 1024,
  clientDist: path.resolve(serverRoot, '../client/dist'),
  serverRoot,
});
