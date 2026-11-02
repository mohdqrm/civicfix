// /api/categories — public list of active categories for the report form and filters.
import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../utils/errors.js';

export const serializeCategory = (r) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  isActive: r.is_active,
  ...(r.default_department_id !== undefined
    ? { defaultDepartment: r.default_department_id ? { id: r.default_department_id, name: r.department_name } : null }
    : {}),
  ...(r.complaint_count !== undefined ? { complaintCount: r.complaint_count } : {}),
});

export const CATEGORY_SELECT = `
  SELECT cat.*, d.name AS department_name,
    (SELECT COUNT(*) FROM complaints c WHERE c.category_id = cat.id) AS complaint_count
  FROM categories cat LEFT JOIN departments d ON d.id = cat.default_department_id`;

export function categoriesRouter() {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const { rows } = await query(
        `SELECT id, slug, name, description, is_active FROM categories WHERE is_active ORDER BY id`
      );
      res.json({ items: rows.map(serializeCategory) });
    })
  );
  return router;
}
