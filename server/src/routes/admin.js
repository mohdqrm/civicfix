// /api/admin — everything here requires an administrator (citizens get 403).
import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  adminEditSchema,
  assignSchema,
  complaintIdParam,
  createCategorySchema,
  duplicateListQuery,
  duplicateReviewSchema,
  idParam,
  listComplaintsQuery,
  statusUpdateSchema,
  updateCategorySchema,
} from '../validation/schemas.js';
import { asyncHandler, badRequest, conflict, notFound } from '../utils/errors.js';
import {
  getAssignmentHistory,
  getComplaintRow,
  getStatusHistory,
  listComplaints,
  serialize,
} from '../services/complaintQueries.js';
import { adminEdit, assignDepartment, changeStatus, ensureExists } from '../services/complaintService.js';
import { detectAndStore, listSuggestions, reviewSuggestion, suggestionsForComplaint } from '../services/duplicateService.js';
import { getStats } from '../services/statsService.js';
import { CATEGORY_SELECT, serializeCategory } from './categories.js';

async function fullAdminComplaint(id) {
  const row = await getComplaintRow(id);
  if (!row) throw notFound('Complaint not found');
  return {
    ...serialize(row, 'admin'),
    statusHistory: await getStatusHistory(id, 'admin'),
    assignments: await getAssignmentHistory(id),
    duplicateSuggestions: await suggestionsForComplaint(id),
  };
}

export function adminRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/stats', asyncHandler(async (_req, res) => res.json(await getStats())));

  // ---------- complaints ----------
  router.get(
    '/complaints',
    validate({ query: listComplaintsQuery }),
    asyncHandler(async (req, res) => res.json(await listComplaints(req.valid.query, { view: 'admin' })))
  );

  router.get(
    '/complaints/:id',
    validate({ params: complaintIdParam }),
    asyncHandler(async (req, res) => res.json({ complaint: await fullAdminComplaint(req.valid.params.id) }))
  );

  router.patch(
    '/complaints/:id/status',
    validate({ params: complaintIdParam, body: statusUpdateSchema }),
    asyncHandler(async (req, res) => {
      await changeStatus(req.valid.params.id, req.user.id, req.valid.body);
      res.json({ complaint: await fullAdminComplaint(req.valid.params.id) });
    })
  );

  router.patch(
    '/complaints/:id',
    validate({ params: complaintIdParam, body: adminEditSchema }),
    asyncHandler(async (req, res) => {
      await adminEdit(req.valid.params.id, req.valid.body);
      res.json({ complaint: await fullAdminComplaint(req.valid.params.id) });
    })
  );

  router.post(
    '/complaints/:id/assign',
    validate({ params: complaintIdParam, body: assignSchema }),
    asyncHandler(async (req, res) => {
      await assignDepartment(req.valid.params.id, req.user.id, req.valid.body);
      res.json({ complaint: await fullAdminComplaint(req.valid.params.id) });
    })
  );

  // Re-run duplicate detection on demand (e.g. after a report was edited).
  router.post(
    '/complaints/:id/detect-duplicates',
    validate({ params: complaintIdParam }),
    asyncHandler(async (req, res) => {
      await ensureExists(req.valid.params.id);
      const added = await detectAndStore(req.valid.params.id);
      res.json({ added, suggestions: await suggestionsForComplaint(req.valid.params.id) });
    })
  );

  // ---------- AI duplicate suggestions (human review) ----------
  router.get(
    '/duplicates',
    validate({ query: duplicateListQuery }),
    asyncHandler(async (req, res) => res.json(await listSuggestions(req.valid.query)))
  );

  router.patch(
    '/duplicates/:id',
    validate({ params: idParam, body: duplicateReviewSchema }),
    asyncHandler(async (req, res) => {
      const suggestion = await reviewSuggestion(req.valid.params.id, req.valid.body.decision, req.user.id);
      res.json({ suggestion });
    })
  );

  // ---------- departments ----------
  router.get(
    '/departments',
    asyncHandler(async (_req, res) => {
      const { rows } = await query(`SELECT d.id, d.name, d.description,
          (SELECT COUNT(*) FROM assignments a JOIN complaints c ON c.id = a.complaint_id
            WHERE a.department_id = d.id AND a.is_current AND c.status IN ('submitted','under_review','in_progress')) AS open_complaints
        FROM departments d ORDER BY d.name`);
      res.json({
        items: rows.map((d) => ({ id: d.id, name: d.name, description: d.description, openComplaints: d.open_complaints })),
      });
    })
  );

  // ---------- categories (FR13) ----------
  router.get(
    '/categories',
    asyncHandler(async (_req, res) => {
      const { rows } = await query(`${CATEGORY_SELECT} ORDER BY cat.id`);
      res.json({ items: rows.map(serializeCategory) });
    })
  );

  async function checkDepartment(id) {
    if (id === undefined || id === null) return;
    const { rows } = await query('SELECT id FROM departments WHERE id = $1', [id]);
    if (!rows[0]) throw badRequest('Some fields are invalid', [{ field: 'defaultDepartmentId', message: 'Department not found' }]);
  }

  router.post(
    '/categories',
    validate({ body: createCategorySchema }),
    asyncHandler(async (req, res) => {
      const b = req.valid.body;
      await checkDepartment(b.defaultDepartmentId);
      try {
        const { rows } = await query(
          `INSERT INTO categories (slug, name, description, default_department_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [b.slug, b.name, b.description ?? null, b.defaultDepartmentId ?? null]
        );
        const created = await query(`${CATEGORY_SELECT} WHERE cat.id = $1`, [rows[0].id]);
        res.status(201).json({ category: serializeCategory(created.rows[0]) });
      } catch (err) {
        if (err.code === '23505') throw conflict('A category with this name or slug already exists');
        throw err;
      }
    })
  );

  // Categories are deactivated, never deleted, so old complaints keep their category.
  router.patch(
    '/categories/:id',
    validate({ params: idParam, body: updateCategorySchema }),
    asyncHandler(async (req, res) => {
      const b = req.valid.body;
      await checkDepartment(b.defaultDepartmentId);
      try {
        const { rowCount } = await query(
          `UPDATE categories SET
             name = COALESCE($2, name),
             description = CASE WHEN $3::boolean THEN $4 ELSE description END,
             default_department_id = CASE WHEN $5::boolean THEN $6 ELSE default_department_id END,
             is_active = COALESCE($7, is_active)
           WHERE id = $1`,
          [
            req.valid.params.id,
            b.name ?? null,
            b.description !== undefined,
            b.description ?? null,
            b.defaultDepartmentId !== undefined,
            b.defaultDepartmentId ?? null,
            b.isActive ?? null,
          ]
        );
        if (!rowCount) throw notFound('Category not found');
      } catch (err) {
        if (err.code === '23505') throw conflict('A category with this name already exists');
        throw err;
      }
      const { rows } = await query(`${CATEGORY_SELECT} WHERE cat.id = $1`, [req.valid.params.id]);
      res.json({ category: serializeCategory(rows[0]) });
    })
  );

  return router;
}
