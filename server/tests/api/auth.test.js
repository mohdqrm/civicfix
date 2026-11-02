import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { NO_LIMITS, TEST_ADMIN, db, getApp, newCitizen, uniqueEmail } from '../helpers.js';

let app;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => (await db()).end());

describe('POST /api/auth/register', () => {
  it('creates a citizen, sets an httpOnly session cookie and never returns the password hash', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: '  Priya Singh ', email: email.toUpperCase(), password: 'GoodPass1' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Priya Singh', email, role: 'citizen' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/cf_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const { rows } = await (await db()).query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12 — never plain text
  });

  it('ignores an attempt to register as admin', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: uniqueEmail('sneaky'), password: 'GoodPass1', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('citizen');
  });

  it('rejects duplicate emails regardless of case', async () => {
    const email = uniqueEmail('dup');
    await request(app).post('/api/auth/register').send({ name: 'One', email, password: 'GoodPass1' });
    const res = await request(app).post('/api/auth/register').send({ name: 'Two', email: email.toUpperCase(), password: 'GoodPass1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it.each([
    [{}, ['name', 'email', 'password']],
    [{ name: 'A', email: 'not-an-email', password: 'short' }, ['name', 'email', 'password']],
    [{ name: 'Valid Name', email: 'ok@test.civicfix', password: 'lettersonly' }, ['password']],
    [{ name: 'Valid Name', email: 'ok@test.civicfix', password: '12345678' }, ['password']],
  ])('validates input %#', async (body, fields) => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    const got = new Set(res.body.error.details.map((d) => d.field));
    for (const f of fields) expect(got.has(f)).toBe(true);
  });

  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/JSON/);
  });
});

describe('login / me / logout', () => {
  it('logs in, identifies the user, then logs out', async () => {
    const { user, password } = await newCitizen(app);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email.toUpperCase(), password });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.id);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('gives the same error for wrong password and unknown email', async () => {
    const { user } = await newCitizen(app);
    const wrongPw = await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass9' });
    const noUser = await request(app).post('/api/auth/login').send({ email: uniqueEmail('ghost'), password: 'WrongPass9' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it('admin can log in with the seeded account', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects a tampered or forged session token', async () => {
    const { agent } = await newCitizen(app);
    const me = await agent.get('/api/auth/me');
    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign({ sub: String(me.body.user.id) }, 'not-the-real-secret');
    const res = await request(app).get('/api/auth/me').set('Cookie', `cf_token=${forged}`);
    expect(res.status).toBe(401);
    const none = jwt.default.sign({ sub: '1' }, '', { algorithm: 'none' });
    expect((await request(app).get('/api/admin/stats').set('Cookie', `cf_token=${none}`)).status).toBe(401);
  });
});

describe('profile', () => {
  it('updates name and phone, and can clear the phone', async () => {
    const { agent } = await newCitizen(app);
    const r1 = await agent.patch('/api/me').send({ name: 'New Name', phone: '+91 98765 43210' });
    expect(r1.status).toBe(200);
    expect(r1.body.user).toMatchObject({ name: 'New Name', phone: '+91 98765 43210' });
    const r2 = await agent.patch('/api/me').send({ name: 'Newer Name' });
    expect(r2.body.user.phone).toBe('+91 98765 43210'); // untouched when not sent
    const r3 = await agent.patch('/api/me').send({ phone: null });
    expect(r3.body.user.phone).toBeNull();
    expect((await agent.patch('/api/me').send({ phone: 'call me maybe' })).status).toBe(400);
    expect((await agent.patch('/api/me').send({ role: 'admin' })).status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('blocks repeated login attempts with 429', async () => {
    const { createApp } = await import('../../src/app.js');
    const limited = createApp({ rateLimits: { ...NO_LIMITS, auth: { windowMs: 60000, limit: 3 } } });
    const attempt = () => request(limited).post('/api/auth/login').send({ email: 'x@test.civicfix', password: 'Wrong1234' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
