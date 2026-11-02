import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, fileComplaint, getApp, newCitizen } from '../helpers.js';

let app;
let citizen;
beforeAll(async () => {
  app = await getApp();
  citizen = await newCitizen(app);
});
afterAll(async () => (await db()).end());

describe('security headers and error handling', () => {
  it('sends protective headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, database: 'connected' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('unknown API routes return JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('never leaks stack traces or SQL in error responses', async () => {
    const res = await request(app).get('/api/complaints').query({ lat: 'abc', lng: 'def' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|SELECT|pg_|stack/i);
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await citizen.agent.patch('/api/me').send({ name: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('CORS only allows the configured frontend origin', async () => {
    const good = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(good.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('input handling', () => {
  it('ignores attempts to set protected fields when filing a complaint (mass assignment)', async () => {
    const res = await fileComplaint(citizen.agent, { status: 'resolved', priority: 'critical', user_id: 1, duplicate_of: 1 });
    expect(res.status).toBe(201);
    const { rows } = await (await db()).query('SELECT status, priority, user_id, duplicate_of FROM complaints WHERE id = $1', [
      res.body.complaint.id,
    ]);
    expect(rows[0]).toEqual({ status: 'submitted', priority: 'medium', user_id: citizen.user.id, duplicate_of: null });
  });

  it('stores script tags as plain text and returns them as JSON (React escapes them on display)', async () => {
    const payload = '<img src=x onerror=alert(1)> broken lamp';
    const res = await fileComplaint(citizen.agent, { title: payload, description: `<script>alert('x')</script> lamp broken here` });
    expect(res.status).toBe(201);
    const got = await request(app).get(`/api/complaints/${res.body.complaint.id}`);
    expect(got.headers['content-type']).toMatch(/application\/json/);
    expect(got.body.complaint.title).toBe(payload); // unchanged data, never rendered as HTML by the API
  });

  it('a missing photo is a 404, not a server error or the web page', async () => {
    const res = await request(app).get('/uploads/00000000-0000-0000-0000-000000000000.webp');
    expect(res.status).toBe(404);
  });

  it('cannot read files outside the uploads folder', async () => {
    for (const p of ['/uploads/../.env', '/uploads/..%2f.env', '/uploads/%2e%2e/package.json', '/uploads/.hidden']) {
      const res = await request(app).get(p);
      expect([400, 403, 404]).toContain(res.status);
      expect(res.text).not.toMatch(/JWT_SECRET|"dependencies"/);
    }
  });

  it('SQL metacharacters in IDs, filters and sort are rejected or treated as data', async () => {
    expect((await request(app).get("/api/complaints/1' OR '1'='1")).status).toBe(400);
    expect((await request(app).get('/api/complaints').query({ sort: 'created_at; DROP TABLE users' })).status).toBe(400);
    expect((await request(app).get('/api/complaints').query({ category: "roads' OR 1=1--" })).body.total).toBe(0);
    expect((await (await db()).query('SELECT COUNT(*) AS n FROM users')).rows[0].n).toBeGreaterThan(0);
  });
});

describe('session cookie', () => {
  it('is not marked Secure in development/test but is httpOnly with a 7-day lifetime', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: citizen.user.email, password: citizen.password });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Max-Age=604800/);
  });
});
