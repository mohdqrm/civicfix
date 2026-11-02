// Shared helpers for the API tests.
import crypto from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';

export const TEST_ADMIN = { name: 'Test Admin', email: 'admin@test.civicfix', password: 'AdminPass123' };

// Generous limits so normal tests never trip them; rate limiting has its own test.
export const NO_LIMITS = {
  global: { windowMs: 60000, limit: 100000 },
  auth: { windowMs: 60000, limit: 100000 },
  createComplaint: { windowMs: 60000, limit: 100000 },
};

let appPromise;
/** One app instance per test file (imported lazily so NODE_ENV=test is set first). */
export async function getApp() {
  appPromise ??= import('../src/app.js').then(({ createApp }) => createApp({ rateLimits: NO_LIMITS }));
  return appPromise;
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.civicfix`;

/** Register a fresh citizen; returns a supertest agent that keeps the session cookie. */
export async function newCitizen(app, overrides = {}) {
  const agent = request.agent(app);
  const body = { name: 'Test Citizen', email: uniqueEmail('citizen'), password: 'Passw0rd!', ...overrides };
  const res = await agent.post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user, password: body.password };
}

export async function adminAgent(app) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return agent;
}

let jpegCache;
/** A real 800x600 JPEG carrying EXIF data (to prove it gets stripped). */
export async function testJpeg() {
  jpegCache ??= await sharp({ create: { width: 800, height: 600, channels: 3, background: '#7a6a55' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'GPS-Leaker 3000' } })
    .toBuffer();
  return jpegCache;
}

// A spot in central Delhi; offset() moves north by `metres` so tests can control distance.
export const BASE = { lat: 28.6139, lng: 77.209 };
export const offset = (metres) => +(BASE.lat + metres / 111320).toFixed(6);

/**
 * A random spot somewhere in India, far (with overwhelming probability) from every
 * other test complaint, so tests don't trigger each other's duplicate suggestions.
 * Test files run in separate module contexts, so a counter would repeat across files.
 */
export function isolatedSpot() {
  const r = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
  return { lat: +(12 + r() * 16).toFixed(6), lng: +(72 + r() * 16).toFixed(6) };
}

export async function fileComplaint(agent, fields = {}, { photo = true } = {}) {
  const where = fields.latitude !== undefined ? {} : isolatedSpot();
  const f = {
    categoryId: 1,
    title: 'Pothole on test road',
    description: 'A deep pothole in the middle of the test road.',
    latitude: where.lat,
    longitude: where.lng,
    ...fields,
  };
  let req = agent.post('/api/complaints');
  for (const [k, v] of Object.entries(f)) if (v !== undefined) req = req.field(k, String(v));
  if (photo) req = req.attach('photo', await testJpeg(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  return req;
}

/** Direct DB access for assertions (the API is what's under test; this just checks its effects). */
export async function db() {
  const { pool } = await import('../src/db/pool.js');
  return pool;
}
