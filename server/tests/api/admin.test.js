import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminAgent, db, fileComplaint, getApp, isolatedSpot, newCitizen } from '../helpers.js';

let app;
let admin;
let citizen;
beforeAll(async () => {
  app = await getApp();
  admin = await adminAgent(app);
  citizen = await newCitizen(app);
});
afterAll(async () => (await db()).end());

describe('authorization on every admin endpoint', () => {
  const routes = [
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/complaints'],
    ['get', '/api/admin/complaints/1'],
    ['patch', '/api/admin/complaints/1/status', { status: 'resolved' }],
    ['patch', '/api/admin/complaints/1', { priority: 'high' }],
    ['post', '/api/admin/complaints/1/assign', { departmentId: 1 }],
    ['post', '/api/admin/complaints/1/detect-duplicates'],
    ['get', '/api/admin/duplicates'],
    ['patch', '/api/admin/duplicates/1', { decision: 'confirmed' }],
    ['get', '/api/admin/departments'],
    ['get', '/api/admin/categories'],
    ['post', '/api/admin/categories', { slug: 'x', name: 'X' }],
    ['patch', '/api/admin/categories/1', { isActive: false }],
  ];
  it.each(routes)('%s %s → 401 logged out, 403 for citizens', async (method, url, body) => {
    expect((await request(app)[method](url).send(body)).status).toBe(401);
    const res = await citizen.agent[method](url).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a citizen trying to change a status leaves the complaint untouched', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    await citizen.agent.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'resolved' });
    const { rows } = await (await db()).query('SELECT status FROM complaints WHERE id = $1', [c.id]);
    expect(rows[0].status).toBe('submitted');
  });
});

describe('status workflow', () => {
  it('moves through the workflow, records history, notifies the reporter, and the reporter sees it', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    for (const status of ['under_review', 'in_progress']) {
      const r = await admin.patch(`/api/admin/complaints/${c.trackingId}/status`).send({ status, note: `Moved to ${status}` });
      expect(r.status).toBe(200);
      expect(r.body.complaint.status).toBe(status);
    }
    const done = await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'resolved', note: 'Patched by crew' });
    expect(done.body.complaint.resolvedAt).not.toBeNull();
    expect(done.body.complaint.statusHistory.map((h) => h.toStatus)).toEqual(['submitted', 'under_review', 'in_progress', 'resolved']);
    expect(done.body.complaint.statusHistory[3].changedBy).toBe('Test Admin');

    // Reporter's view
    const mine = await citizen.agent.get(`/api/complaints/${c.id}`);
    expect(mine.body.complaint.status).toBe('resolved');
    expect(mine.body.complaint.statusHistory.at(-1)).toMatchObject({ toStatus: 'resolved', note: 'Patched by crew', changedBy: 'CivicFix team' });

    const notes = await citizen.agent.get('/api/me/notifications');
    const forThis = notes.body.items.filter((n) => n.complaint?.id === c.id);
    expect(forThis.length).toBeGreaterThanOrEqual(3);
    expect(forThis[0].message).toMatch(/is now Resolved/);
    expect(notes.body.unreadCount).toBeGreaterThanOrEqual(3);

    // Mark one read, then all read
    expect((await citizen.agent.patch(`/api/me/notifications/${forThis[0].id}/read`)).status).toBe(200);
    const all = await citizen.agent.post('/api/me/notifications/read-all');
    expect(all.body.ok).toBe(true);
    expect((await citizen.agent.get('/api/me/notifications').query({ unread: 'true' })).body.items).toHaveLength(0);

    // Someone else's notification can't be touched
    const stranger = await newCitizen(app);
    expect((await stranger.agent.patch(`/api/me/notifications/${forThis[0].id}/read`)).status).toBe(404);
  });

  it('rejection requires a reason, which is shown publicly and in the notification', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    const noReason = await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'rejected' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].field).toBe('rejectionReason');

    const reason = 'Private property; please contact the society office.';
    const ok = await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'rejected', rejectionReason: reason });
    expect(ok.status).toBe(200);
    const pub = await request(app).get(`/api/complaints/${c.id}`);
    expect(pub.body.complaint.rejectionReason).toBe(reason);
    const n = await citizen.agent.get('/api/me/notifications');
    expect(n.body.items.find((x) => x.complaint?.id === c.id).message).toContain(reason);

    // Reopening clears the rejection reason
    const reopened = await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'under_review', note: 'Reopened after appeal' });
    expect(reopened.body.complaint.rejectionReason).toBeNull();
    expect(reopened.body.complaint.statusHistory.map((h) => h.toStatus)).toEqual(['submitted', 'rejected', 'under_review']);
  });

  it('rejects no-op and invalid status changes', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    expect((await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'submitted' })).status).toBe(409);
    expect((await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'done' })).status).toBe(400);
    expect((await admin.patch('/api/admin/complaints/999999/status').send({ status: 'resolved' })).status).toBe(404);
  });

  it('database still enforces the rejection-reason rule even if the API were bypassed', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    await expect((await db()).query(`UPDATE complaints SET status = 'rejected' WHERE id = $1`, [c.id])).rejects.toThrow(
      /rejected_needs_reason/
    );
  });
});

describe('priority, category and department assignment', () => {
  it('sets priority, recategorises, and reassigns with history kept', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    const pr = await admin.patch(`/api/admin/complaints/${c.id}`).send({ priority: 'critical', categoryId: 6 });
    expect(pr.status).toBe(200);
    expect(pr.body.complaint).toMatchObject({ priority: 'critical', category: { slug: 'infrastructure' } });
    expect((await admin.patch(`/api/admin/complaints/${c.id}`).send({ priority: 'urgent' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/complaints/${c.id}`).send({ categoryId: 9999 })).status).toBe(400);

    const deps = (await admin.get('/api/admin/departments')).body.items;
    const electrical = deps.find((d) => d.name === 'Electrical');
    const a = await admin.post(`/api/admin/complaints/${c.id}/assign`).send({ departmentId: electrical.id, note: 'Cable exposed' });
    expect(a.status).toBe(200);
    expect(a.body.complaint.department.name).toBe('Electrical');
    expect(a.body.complaint.assignments.map((x) => [x.department.name, x.isCurrent])).toEqual([
      ['Public Works', false],
      ['Electrical', true],
    ]);
    expect((await admin.post(`/api/admin/complaints/${c.id}/assign`).send({ departmentId: electrical.id })).status).toBe(409);
    expect((await admin.post(`/api/admin/complaints/${c.id}/assign`).send({ departmentId: 9999 })).status).toBe(400);

    const { rows } = await (await db()).query('SELECT COUNT(*) AS n FROM assignments WHERE complaint_id = $1 AND is_current', [c.id]);
    expect(rows[0].n).toBe(1);

    const filtered = await admin.get('/api/admin/complaints').query({ departmentId: electrical.id, priority: 'critical' });
    expect(filtered.body.items.map((x) => x.id)).toContain(c.id);
  });
});

describe('admin complaint list and detail', () => {
  it('shows reporter contact details to admins only', async () => {
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    const detail = await admin.get(`/api/admin/complaints/${c.id}`);
    expect(detail.body.complaint.reporter).toMatchObject({ id: citizen.user.id, email: citizen.user.email });
    const list = await admin.get('/api/admin/complaints').query({ q: c.trackingId });
    expect(list.body.items[0].reporter.email).toBe(citizen.user.email);
  });

  it('filters by date range', async () => {
    const future = await admin.get('/api/admin/complaints').query({ from: '2999-01-01' });
    expect(future.body.total).toBe(0);
    expect((await admin.get('/api/admin/complaints').query({ from: 'yesterday-ish' })).status).toBe(400);
  });
});

describe('dashboard statistics', () => {
  it('match a direct count of the database', async () => {
    const res = await admin.get('/api/admin/stats');
    expect(res.status).toBe(200);
    const s = res.body;
    const pool = await db();
    const counts = Object.fromEntries(
      (await pool.query('SELECT status, COUNT(*) AS n FROM complaints GROUP BY status')).rows.map((r) => [r.status, r.n])
    );
    const total = (await pool.query('SELECT COUNT(*) AS n FROM complaints')).rows[0].n;
    expect(s.total).toBe(total);
    for (const k of ['submitted', 'under_review', 'in_progress', 'resolved', 'rejected']) expect(s.byStatus[k]).toBe(counts[k] ?? 0);
    expect(s.pending).toBe((counts.submitted ?? 0) + (counts.under_review ?? 0));
    expect(s.resolutionRate).toBeCloseTo(Math.round(((counts.resolved ?? 0) / total) * 1000) / 10, 5);
    expect(s.byCategory.reduce((a, c) => a + c.total, 0)).toBe(total);
    expect(s.byDepartment.reduce((a, d) => a + d.total, 0)).toBe(total);
    expect(s.last30Days).toHaveLength(30);
    expect(s.last30Days.reduce((a, d) => a + d.reported, 0)).toBe(total); // all test data is from today
  });

  it('change immediately when a complaint is filed and resolved', async () => {
    const before = (await admin.get('/api/admin/stats')).body;
    const c = (await fileComplaint(citizen.agent)).body.complaint;
    await admin.patch(`/api/admin/complaints/${c.id}/status`).send({ status: 'resolved' });
    const after = (await admin.get('/api/admin/stats')).body;
    expect(after.total).toBe(before.total + 1);
    expect(after.resolved).toBe(before.resolved + 1);
  });
});

describe('AI duplicate suggestions with human review', () => {
  it('flags a near-identical nearby report, and admin confirms or dismisses', async () => {
    const where = isolatedSpot();
    const other = await newCitizen(app);
    const original = (
      await fileComplaint(citizen.agent, {
        latitude: where.lat,
        longitude: where.lng,
        title: 'Huge pothole near Sector 4 market',
        description: 'A huge pothole outside the Sector 4 market entrance. Bikes are skidding.',
      })
    ).body.complaint;
    const dup = (
      await fileComplaint(other.agent, {
        latitude: +(where.lat + 0.0002).toFixed(6), // ~22 m away
        longitude: where.lng,
        title: 'Big gaddha at Sector 4 market entrance',
        description: 'Deep pothole right at the entrance of Sector 4 market, two-wheelers skidding.',
      })
    ).body.complaint;
    const unrelated = (
      await fileComplaint(other.agent, {
        latitude: +(where.lat + 0.0003).toFixed(6),
        longitude: where.lng,
        categoryId: 3,
        title: 'Streetlight not working',
        description: 'The streetlight by the bus stop has been off for a week.',
      })
    ).body.complaint;

    const detail = (await admin.get(`/api/admin/complaints/${dup.id}`)).body.complaint;
    expect(detail.pendingDuplicates).toBe(1);
    expect(detail.duplicateSuggestions).toHaveLength(1);
    const s = detail.duplicateSuggestions[0];
    expect(s.complaint.id).toBe(dup.id);
    expect(s.likelyOriginal.id).toBe(original.id);
    expect(s.score).toBeGreaterThanOrEqual(0.51);
    expect(s.components).toMatchObject({ category: 1 });
    expect(s.components.distanceM).toBeLessThan(30);
    expect((await admin.get(`/api/admin/complaints/${unrelated.id}`)).body.complaint.duplicateSuggestions).toHaveLength(0);

    // Nothing has been merged or changed automatically
    expect(detail.duplicateOf).toBeNull();
    expect(detail.status).toBe('submitted');

    // Appears in the review queue and the "has duplicates" filter
    const queue = await admin.get('/api/admin/duplicates');
    expect(queue.body.items.map((x) => x.id)).toContain(s.id);
    const flagged = await admin.get('/api/admin/complaints').query({ hasDuplicates: 'true' });
    expect(flagged.body.items.map((x) => x.id)).toEqual(expect.arrayContaining([original.id, dup.id]));

    // Re-running detection doesn't create a second copy
    const rerun = await admin.post(`/api/admin/complaints/${original.id}/detect-duplicates`);
    expect(rerun.body.added).toBe(0);

    // Human confirms
    const confirm = await admin.patch(`/api/admin/duplicates/${s.id}`).send({ decision: 'confirmed' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.suggestion).toMatchObject({ reviewStatus: 'confirmed', reviewedBy: 'Test Admin' });
    const pub = await request(app).get(`/api/complaints/${dup.id}`);
    expect(pub.body.complaint.duplicateOf).toEqual({ id: original.id, trackingId: original.trackingId });
    expect(pub.body.complaint.status).toBe('submitted'); // still not rejected — that's a separate human decision
    expect((await admin.patch(`/api/admin/duplicates/${s.id}`).send({ decision: 'dismissed' })).status).toBe(409);
    expect((await admin.patch('/api/admin/duplicates/999999').send({ decision: 'dismissed' })).status).toBe(404);
    expect((await admin.patch(`/api/admin/duplicates/${s.id}`).send({ decision: 'merge' })).status).toBe(400);
  });

  it('dismissing leaves both complaints unlinked', async () => {
    const where = isolatedSpot();
    const a = (await fileComplaint(citizen.agent, { latitude: where.lat, longitude: where.lng, categoryId: 2, title: 'Garbage dump behind school', description: 'Garbage dumped behind the government school wall.' })).body.complaint;
    const b = (await fileComplaint(citizen.agent, { latitude: where.lat, longitude: where.lng, categoryId: 2, title: 'Garbage pile behind school wall', description: 'Large garbage pile dumped behind the school wall again.' })).body.complaint;
    const s = (await admin.get(`/api/admin/complaints/${b.id}`)).body.complaint.duplicateSuggestions[0];
    expect(s.likelyOriginal.id).toBe(a.id);
    const r = await admin.patch(`/api/admin/duplicates/${s.id}`).send({ decision: 'dismissed' });
    expect(r.body.suggestion.reviewStatus).toBe('dismissed');
    expect((await admin.get(`/api/admin/complaints/${b.id}`)).body.complaint.duplicateOf).toBeNull();
    const dismissed = await admin.get('/api/admin/duplicates').query({ status: 'dismissed' });
    expect(dismissed.body.items.map((x) => x.id)).toContain(s.id);
  });
});

describe('category management (FR13)', () => {
  it('creates, renames and deactivates; inactive categories disappear from the report form', async () => {
    const created = await admin.post('/api/admin/categories').send({ slug: 'stray-animals', name: 'Stray Animals', defaultDepartmentId: 6 });
    expect(created.status).toBe(201);
    const id = created.body.category.id;
    expect(created.body.category.defaultDepartment.name).toBe('General Administration');
    expect((await admin.post('/api/admin/categories').send({ slug: 'stray-animals', name: 'Again' })).status).toBe(409);
    expect((await admin.post('/api/admin/categories').send({ slug: 'Bad Slug!', name: 'Bad' })).status).toBe(400);

    const renamed = await admin.patch(`/api/admin/categories/${id}`).send({ name: 'Stray Animals & Cattle' });
    expect(renamed.body.category.name).toBe('Stray Animals & Cattle');

    expect((await request(app).get('/api/categories')).body.items.map((c) => c.id)).toContain(id);
    await admin.patch(`/api/admin/categories/${id}`).send({ isActive: false });
    expect((await request(app).get('/api/categories')).body.items.map((c) => c.id)).not.toContain(id);
    expect((await fileComplaint(citizen.agent, { categoryId: id })).status).toBe(400);
    expect((await admin.get('/api/admin/categories')).body.items.find((c) => c.id === id).isActive).toBe(false);
    expect((await admin.patch('/api/admin/categories/99999').send({ name: 'Nope nope' })).status).toBe(404);
  });
});
