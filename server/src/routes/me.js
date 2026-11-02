// /api/me — the logged-in user's own profile, complaint history and notifications.
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParam, listComplaintsQuery, paginationQuery, updateProfileSchema } from '../validation/schemas.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { listComplaints, trackingId } from '../services/complaintQueries.js';
import { publicUser } from './auth.js';

export function meRouter() {
  const router = Router();
  router.use(requireAuth);

  router.patch(
    '/',
    validate({ body: updateProfileSchema }),
    asyncHandler(async (req, res) => {
      const b = req.valid.body;
      const { rows } = await query(
        `UPDATE users SET
           name = COALESCE($2, name),
           phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
           updated_at = now()
         WHERE id = $1 RETURNING id, name, email, role, phone, created_at`,
        [req.user.id, b.name ?? null, 'phone' in b, b.phone ?? null]
      );
      res.json({ user: publicUser(rows[0]) });
    })
  );

  // The citizen's own complaints (same filters as the public list) + per-status counts.
  router.get(
    '/complaints',
    validate({ query: listComplaintsQuery }),
    asyncHandler(async (req, res) => {
      const list = await listComplaints(req.valid.query, {
        view: 'public',
        userId: req.user.id,
        currentUserId: req.user.id,
      });
      const { rows } = await query('SELECT status, COUNT(*) AS n FROM complaints WHERE user_id = $1 GROUP BY status', [
        req.user.id,
      ]);
      const counts = { submitted: 0, under_review: 0, in_progress: 0, resolved: 0, rejected: 0 };
      for (const r of rows) counts[r.status] = r.n;
      res.json({ ...list, counts: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } });
    })
  );

  router.get(
    '/notifications',
    validate({ query: paginationQuery }),
    asyncHandler(async (req, res) => {
      const { page, limit, unread } = req.valid.query;
      const onlyUnread = unread === 'true';
      const where = `WHERE user_id = $1 ${onlyUnread ? 'AND NOT is_read' : ''}`;
      const total = (await query(`SELECT COUNT(*) AS n FROM notifications ${where}`, [req.user.id])).rows[0].n;
      const unreadCount = (await query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user.id])).rows[0].n;
      const { rows } = await query(
        `SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, (page - 1) * limit]
      );
      res.json({
        items: rows.map((n) => ({
          id: n.id,
          message: n.message,
          isRead: n.is_read,
          createdAt: n.created_at,
          complaint: n.complaint_id ? { id: n.complaint_id, trackingId: trackingId(n.complaint_id) } : null,
        })),
        unreadCount,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    })
  );

  router.patch(
    '/notifications/:id/read',
    validate({ params: idParam }),
    asyncHandler(async (req, res) => {
      // user_id in the WHERE clause means you can only mark your own notifications.
      const { rowCount } = await query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [
        req.valid.params.id,
        req.user.id,
      ]);
      if (!rowCount) throw notFound('Notification not found');
      res.json({ ok: true });
    })
  );

  router.post(
    '/notifications/read-all',
    asyncHandler(async (req, res) => {
      const { rowCount } = await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read', [req.user.id]);
      res.json({ ok: true, updated: rowCount });
    })
  );

  return router;
}
