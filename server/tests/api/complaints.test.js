import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { adminAgent, db, fileComplaint, getApp, isolatedSpot, newCitizen } from '../helpers.js';
import { config } from '../../src/config.js';

let app;
let citizen;
beforeAll(async () => {
  app = await getApp();
  citizen = await newCitizen(app);
});
afterAll(async () => (await db()).end());

// Number of stored photos, for whichever storage driver the suite runs with.
const storedPhotos = async () =>
  config.storageDriver === 'database'
    ? Number((await (await db()).query('SELECT COUNT(*) AS n FROM photos')).rows[0].n)
    : (existsSync(config.uploadDir) ? readdirSync(config.uploadDir) : []).length;

describe('POST /api/complaints (report an issue)', () => {
  it('creates a complaint with photo, tracking ID, first history entry and auto-assigned department', async () => {
    const res = await fileComplaint(citizen.agent, { landmark: 'Opposite the bus depot' });
    expect(res.status).toBe(201);
    const c = res.body.complaint;
    expect(c.trackingId).toMatch(/^CF-\d{6}$/);
    expect(c).toMatchObject({ status: 'submitted', priority: 'medium', landmark: 'Opposite the bus depot', isMine: true });
    expect(c.category.slug).toBe('roads');
    expect(c.department.name).toBe('Public Works');
    expect(c.statusHistory).toHaveLength(1);
    expect(c.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: 'submitted', changedBy: 'Reporter' });
    expect(c.imageUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.webp$/);

    // Persisted in the database
    const { rows } = await (await db()).query('SELECT user_id, image_key FROM complaints WHERE id = $1', [c.id]);
    expect(rows[0].user_id).toBe(citizen.user.id);

    // Photo is served, re-encoded as WebP, resized, and stripped of EXIF metadata
    const img = await request(app).get(c.imageUrl);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
  });

  it('requires a photo', async () => {
    const res = await fileComplaint(citizen.agent, {}, { photo: false });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual({ field: 'photo', message: expect.any(String) });
  });

  it('rejects a non-image disguised as a JPEG, and stores nothing', async () => {
    const before = await storedPhotos();
    const where = isolatedSpot();
    const res = await citizen.agent
      .post('/api/complaints')
      .field('categoryId', '1')
      .field('title', 'Disguised upload')
      .field('description', 'This file pretends to be a JPEG image.')
      .field('latitude', String(where.lat))
      .field('longitude', String(where.lng))
      .attach('photo', Buffer.from('<?php system($_GET["c"]); ?>'), { filename: 'shell.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid image/i);
    expect(await storedPhotos()).toBe(before);
  });

  it('rejects disallowed file types and oversized files', async () => {
    const where = isolatedSpot();
    const base = (r) =>
      r
        .field('categoryId', '1')
        .field('title', 'Wrong type upload')
        .field('description', 'Testing upload restrictions here.')
        .field('latitude', String(where.lat))
        .field('longitude', String(where.lng));
    const svg = await base(citizen.agent.post('/api/complaints')).attach('photo', Buffer.from('<svg onload="alert(1)"/>'), {
      filename: 'x.svg',
      contentType: 'image/svg+xml',
    });
    expect(svg.status).toBe(400);

    const huge = await base(citizen.agent.post('/api/complaints')).attach('photo', Buffer.alloc(5 * 1024 * 1024 + 10, 1), {
      filename: 'big.jpg',
      contentType: 'image/jpeg',
    });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('validates every field and returns them all at once', async () => {
    const res = await fileComplaint(citizen.agent, {
      categoryId: 'abc',
      title: 'Hey',
      description: 'short',
      latitude: 95,
      longitude: -200,
    });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d) => d.field).sort();
    expect(fields).toEqual(['categoryId', 'description', 'latitude', 'longitude', 'title']);
  });

  it('rejects unknown or inactive categories', async () => {
    const res = await fileComplaint(citizen.agent, { categoryId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('categoryId');
  });

  it('requires login, and admins cannot file citizen reports', async () => {
    expect((await fileComplaint(request.agent(app))).status).toBe(401);
    expect((await fileComplaint(await adminAgent(app))).status).toBe(403);
  });
});

describe('browsing and tracking', () => {
  let mine;
  beforeAll(async () => {
    mine = (await fileComplaint(citizen.agent, { title: 'Garbage pile zebra-crossing', categoryId: 2, description: 'A large garbage pile next to the zebra crossing.' })).body.complaint;
  });

  it('public detail works by number and by tracking ID, without reporter identity', async () => {
    const byNum = await request(app).get(`/api/complaints/${mine.id}`);
    const byTracking = await request(app).get(`/api/complaints/${mine.trackingId.toLowerCase()}`);
    expect(byNum.status).toBe(200);
    expect(byTracking.body.complaint.id).toBe(mine.id);
    const text = JSON.stringify(byNum.body);
    expect(text).not.toContain(citizen.user.email);
    expect(text).not.toContain('reporter');
    expect(byNum.body.complaint.isMine).toBeUndefined();
  });

  it('404 for a missing complaint and 400 for a malformed ID', async () => {
    expect((await request(app).get('/api/complaints/999999')).status).toBe(404);
    expect((await request(app).get('/api/complaints/1;DROP TABLE users')).status).toBe(400);
  });

  it('lists with filters, search and pagination', async () => {
    const res = await request(app).get('/api/complaints').query({ category: 'garbage', q: 'zebra-crossing', status: 'submitted' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.id)).toContain(mine.id);
    expect(res.body.items.every((c) => c.category.slug === 'garbage' && c.status === 'submitted')).toBe(true);

    const byTracking = await request(app).get('/api/complaints').query({ q: mine.trackingId });
    expect(byTracking.body.items[0].id).toBe(mine.id);

    const page = await request(app).get('/api/complaints').query({ limit: 1, page: 1 });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBeGreaterThanOrEqual(2);
    expect(page.body.totalPages).toBe(page.body.total);

    expect((await request(app).get('/api/complaints').query({ status: 'bogus' })).status).toBe(400);
    expect((await request(app).get('/api/complaints').query({ limit: 1000 })).status).toBe(400);
  });

  it('treats search text literally (no SQL injection, no LIKE wildcards)', async () => {
    const inj = await request(app).get('/api/complaints').query({ q: "' OR 1=1 --" });
    expect(inj.status).toBe(200);
    expect(inj.body.total).toBe(0);
    const wildcard = await request(app).get('/api/complaints').query({ q: '%' });
    expect(wildcard.body.total).toBe(0);
    // Tables still intact
    expect((await (await db()).query('SELECT COUNT(*) AS n FROM users')).rows[0].n).toBeGreaterThan(0);
  });

  it('finds complaints near a point, nearest first', async () => {
    const where = isolatedSpot();
    const near = (await fileComplaint(citizen.agent, { latitude: where.lat, longitude: where.lng, categoryId: 3, title: 'Dead lamp post here', description: 'Lamp post not working at all tonight.' })).body.complaint;
    const far = (await fileComplaint(citizen.agent, { latitude: where.lat + 0.01, longitude: where.lng, categoryId: 4, title: 'Leaking valve by gate', description: 'Water valve leaking near the gate.' })).body.complaint; // ~1.1 km
    const res = await request(app).get('/api/complaints').query({ lat: where.lat, lng: where.lng, radius: 2000, sort: 'distance' });
    expect(res.body.items.map((c) => c.id)).toEqual([near.id, far.id]);
    expect(res.body.items[0].distanceM).toBeLessThan(5);
    expect(res.body.items[1].distanceM).toBeGreaterThan(1000);
    const tight = await request(app).get('/api/complaints').query({ lat: where.lat, lng: where.lng, radius: 500 });
    expect(tight.body.items.map((c) => c.id)).toEqual([near.id]);
    expect((await request(app).get('/api/complaints').query({ lat: where.lat })).status).toBe(400);
  });

  it('map endpoint returns markers only, without descriptions or reporters', async () => {
    const res = await request(app).get('/api/complaints/map').query({ category: 'garbage' });
    expect(res.status).toBe(200);
    const m = res.body.items.find((x) => x.id === mine.id);
    expect(Object.keys(m).sort()).toEqual(['category', 'createdAt', 'id', 'latitude', 'longitude', 'status', 'title', 'trackingId']);
  });

  it("citizen sees only their own complaints with counts in /api/me/complaints", async () => {
    const other = await newCitizen(app);
    await fileComplaint(other.agent);
    const res = await citizen.agent.get('/api/me/complaints').query({ limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((c) => c.isMine)).toBe(true);
    expect(res.body.counts.total).toBe(res.body.total);
    expect((await request(app).get('/api/me/complaints')).status).toBe(401);
  });
});

describe('citizen editing', () => {
  it('owner can edit while submitted; others cannot; nobody can once handling starts', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    const edit = await citizen.agent.patch(`/api/complaints/${c.id}`).send({ title: 'Pothole on test road (updated)' });
    expect(edit.status).toBe(200);
    expect(edit.body.complaint.title).toBe('Pothole on test road (updated)');

    const stranger = await newCitizen(app);
    expect((await stranger.agent.patch(`/api/complaints/${c.id}`).send({ title: 'Hijacked title' })).status).toBe(403);

    const admin = await adminAgent(app);
    await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'under_review' });
    const late = await citizen.agent.patch(`/api/complaints/${c.id}`).send({ title: 'Too late to edit' });
    expect(late.status).toBe(409);
  });
});

describe('similar-report check (FR6)', () => {
  it('suggests an existing nearby report with similar wording before submitting', async () => {
    const where = isolatedSpot();
    const first = (
      await fileComplaint(citizen.agent, {
        latitude: where.lat,
        longitude: where.lng,
        title: 'Overflowing dustbin near temple gate',
        description: 'Dustbin near the temple gate is overflowing with garbage for days.',
        categoryId: 2,
      })
    ).body.complaint;
    const res = await citizen.agent.post('/api/complaints/similar').send({
      categoryId: 2,
      title: 'Garbage overflowing at temple gate',
      description: 'The bin at the temple gate is full and garbage is spilling out.',
      latitude: where.lat + 0.0001,
      longitude: where.lng,
    });
    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe(first.id);
    expect(res.body.items[0].score).toBeGreaterThan(0.5);
    expect(JSON.stringify(res.body)).not.toContain(citizen.user.email);

    const unrelated = await citizen.agent.post('/api/complaints/similar').send({
      categoryId: 3,
      title: 'Streetlight dead',
      description: 'The streetlight near the playground does not work.',
      ...(() => { const s = isolatedSpot(); return { latitude: s.lat, longitude: s.lng }; })(),
    });
    expect(unrelated.body.items).toEqual([]);
  });
});
