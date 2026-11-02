// Write-side of complaints. Every change that touches more than one table runs
// in a transaction, so a complaint can never exist without its first status-history
// row, and a status change can never be saved without its history + notification.
import { query, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { getComplaintRow, trackingId } from './complaintQueries.js';
import { detectAndStore } from './duplicateService.js';
import { config } from '../config.js';

export const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

async function activeCategory(db, categoryId) {
  const { rows } = await db.query('SELECT id, default_department_id FROM categories WHERE id = $1 AND is_active', [
    categoryId,
  ]);
  if (!rows[0]) throw badRequest('Some fields are invalid', [{ field: 'categoryId', message: 'Choose a valid category' }]);
  return rows[0];
}

/** Save a new complaint. `image` is { url, key } from storage, already processed. */
export async function createComplaint(userId, data, image) {
  const id = await withTransaction(async (db) => {
    const category = await activeCategory(db, data.categoryId);
    const { rows } = await db.query(
      `INSERT INTO complaints (user_id, category_id, title, description, latitude, longitude, landmark, image_url, image_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId, data.categoryId, data.title, data.description, data.latitude, data.longitude, data.landmark ?? null, image?.url ?? null, image?.key ?? null]
    );
    const newId = rows[0].id;
    await db.query(
      `INSERT INTO status_history (complaint_id, old_status, new_status, note, changed_by)
       VALUES ($1, NULL, 'submitted', 'Complaint submitted', $2)`,
      [newId, userId]
    );
    // Route the complaint to its category's default department straight away.
    if (category.default_department_id) {
      await db.query(
        `INSERT INTO assignments (complaint_id, department_id, assigned_by, note)
         VALUES ($1, $2, NULL, 'Auto-assigned from category')`,
        [newId, category.default_department_id]
      );
    }
    return newId;
  });

  // Duplicate detection runs after the complaint is safely saved; a failure here
  // is logged but never loses the citizen's report.
  try {
    await detectAndStore(id);
  } catch (err) {
    if (!config.isTest) console.error(`Duplicate detection failed for ${trackingId(id)}:`, err.message);
  }
  return id;
}

/** Citizens may correct their own report while it is still 'submitted'. */
export async function editOwnComplaint(id, userId, data) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT user_id, status FROM complaints WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Complaint not found');
    if (rows[0].user_id !== userId) throw forbidden('You can only edit your own complaints');
    if (rows[0].status !== 'submitted') throw conflict('This complaint is already being handled and can no longer be edited');
    await db.query(
      `UPDATE complaints SET
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         landmark = CASE WHEN $4::boolean THEN $5 ELSE landmark END,
         updated_at = now()
       WHERE id = $1`,
      [id, data.title ?? null, data.description ?? null, 'landmark' in data, data.landmark ?? null]
    );
    return getComplaintRow(id, db);
  });
}

async function notify(db, userId, complaintId, message) {
  await db.query('INSERT INTO notifications (user_id, complaint_id, message) VALUES ($1, $2, $3)', [userId, complaintId, message]);
}

/** Admin changes status. Records history and notifies the reporter. Admins may reopen. */
export async function changeStatus(id, adminId, { status, note, rejectionReason }) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, user_id, title, status FROM complaints WHERE id = $1 FOR UPDATE', [id]);
    const c = rows[0];
    if (!c) throw notFound('Complaint not found');
    if (c.status === status) throw conflict(`Complaint is already ${STATUS_LABELS[status]}`);

    await db.query(
      // $2 is cast once so Postgres doesn't infer two different types for it (error 42P08).
      `UPDATE complaints SET
         status = $2::varchar,
         rejection_reason = CASE WHEN $2::varchar = 'rejected' THEN $3 ELSE NULL END,
         resolved_at = CASE WHEN $2::varchar = 'resolved' THEN now() ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [id, status, rejectionReason ?? null]
    );
    const historyNote = status === 'rejected' ? [note, `Reason: ${rejectionReason}`].filter(Boolean).join(' — ') : note ?? null;
    await db.query(
      `INSERT INTO status_history (complaint_id, old_status, new_status, note, changed_by) VALUES ($1, $2, $3, $4, $5)`,
      [id, c.status, status, historyNote, adminId]
    );
    if (c.user_id !== adminId) {
      let message = `Your complaint ${trackingId(id)} "${c.title}" is now ${STATUS_LABELS[status]}.`;
      if (status === 'rejected') message += ` Reason: ${rejectionReason}`;
      else if (note) message += ` Note: ${note}`;
      await notify(db, c.user_id, id, message);
    }
    return getComplaintRow(id, db);
  });
}

export async function adminEdit(id, { priority, categoryId }) {
  return withTransaction(async (db) => {
    const exists = await db.query('SELECT id FROM complaints WHERE id = $1 FOR UPDATE', [id]);
    if (!exists.rows[0]) throw notFound('Complaint not found');
    if (categoryId !== undefined) {
      const cat = await db.query('SELECT id FROM categories WHERE id = $1', [categoryId]);
      if (!cat.rows[0]) throw badRequest('Some fields are invalid', [{ field: 'categoryId', message: 'Category not found' }]);
    }
    await db.query(
      `UPDATE complaints SET priority = COALESCE($2, priority), category_id = COALESCE($3, category_id), updated_at = now() WHERE id = $1`,
      [id, priority ?? null, categoryId ?? null]
    );
    return getComplaintRow(id, db);
  });
}

/** Assign to a department. Previous assignment is kept as history (is_current = false). */
export async function assignDepartment(id, adminId, { departmentId, note }) {
  return withTransaction(async (db) => {
    const c = await db.query('SELECT id, user_id, title FROM complaints WHERE id = $1 FOR UPDATE', [id]);
    if (!c.rows[0]) throw notFound('Complaint not found');
    const dep = await db.query('SELECT id, name FROM departments WHERE id = $1', [departmentId]);
    if (!dep.rows[0]) throw badRequest('Some fields are invalid', [{ field: 'departmentId', message: 'Department not found' }]);
    const current = await db.query('SELECT department_id FROM assignments WHERE complaint_id = $1 AND is_current', [id]);
    if (current.rows[0]?.department_id === departmentId) throw conflict(`Already assigned to ${dep.rows[0].name}`);

    await db.query('UPDATE assignments SET is_current = FALSE WHERE complaint_id = $1 AND is_current', [id]);
    await db.query(
      'INSERT INTO assignments (complaint_id, department_id, assigned_by, note) VALUES ($1, $2, $3, $4)',
      [id, departmentId, adminId, note ?? null]
    );
    await db.query('UPDATE complaints SET updated_at = now() WHERE id = $1', [id]);
    if (c.rows[0].user_id !== adminId) {
      await notify(db, c.rows[0].user_id, id, `Your complaint ${trackingId(id)} has been assigned to ${dep.rows[0].name}.`);
    }
    return getComplaintRow(id, db);
  });
}

export async function ensureExists(id) {
  const { rows } = await query('SELECT id, user_id FROM complaints WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Complaint not found');
  return rows[0];
}
